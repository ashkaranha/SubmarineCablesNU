import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import maplibregl, { type MapLayerMouseEvent, type MapMouseEvent, type StyleSpecification } from 'maplibre-gl'
import type { Feature, FeatureCollection, Point } from 'geojson'
import {
  fetchCable,
  fetchCableGeoJson,
  fetchIncident,
  fetchIncidents,
} from '../api/client'
import { resolveIncidentIdFromFeature } from '../api/markerNormalization'
import { useUiStore } from '../store/uiStore'
import type { IncidentListItem, IncidentMarker, MarkerFill } from '../types/api'
import { MapLegend } from './MapLegend'
import {
  MARKER_FILL_COLORS,
  MARKER_STROKE_RESOLVED,
  strokeColorFor,
} from './markerStyles'

const INCIDENT_HIT_LAYERS = ['incident-labels', 'incident-points'] as const
const HIT_BBOX_PX = 12

interface MapInteractionHandlers {
  closePanel: () => void
  openCablePanel: ReturnType<typeof useUiStore.getState>['openCablePanel']
  openIncidentPanel: ReturnType<typeof useUiStore.getState>['openIncidentPanel']
  openGroupPanel: ReturnType<typeof useUiStore.getState>['openGroupPanel']
  setHoverInfo: ReturnType<typeof useUiStore.getState>['setHoverInfo']
  incidentsByCableRef: MutableRefObject<Map<string, IncidentListItem[]>>
  incidentsByIdRef: MutableRefObject<Map<string, IncidentListItem>>
  locationGroupsRef: MutableRefObject<Map<string, string[]>>
}

// OpenFreeMap's hosted vector styles: free, no API key, no request quota
// (unlike CARTO's basemaps.cartocdn.com raster tiles, which now require a
// paid API key and serve "API KEY REQUIRED" watermarked placeholder tiles
// for anonymous requests -- that's what a plain CARTO raster style silently
// degrades into).
const REMOTE_BASEMAP_STYLE: Record<'light' | 'dark', string> = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
}

// Fully local: no tile source, no remote style document, so it can never fail
// or hang. Used as the map's initial style (painted before any network
// request completes) and as the last-resort fallback if OpenFreeMap itself
// is unreachable -- a plain background is a better failure mode than a
// broken/watermarked basemap.
function blankBackgroundStyle(theme: 'light' | 'dark'): StyleSpecification {
  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {},
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: {
          'background-color': theme === 'dark' ? '#0b0b0b' : '#f2f2f0',
        },
      },
    ],
  }
}

function basemapStyle(theme: 'light' | 'dark'): string {
  return REMOTE_BASEMAP_STYLE[theme]
}

// The basemap style is a full vector style fetched from openfreemap.org. If
// that fetch fails (offline, blocked, host down), MapLibre never fires
// 'style.load', so callers waiting on it to bind the incident/cable layers
// would otherwise hang forever with a map that looks "stuck". Fall back to
// a local, tile-free background instead, which needs no remote style document
// and so can't itself fail.
function setStyleWithFallback(map: maplibregl.Map, style: StyleSpecification | string, theme: 'light' | 'dark', onReady: () => void) {
  const onLoad = () => {
    map.off('error', onError)
    forceEnglishLabels(map)
    onReady()
  }
  const onError = (event: { error?: unknown }) => {
    map.off('style.load', onLoad)
    console.error('Failed to load map style, falling back to blank background', event.error)
    map.once('style.load', onReady)
    map.setStyle(blankBackgroundStyle(theme))
  }
  map.once('style.load', onLoad)
  map.once('error', onError)
  map.setStyle(style)
}

// OpenFreeMap's default styles label places with a two-line
// "{name:latin}\n{name}" field -- an English/transliterated line plus the
// local-script name stacked underneath (OpenMapTiles convention). That
// doubles label height/width, which is why country names were spilling past
// their borders. Force every place label to a single English line instead.
function forceEnglishLabels(map: maplibregl.Map) {
  const style = map.getStyle()
  if (!style?.layers) {
    return
  }
  for (const layer of style.layers) {
    if (layer.type !== 'symbol') {
      continue
    }
    const textField = (layer.layout as Record<string, unknown> | undefined)?.['text-field']
    if (!textField) {
      continue
    }
    const textFieldRaw = typeof textField === 'string' ? textField : JSON.stringify(textField)
    if (!textFieldRaw.includes('name')) {
      continue
    }
    try {
      map.setLayoutProperty(layer.id, 'text-field', [
        'coalesce',
        ['get', 'name:en'],
        ['get', 'name:latin'],
        ['get', 'name'],
      ])
    } catch {
      // Some style layers reject layout overrides; skip those.
    }
  }
}

function emphasizeDarkMapLabels(map: maplibregl.Map) {
  const style = map.getStyle()
  if (!style?.layers) {
    return
  }
  for (const layer of style.layers) {
    if (layer.type !== 'symbol' || layer.id.startsWith('incident-')) {
      continue
    }
    try {
      map.setPaintProperty(layer.id, 'text-color', '#ffffff')
      map.setPaintProperty(layer.id, 'text-halo-color', '#111111')
      map.setPaintProperty(layer.id, 'text-halo-width', 1.15)
    } catch {
      // Some style layers reject paint overrides; skip those.
    }
  }
}

function queryIncidentFeature(
  map: maplibregl.Map,
  point: maplibregl.Point,
  features?: maplibregl.GeoJSONFeature[],
): maplibregl.GeoJSONFeature | undefined {
  const direct = features?.find(
    (feature) => !feature.properties?.cluster_id && feature.properties?.id,
  )
  if (direct) {
    return direct
  }

  const layers = INCIDENT_HIT_LAYERS.filter((layer) => Boolean(map.getLayer(layer)))
  if (layers.length === 0) {
    return undefined
  }

  const bbox: [[number, number], [number, number]] = [
    [point.x - HIT_BBOX_PX, point.y - HIT_BBOX_PX],
    [point.x + HIT_BBOX_PX, point.y + HIT_BBOX_PX],
  ]
  const hits = map.queryRenderedFeatures(bbox, { layers: [...layers] })
  return (
    hits.find((feature) => feature.layer.id === 'incident-labels') ??
    hits.find((feature) => feature.properties?.id) ??
    hits[0]
  )
}

function bindMapInteractions(
  activeMap: maplibregl.Map,
  handlers: MapInteractionHandlers,
  boundRef: { current: boolean },
) {
  if (boundRef.current) {
    return
  }
  boundRef.current = true

  const handleIncidentClick = async (event: MapLayerMouseEvent) => {
    event.originalEvent.stopPropagation()

    const clusterFeature = event.features?.find((feature) => feature.properties?.cluster_id)
    if (clusterFeature) {
      const source = activeMap.getSource('incidents') as maplibregl.GeoJSONSource
      const clusterId = Number(clusterFeature.properties?.cluster_id)
      const zoom = await source.getClusterExpansionZoom(clusterId)
      const geometry = clusterFeature.geometry
      if (geometry.type === 'Point') {
        activeMap.easeTo({ center: geometry.coordinates as [number, number], zoom })
      }
      return
    }

    const feature = queryIncidentFeature(activeMap, event.point, event.features)
    if (!feature) {
      return
    }

    const trueLng = Number(feature.properties?.true_lng)
    const trueLat = Number(feature.properties?.true_lat)
    const flyToFeature = () => {
      if (Number.isFinite(trueLng) && Number.isFinite(trueLat)) {
        activeMap.easeTo({
          center: [trueLng, trueLat],
          zoom: Math.max(activeMap.getZoom(), 4),
        })
      }
    }

    const count = Number(feature.properties?.count ?? 1)
    if (count > 1) {
      const locationKey = String(feature.properties?.location_key ?? '')
      const ids = handlers.locationGroupsRef.current.get(locationKey) ?? []
      const incidents = ids
        .map((id) => handlers.incidentsByIdRef.current.get(id))
        .filter((incident): incident is IncidentListItem => Boolean(incident))
      if (incidents.length === 0) {
        return
      }
      handlers.openGroupPanel(incidents)
      flyToFeature()
      return
    }

    const incidentId = resolveIncidentIdFromFeature(feature.properties as Record<string, unknown>)
    if (!incidentId) {
      return
    }

    const incident = await fetchIncident(incidentId)
    handlers.openIncidentPanel(incident)
    flyToFeature()
  }

  const onIncidentMouseMove = () => {
    activeMap.getCanvas().style.cursor = 'pointer'
  }
  const onIncidentMouseLeave = () => {
    activeMap.getCanvas().style.cursor = ''
  }

  activeMap.on('mousemove', 'cables-line', (event: MapLayerMouseEvent) => {
    activeMap.getCanvas().style.cursor = 'pointer'
    const feature = event.features?.[0]
    const cableName = String(feature?.properties?.name ?? '')
    if (!cableName) {
      return
    }
    activeMap.setFilter('cables-line-hover', ['==', ['get', 'name'], cableName])
    activeMap.setPaintProperty('cables-line-hover', 'line-opacity', 1)

    const incidentsForCable = handlers.incidentsByCableRef.current.get(cableName) ?? []
    handlers.setHoverInfo({
      cableName,
      incidents: incidentsForCable.map((incident) => ({
        name: incident.original_cable_name,
        date: incident.date,
      })),
      x: event.point.x,
      y: event.point.y,
    })
  })

  activeMap.on('mouseleave', 'cables-line', () => {
    activeMap.getCanvas().style.cursor = ''
    if (activeMap.getLayer('cables-line-hover')) {
      activeMap.setPaintProperty('cables-line-hover', 'line-opacity', 0)
      const state = useUiStore.getState()
      applyCableVisibilityFilter(
        activeMap,
        state.hideQuietCables,
        uniqueCableNames(state.filteredIncidents),
      )
    }
    handlers.setHoverInfo(null)
  })

  activeMap.on('mousemove', 'incident-points', onIncidentMouseMove)
  activeMap.on('mousemove', 'incident-labels', onIncidentMouseMove)
  activeMap.on('mouseleave', 'incident-points', onIncidentMouseLeave)
  activeMap.on('mouseleave', 'incident-labels', onIncidentMouseLeave)

  activeMap.on('click', 'cables-line', async (event: MapLayerMouseEvent) => {
    event.originalEvent.stopPropagation()
    const feature = event.features?.[0]
    const cableName = String(feature?.properties?.name ?? '')
    if (!cableName) {
      return
    }
    const detail = await fetchCable(cableName)
    handlers.openCablePanel(cableName, detail)
  })

  activeMap.on('click', 'incident-points', handleIncidentClick)
  activeMap.on('click', 'incident-labels', handleIncidentClick)
  activeMap.on('click', 'incident-clusters', handleIncidentClick)

  activeMap.on('click', (event: MapMouseEvent) => {
    const layers = ['cables-line', 'incident-points', 'incident-labels', 'incident-clusters']
    const existing = layers.filter((layer) => Boolean(activeMap.getLayer(layer)))
    if (existing.length === 0) {
      return
    }
    const features = activeMap.queryRenderedFeatures(event.point, { layers: existing })
    if (features.length === 0) {
      handlers.closePanel()
    }
  })
}

function roundCoord(value: number): number {
  return Math.round(value * 10000) / 10000
}

function groupMarkersByLocation(markers: IncidentMarker[]): Map<string, IncidentMarker[]> {
  const groups = new Map<string, IncidentMarker[]>()
  for (const marker of markers) {
    const key = `${roundCoord(marker.latitude)}:${roundCoord(marker.longitude)}`
    const list = groups.get(key) ?? []
    list.push(marker)
    groups.set(key, list)
  }
  return groups
}

const MARKER_FILL_SEVERITY: Record<MarkerFill, number> = {
  slate: 0,
  amber: 1,
  red: 2,
}

function dominantMarkerFill(markers: IncidentMarker[]): MarkerFill {
  let best: MarkerFill = 'slate'
  for (const marker of markers) {
    if (MARKER_FILL_SEVERITY[marker.marker_fill] > MARKER_FILL_SEVERITY[best]) {
      best = marker.marker_fill
    }
  }
  return best
}

function markersToGeoJson(
  markers: IncidentMarker[],
  selectedIncidentId: string | null,
  selectedGroupIncidentIds: string[],
  locationGroupsRef: MutableRefObject<Map<string, string[]>>,
): FeatureCollection {
  const groups = groupMarkersByLocation(markers)
  const locationGroups = new Map<string, string[]>()
  const features: Feature<Point>[] = []

  for (const [key, group] of groups) {
    const ids = group.map((marker) => marker.id)
    locationGroups.set(key, ids)

    const representative = group[0]
    const count = group.length
    const isSelected =
      (selectedIncidentId != null && ids.includes(selectedIncidentId)) ||
      (selectedGroupIncidentIds.length > 0 && ids.some((id) => selectedGroupIncidentIds.includes(id)))
    // Multiple incidents at the same spot still need a color: show the most
    // severe tier in the group (confirmed > suspected > none) rather than
    // hiding it behind a flat grey dot.
    const groupFill = count === 1 ? representative.marker_fill : dominantMarkerFill(group)

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [representative.longitude, representative.latitude],
      },
      properties: {
        location_key: key,
        count,
        id: count === 1 ? representative.id : null,
        marker_fill: groupFill,
        severity: MARKER_FILL_SEVERITY[groupFill],
        status_stroke: count === 1 ? representative.status_stroke : null,
        true_lat: representative.latitude,
        true_lng: representative.longitude,
        date: representative.date,
        cable: representative.canonical_cable_name,
        selected: isSelected ? 1 : 0,
      },
    })
  }

  locationGroupsRef.current = locationGroups
  return { type: 'FeatureCollection', features }
}

function applyCableVisibilityFilter(
  map: maplibregl.Map,
  hideQuietCables: boolean,
  cableNames: string[],
) {
  if (!map.getLayer('cables-line')) {
    return
  }

  if (!hideQuietCables) {
    map.setFilter('cables-line', null)
    map.setFilter('cables-line-hover', null)
    return
  }

  if (cableNames.length === 0) {
    map.setFilter('cables-line', ['==', ['get', 'name'], '__none__'])
    map.setFilter('cables-line-hover', ['==', ['get', 'name'], '__none__'])
    return
  }

  const nameFilter: maplibregl.FilterSpecification = [
    'in',
    ['get', 'name'],
    ['literal', cableNames],
  ]
  map.setFilter('cables-line', nameFilter)
  map.setFilter('cables-line-hover', nameFilter)
}

function uniqueCableNames(incidents: IncidentListItem[]): string[] {
  return [...new Set(incidents.map((incident) => incident.canonical_cable_name).filter(Boolean))]
}

function unresolvedStroke(theme: 'light' | 'dark'): string {
  return strokeColorFor('unresolved', theme)
}

function addMapLayers(
  map: maplibregl.Map,
  cableGeoJson: FeatureCollection,
  markers: IncidentMarker[],
  selectedIncidentId: string | null,
  selectedGroupIncidentIds: string[],
  locationGroupsRef: MutableRefObject<Map<string, string[]>>,
  theme: 'light' | 'dark',
) {
  if (map.getSource('cables') && map.getLayer('cables-line')) {
    const cables = map.getSource('cables') as maplibregl.GeoJSONSource
    cables.setData(cableGeoJson)
    const incidents = map.getSource('incidents') as maplibregl.GeoJSONSource
    incidents.setData(
      markersToGeoJson(markers, selectedIncidentId, selectedGroupIncidentIds, locationGroupsRef),
    )
    if (map.getLayer('incident-points')) {
      map.setPaintProperty('incident-points', 'circle-stroke-color', [
        'case',
        ['==', ['get', 'selected'], 1],
        '#111111',
        ['==', ['get', 'status_stroke'], 'resolved'],
        MARKER_STROKE_RESOLVED,
        unresolvedStroke(theme),
      ])
    }
    return
  }

  if (map.getSource('cables') && !map.getLayer('cables-line')) {
    if (map.getSource('incidents')) {
      map.removeSource('incidents')
    }
    map.removeSource('cables')
  }

  const cableData: FeatureCollection = {
    type: 'FeatureCollection',
    features: cableGeoJson.features ?? [],
  }
  map.addSource('cables', { type: 'geojson', data: cableData })
  map.addLayer({
    id: 'cables-line',
    type: 'line',
    source: 'cables',
    paint: {
      'line-color': ['coalesce', ['get', 'color'], '#8a8a8a'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 1, 1.2, 6, 2.8],
      'line-opacity': 0.75,
    },
  })
  map.addLayer({
    id: 'cables-line-hover',
    type: 'line',
    source: 'cables',
    paint: {
      'line-color': '#111111',
      'line-width': ['interpolate', ['linear'], ['zoom'], 1, 3, 6, 6],
      'line-opacity': 0,
    },
  })

  map.addSource('incidents', {
    type: 'geojson',
    data: markersToGeoJson(markers, selectedIncidentId, selectedGroupIncidentIds, locationGroupsRef),
    cluster: true,
    clusterMaxZoom: 8,
    clusterRadius: 45,
    clusterProperties: {
      incident_count: ['+', ['get', 'count']],
      severity: ['max', ['get', 'severity']],
    },
  })
  map.addLayer({
    id: 'incident-clusters',
    type: 'circle',
    source: 'incidents',
    filter: ['has', 'point_count'],
    paint: {
      // Color clusters by the most severe incident they contain, same as
      // individual points, so a cluster of suspected/confirmed incidents
      // doesn't get flattened to a neutral grey.
      'circle-color': [
        'step',
        ['coalesce', ['get', 'severity'], 0],
        MARKER_FILL_COLORS.slate,
        1,
        MARKER_FILL_COLORS.amber,
        2,
        MARKER_FILL_COLORS.red,
      ],
      'circle-radius': ['step', ['coalesce', ['get', 'incident_count'], ['get', 'point_count']], 16, 8, 20, 20, 24],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  })
  map.addLayer({
    id: 'incident-cluster-count',
    type: 'symbol',
    source: 'incidents',
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['to-string', ['coalesce', ['get', 'incident_count'], ['get', 'point_count']]],
      'text-size': 12,
      'text-allow-overlap': true,
    },
    paint: {
      'text-color': '#ffffff',
    },
  })
  map.addLayer({
    id: 'incident-points',
    type: 'circle',
    source: 'incidents',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': [
        'match',
        ['get', 'marker_fill'],
        'red',
        MARKER_FILL_COLORS.red,
        'amber',
        MARKER_FILL_COLORS.amber,
        MARKER_FILL_COLORS.slate,
      ],
      'circle-radius': [
        'case',
        ['==', ['get', 'selected'], 1],
        14,
        ['>', ['get', 'count'], 1],
        13,
        11,
      ],
      'circle-stroke-width': ['case', ['==', ['get', 'selected'], 1], 3.5, 2.75],
      'circle-stroke-color': [
        'case',
        ['==', ['get', 'selected'], 1],
        '#111111',
        ['>', ['get', 'count'], 1],
        '#ffffff',
        ['==', ['get', 'status_stroke'], 'resolved'],
        MARKER_STROKE_RESOLVED,
        unresolvedStroke(theme),
      ],
    },
  })
  map.addLayer({
    id: 'incident-labels',
    type: 'symbol',
    source: 'incidents',
    filter: ['!', ['has', 'point_count']],
    layout: {
      'text-field': ['to-string', ['get', 'count']],
      'text-size': 16,
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color': '#ffffff',
    },
  })
}

export function CableMap() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const incidentsByCableRef = useRef<Map<string, IncidentListItem[]>>(new Map())
  const incidentsByIdRef = useRef<Map<string, IncidentListItem>>(new Map())
  const locationGroupsRef = useRef<Map<string, string[]>>(new Map())
  const cableGeoJsonRef = useRef<FeatureCollection | null>(null)
  const interactionsBoundRef = useRef(false)
  const hasLoadedRef = useRef(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const theme = useUiStore((state) => state.theme)
  const flyTarget = useUiStore((state) => state.flyTarget)
  const clearFlyTarget = useUiStore((state) => state.clearFlyTarget)
  const closePanel = useUiStore((state) => state.closePanel)
  const openCablePanel = useUiStore((state) => state.openCablePanel)
  const openIncidentPanel = useUiStore((state) => state.openIncidentPanel)
  const openGroupPanel = useUiStore((state) => state.openGroupPanel)
  const setHoverInfo = useUiStore((state) => state.setHoverInfo)
  const hoverInfo = useUiStore((state) => state.hoverInfo)
  const filteredMarkers = useUiStore((state) => state.filteredMarkers)
  const filteredIncidents = useUiStore((state) => state.filteredIncidents)
  const selectedIncidentId = useUiStore((state) => state.selectedIncidentId)
  const selectedGroupIncidentIds = useUiStore((state) => state.selectedGroupIncidentIds)
  const hideQuietCables = useUiStore((state) => state.hideQuietCables)
  const fitBoundsRequestId = useUiStore((state) => state.fitBoundsRequestId)
  const clearFitBoundsRequest = useUiStore((state) => state.clearFitBoundsRequest)

  const interactionHandlers: MapInteractionHandlers = {
    closePanel,
    openCablePanel,
    openIncidentPanel,
    openGroupPanel,
    setHoverInfo,
    incidentsByCableRef,
    incidentsByIdRef,
    locationGroupsRef,
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return
    }

    let disposed = false
    let map: maplibregl.Map | null = null

    const setupMapContent = (activeMap: maplibregl.Map) => {
      const cableGeoJson = cableGeoJsonRef.current
      if (!cableGeoJson) {
        return
      }
      try {
        const state = useUiStore.getState()
        addMapLayers(
          activeMap,
          cableGeoJson,
          state.filteredMarkers,
          state.selectedIncidentId,
          state.selectedGroupIncidentIds,
          locationGroupsRef,
          state.theme,
        )
        bindMapInteractions(activeMap, interactionHandlers, interactionsBoundRef)
        applyCableVisibilityFilter(
          activeMap,
          state.hideQuietCables,
          uniqueCableNames(state.filteredIncidents),
        )
        activeMap.resize()
        setStatus('ready')
      } catch (error) {
        console.error(error)
        setStatus('error')
        setErrorMessage(error instanceof Error ? error.message : 'Failed to add map layers')
      }
    }

    const init = async () => {
      try {
        const [cableGeoJson, incidents] = await Promise.all([
          fetchCableGeoJson(),
          fetchIncidents(),
        ])

        if (disposed || !containerRef.current) {
          return
        }

        cableGeoJsonRef.current = cableGeoJson
        const byCable = new Map<string, IncidentListItem[]>()
        const byId = new Map<string, IncidentListItem>()
        for (const incident of incidents) {
          const list = byCable.get(incident.canonical_cable_name) ?? []
          list.push(incident)
          byCable.set(incident.canonical_cable_name, list)
          byId.set(incident.id, incident)
        }
        incidentsByCableRef.current = byCable
        incidentsByIdRef.current = byId

        map = new maplibregl.Map({
          container: containerRef.current,
          style: blankBackgroundStyle(useUiStore.getState().theme),
          center: [20, 20],
          zoom: 1.8,
          attributionControl: false,
        })
        map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left')
        mapRef.current = map

        map.on('error', (event) => {
          console.error('MapLibre error', event.error)
        })

        map.on('load', () => {
          const theme = useUiStore.getState().theme
          const finishSetup = () => {
            try {
              if (useUiStore.getState().theme === 'dark') {
                emphasizeDarkMapLabels(map!)
              }
              setupMapContent(map!)
              hasLoadedRef.current = true
            } catch (error) {
              console.error(error)
              setStatus('error')
              setErrorMessage(error instanceof Error ? error.message : 'Failed to add map layers')
            }
          }
          setStyleWithFallback(map!, REMOTE_BASEMAP_STYLE[theme], theme, finishSetup)
        })

        requestAnimationFrame(() => {
          map?.resize()
        })
      } catch (error) {
        console.error(error)
        if (!disposed) {
          setStatus('error')
          setErrorMessage(error instanceof Error ? error.message : 'Failed to load map data')
        }
      }
    }

    void init()

    const onResize = () => mapRef.current?.resize()
    window.addEventListener('resize', onResize)

    return () => {
      disposed = true
      window.removeEventListener('resize', onResize)
      map?.remove()
      mapRef.current = null
      interactionsBoundRef.current = false
    }
  }, [closePanel, openCablePanel, openIncidentPanel, setHoverInfo])

  useEffect(() => {
    const map = mapRef.current
    const source = map?.getSource('incidents') as maplibregl.GeoJSONSource | undefined
    if (!map || !source || !hasLoadedRef.current) {
      return
    }
    source.setData(
      markersToGeoJson(filteredMarkers, selectedIncidentId, selectedGroupIncidentIds, locationGroupsRef),
    )
  }, [filteredMarkers, selectedIncidentId, selectedGroupIncidentIds])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !hasLoadedRef.current || !map.getLayer('cables-line')) {
      return
    }
    applyCableVisibilityFilter(map, hideQuietCables, uniqueCableNames(filteredIncidents))
  }, [hideQuietCables, filteredIncidents])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !hasLoadedRef.current || fitBoundsRequestId === 0) {
      return
    }

    if (filteredMarkers.length === 0) {
      clearFitBoundsRequest()
      return
    }

    const bounds = new maplibregl.LngLatBounds()
    for (const marker of filteredMarkers) {
      bounds.extend([marker.longitude, marker.latitude])
    }
    map.fitBounds(bounds, { padding: 48, maxZoom: 6, duration: 700 })
    clearFitBoundsRequest()
  }, [fitBoundsRequestId, filteredMarkers, clearFitBoundsRequest])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !hasLoadedRef.current) {
      return
    }

    let applied = false
    const applyOverlays = () => {
      if (applied) {
        return
      }
      applied = true
      interactionsBoundRef.current = false
      const cableGeoJson = cableGeoJsonRef.current
      if (!cableGeoJson) {
        return
      }
      try {
        if (theme === 'dark') {
          emphasizeDarkMapLabels(map)
        }
        const state = useUiStore.getState()
        addMapLayers(
          map,
          cableGeoJson,
          state.filteredMarkers,
          state.selectedIncidentId,
          state.selectedGroupIncidentIds,
          locationGroupsRef,
          state.theme,
        )
        bindMapInteractions(map, interactionHandlers, interactionsBoundRef)
        applyCableVisibilityFilter(
          map,
          state.hideQuietCables,
          uniqueCableNames(state.filteredIncidents),
        )
        map.resize()
      } catch (error) {
        console.error(error)
      }
    }

    setStyleWithFallback(map, basemapStyle(theme), theme, applyOverlays)
  }, [theme])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !flyTarget) {
      return
    }
    map.easeTo({
      center: [flyTarget.longitude, flyTarget.latitude],
      zoom: Math.max(map.getZoom(), 4),
    })
    clearFlyTarget()
  }, [flyTarget, clearFlyTarget])

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="absolute inset-0 h-full w-full" />

      {status === 'loading' && (
        <div className="pointer-events-none absolute left-1/2 top-16 z-10 -translate-x-1/2 border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--muted)]">
          Loading map…
        </div>
      )}

      {status === 'error' && (
        <div className="absolute left-1/2 top-16 z-10 w-[min(90vw,28rem)] -translate-x-1/2 border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-center text-sm text-[var(--text)]">
          Could not load map data. Is the API running on port 8001?
          {errorMessage ? <span className="mt-2 block text-[var(--muted)]">{errorMessage}</span> : null}
        </div>
      )}

      {status === 'ready' && <MapLegend />}

      {hoverInfo && (
        <div
          className="pointer-events-none absolute z-20 max-w-xs border border-[var(--border)] bg-[var(--surface)] p-3 text-sm shadow-sm"
          style={{ left: hoverInfo.x + 12, top: hoverInfo.y + 12 }}
        >
          <p className="font-medium">{hoverInfo.cableName}</p>
          {hoverInfo.incidents.length > 0 ? (
            <ul className="mt-2 space-y-1 text-[var(--muted)]">
              {hoverInfo.incidents.slice(0, 6).map((incident) => (
                <li key={`${incident.name}-${incident.date}`}>
                  {incident.name} · {incident.date}
                </li>
              ))}
              {hoverInfo.incidents.length > 6 && <li>+{hoverInfo.incidents.length - 6} more</li>}
            </ul>
          ) : (
            <p className="mt-2 text-[var(--muted)]">No recorded incidents</p>
          )}
        </div>
      )}
    </div>
  )
}
