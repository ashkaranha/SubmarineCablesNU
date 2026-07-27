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
import type { IncidentListItem, IncidentMarker } from '../types/api'
import { MapLegend } from './MapLegend'
import {
  MARKER_FILL_COLORS,
  MARKER_STROKE_RESOLVED,
  strokeColorFor,
} from './markerStyles'

const SPIDERFY_RADIUS_DEG = 0.03
const INCIDENT_HIT_LAYERS = ['incident-labels', 'incident-points'] as const
const HIT_BBOX_PX = 12

interface MapInteractionHandlers {
  closePanel: () => void
  openCablePanel: ReturnType<typeof useUiStore.getState>['openCablePanel']
  openIncidentPanel: ReturnType<typeof useUiStore.getState>['openIncidentPanel']
  setHoverInfo: ReturnType<typeof useUiStore.getState>['setHoverInfo']
  incidentsByCableRef: MutableRefObject<Map<string, IncidentListItem[]>>
}

function basemapStyle(theme: 'light' | 'dark'): StyleSpecification {
  const tiles =
    theme === 'dark'
      ? ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png']
      : ['https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png']

  return {
    version: 8,
    sources: {
      basemap: {
        type: 'raster',
        tiles,
        tileSize: 256,
        attribution: '&copy; OpenStreetMap &copy; CARTO',
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: {
          'background-color': theme === 'dark' ? '#0b0b0b' : '#f2f2f0',
        },
      },
      {
        id: 'basemap',
        type: 'raster',
        source: 'basemap',
      },
    ],
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

    const incidentId = resolveIncidentIdFromFeature(feature.properties as Record<string, unknown>)
    if (!incidentId) {
      return
    }

    const incident = await fetchIncident(incidentId)
    handlers.openIncidentPanel(incident)

    const trueLng = Number(feature.properties?.true_lng)
    const trueLat = Number(feature.properties?.true_lat)
    if (Number.isFinite(trueLng) && Number.isFinite(trueLat)) {
      activeMap.easeTo({
        center: [trueLng, trueLat],
        zoom: Math.max(activeMap.getZoom(), 4),
      })
    }
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

function spiderfyMarkers(markers: IncidentMarker[]): Array<{
  marker: IncidentMarker
  displayLat: number
  displayLng: number
}> {
  const groups = new Map<string, IncidentMarker[]>()
  for (const marker of markers) {
    const key = `${roundCoord(marker.latitude)}:${roundCoord(marker.longitude)}`
    const list = groups.get(key) ?? []
    list.push(marker)
    groups.set(key, list)
  }

  const placed: Array<{ marker: IncidentMarker; displayLat: number; displayLng: number }> = []
  for (const group of groups.values()) {
    if (group.length === 1) {
      const marker = group[0]
      placed.push({ marker, displayLat: marker.latitude, displayLng: marker.longitude })
      continue
    }
    group.forEach((marker, index) => {
      const angle = (2 * Math.PI * index) / group.length - Math.PI / 2
      placed.push({
        marker,
        displayLat: marker.latitude + SPIDERFY_RADIUS_DEG * Math.sin(angle),
        displayLng: marker.longitude + SPIDERFY_RADIUS_DEG * Math.cos(angle),
      })
    })
  }
  return placed
}

function markersToGeoJson(
  markers: IncidentMarker[],
  selectedIncidentId: string | null,
): FeatureCollection {
  const features: Feature<Point>[] = spiderfyMarkers(markers).map(({ marker, displayLat, displayLng }) => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [displayLng, displayLat],
    },
    properties: {
      id: marker.id,
      marker_fill: marker.marker_fill,
      status_stroke: marker.status_stroke,
      true_lat: marker.latitude,
      true_lng: marker.longitude,
      date: marker.date,
      cable: marker.canonical_cable_name,
      selected: selectedIncidentId != null && marker.id === selectedIncidentId ? 1 : 0,
    },
  }))
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
  theme: 'light' | 'dark',
) {
  if (map.getSource('cables')) {
    const cables = map.getSource('cables') as maplibregl.GeoJSONSource
    cables.setData(cableGeoJson)
    const incidents = map.getSource('incidents') as maplibregl.GeoJSONSource
    incidents.setData(markersToGeoJson(markers, selectedIncidentId))
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

  map.addSource('cables', { type: 'geojson', data: cableGeoJson })
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
    data: markersToGeoJson(markers, selectedIncidentId),
    cluster: true,
    clusterMaxZoom: 8,
    clusterRadius: 45,
  })
  map.addLayer({
    id: 'incident-clusters',
    type: 'circle',
    source: 'incidents',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#374151',
      'circle-radius': ['step', ['get', 'point_count'], 16, 5, 20, 15, 24],
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
      'text-field': ['get', 'point_count_abbreviated'],
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
      'circle-radius': ['case', ['==', ['get', 'selected'], 1], 14, 11],
      'circle-stroke-width': ['case', ['==', ['get', 'selected'], 1], 3.5, 2.75],
      'circle-stroke-color': [
        'case',
        ['==', ['get', 'selected'], 1],
        '#111111',
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
      'text-field': '!',
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
  const setHoverInfo = useUiStore((state) => state.setHoverInfo)
  const hoverInfo = useUiStore((state) => state.hoverInfo)
  const filteredMarkers = useUiStore((state) => state.filteredMarkers)
  const filteredIncidents = useUiStore((state) => state.filteredIncidents)
  const selectedIncidentId = useUiStore((state) => state.selectedIncidentId)
  const hideQuietCables = useUiStore((state) => state.hideQuietCables)
  const fitBoundsRequestId = useUiStore((state) => state.fitBoundsRequestId)
  const clearFitBoundsRequest = useUiStore((state) => state.clearFitBoundsRequest)

  const interactionHandlers: MapInteractionHandlers = {
    closePanel,
    openCablePanel,
    openIncidentPanel,
    setHoverInfo,
    incidentsByCableRef,
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
        for (const incident of incidents) {
          const list = byCable.get(incident.canonical_cable_name) ?? []
          list.push(incident)
          byCable.set(incident.canonical_cable_name, list)
        }
        incidentsByCableRef.current = byCable

        map = new maplibregl.Map({
          container: containerRef.current,
          style: basemapStyle(useUiStore.getState().theme),
          center: [20, 20],
          zoom: 1.8,
          attributionControl: { compact: true },
        })
        mapRef.current = map

        map.on('error', (event) => {
          console.error('MapLibre error', event.error)
        })

        map.on('load', () => {
          setupMapContent(map!)
          hasLoadedRef.current = true
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
    source.setData(markersToGeoJson(filteredMarkers, selectedIncidentId))
  }, [filteredMarkers, selectedIncidentId])

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

    map.setStyle(basemapStyle(theme))
    map.once('style.load', () => {
      interactionsBoundRef.current = false
      const cableGeoJson = cableGeoJsonRef.current
      if (!cableGeoJson) {
        return
      }
      const state = useUiStore.getState()
      addMapLayers(
        map,
        cableGeoJson,
        state.filteredMarkers,
        state.selectedIncidentId,
        state.theme,
      )
      bindMapInteractions(map, interactionHandlers, interactionsBoundRef)
      applyCableVisibilityFilter(
        map,
        state.hideQuietCables,
        uniqueCableNames(state.filteredIncidents),
      )
      map.resize()
    })
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
