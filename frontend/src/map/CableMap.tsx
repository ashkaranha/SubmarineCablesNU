import { useEffect, useRef, useState } from 'react'
import maplibregl, { type MapLayerMouseEvent, type MapMouseEvent, type StyleSpecification } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import {
  fetchCable,
  fetchCableGeoJson,
  fetchIncident,
  fetchIncidents,
} from '../api/client'
import { useUiStore } from '../store/uiStore'
import type { IncidentListItem, MarkerGroup } from '../types/api'

const MARKER_COLORS: Record<string, string> = {
  red: '#c0392b',
  yellow: '#d4a017',
  green: '#2d6a4f',
  gray: '#6b7280',
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

function markersToGeoJson(
  markers: MarkerGroup[],
  selectedIncidentId: string | null,
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: markers.map((marker) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [marker.longitude, marker.latitude],
      },
      properties: {
        id: marker.id,
        marker_color: marker.marker_color,
        incident_count: marker.incident_count,
        incident_ids: marker.incident_ids.join('|'),
        selected: selectedIncidentId != null && marker.incident_ids.includes(selectedIncidentId) ? 1 : 0,
      },
    })),
  }
}

function addMapLayers(
  map: maplibregl.Map,
  cableGeoJson: FeatureCollection,
  markers: MarkerGroup[],
  selectedIncidentId: string | null,
) {
  if (map.getSource('cables')) {
    const cables = map.getSource('cables') as maplibregl.GeoJSONSource
    cables.setData(cableGeoJson)
    const incidents = map.getSource('incidents') as maplibregl.GeoJSONSource
    incidents.setData(markersToGeoJson(markers, selectedIncidentId))
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
        ['get', 'marker_color'],
        'red',
        MARKER_COLORS.red,
        'yellow',
        MARKER_COLORS.yellow,
        'green',
        MARKER_COLORS.green,
        MARKER_COLORS.gray,
      ],
      'circle-radius': ['case', ['==', ['get', 'selected'], 1], 14, 11],
      'circle-stroke-width': ['case', ['==', ['get', 'selected'], 1], 3, 2],
      'circle-stroke-color': ['case', ['==', ['get', 'selected'], 1], '#111111', '#ffffff'],
    },
  })
  map.addLayer({
    id: 'incident-labels',
    type: 'symbol',
    source: 'incidents',
    filter: ['!', ['has', 'point_count']],
    layout: {
      'text-field': '!',
      'text-size': 14,
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
  const openGroupPanel = useUiStore((state) => state.openGroupPanel)
  const setHoverInfo = useUiStore((state) => state.setHoverInfo)
  const hoverInfo = useUiStore((state) => state.hoverInfo)
  const filteredMarkers = useUiStore((state) => state.filteredMarkers)
  const selectedIncidentId = useUiStore((state) => state.selectedIncidentId)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return
    }

    let disposed = false
    let map: maplibregl.Map | null = null

    const bindInteractions = (activeMap: maplibregl.Map) => {
      if (interactionsBoundRef.current) {
        return
      }
      interactionsBoundRef.current = true

      const handleIncidentClick = async (event: MapLayerMouseEvent) => {
        event.originalEvent.stopPropagation()
        const feature = event.features?.[0]
        if (!feature) {
          return
        }

        if (feature.properties?.cluster_id) {
          const source = activeMap.getSource('incidents') as maplibregl.GeoJSONSource
          const clusterId = Number(feature.properties.cluster_id)
          const zoom = await source.getClusterExpansionZoom(clusterId)
          const geometry = feature.geometry
          if (geometry.type === 'Point') {
            activeMap.easeTo({ center: geometry.coordinates as [number, number], zoom })
          }
          return
        }

        const incidentIds = String(feature.properties?.incident_ids ?? '')
          .split('|')
          .filter(Boolean)

        if (incidentIds.length > 1) {
          const incidents = await Promise.all(incidentIds.map((id) => fetchIncident(id)))
          openGroupPanel(incidents)
          return
        }

        if (incidentIds.length === 1) {
          const incident = await fetchIncident(incidentIds[0])
          openIncidentPanel(incident)
          const geometry = feature.geometry
          if (geometry.type === 'Point') {
            activeMap.easeTo({
              center: geometry.coordinates as [number, number],
              zoom: Math.max(activeMap.getZoom(), 4),
            })
          }
        }
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

        const incidentsForCable = incidentsByCableRef.current.get(cableName) ?? []
        setHoverInfo({
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
        }
        setHoverInfo(null)
      })

      activeMap.on('click', 'cables-line', async (event: MapLayerMouseEvent) => {
        event.originalEvent.stopPropagation()
        const feature = event.features?.[0]
        const cableName = String(feature?.properties?.name ?? '')
        if (!cableName) {
          return
        }
        const detail = await fetchCable(cableName)
        openCablePanel(cableName, detail)
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
          closePanel()
        }
      })
    }

    const setupMapContent = (activeMap: maplibregl.Map) => {
      const cableGeoJson = cableGeoJsonRef.current
      if (!cableGeoJson) {
        return
      }
      try {
        const markers = useUiStore.getState().filteredMarkers
        const selectedId = useUiStore.getState().selectedIncidentId
        addMapLayers(activeMap, cableGeoJson, markers, selectedId)
        bindInteractions(activeMap)
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
  }, [closePanel, openCablePanel, openGroupPanel, openIncidentPanel, setHoverInfo])

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
      addMapLayers(
        map,
        cableGeoJson,
        useUiStore.getState().filteredMarkers,
        useUiStore.getState().selectedIncidentId,
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
          Could not load map data. Is the API running on port 8000?
          {errorMessage ? <span className="mt-2 block text-[var(--muted)]">{errorMessage}</span> : null}
        </div>
      )}

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
