import { create } from 'zustand'
import type {
  ActorTier,
  CableDetail,
  HoverInfo,
  IncidentListItem,
  IncidentQuery,
  IncidentSummary,
  MarkerGroup,
  PanelMode,
  StatusFilter,
} from '../types/api'

interface FlyTarget {
  latitude: number
  longitude: number
}

interface UiState {
  theme: 'light' | 'dark'
  panelMode: PanelMode
  selectedCableName: string | null
  selectedIncidentId: string | null
  selectedGroupIncidentIds: string[]
  groupIncidents: IncidentSummary[]
  cableDetail: CableDetail | null
  incidentDetail: IncidentSummary | null
  hoverInfo: HoverInfo | null
  flyTarget: FlyTarget | null
  query: IncidentQuery
  filteredIncidents: IncidentListItem[]
  filteredMarkers: MarkerGroup[]
  resultCount: number
  queryLoading: boolean
  setTheme: (theme: 'light' | 'dark') => void
  toggleTheme: () => void
  setQuery: (patch: Partial<IncidentQuery>) => void
  toggleRegion: (region: string) => void
  toggleActorTier: (tier: ActorTier) => void
  setStatusFilter: (status: StatusFilter | null) => void
  setFilteredResults: (incidents: IncidentListItem[], markers: MarkerGroup[]) => void
  setQueryLoading: (loading: boolean) => void
  openCablePanel: (name: string, detail: CableDetail) => void
  openIncidentPanel: (incident: IncidentSummary) => void
  openGroupPanel: (incidents: IncidentSummary[]) => void
  closePanel: () => void
  setHoverInfo: (info: HoverInfo | null) => void
  requestFlyTo: (latitude: number, longitude: number) => void
  clearFlyTarget: () => void
  selectIncidentFromList: (incident: IncidentListItem, detail: IncidentSummary) => void
}

const THEME_KEY = 'cableincidents-theme'

const emptyQuery: IncidentQuery = {
  q: '',
  regions: [],
  actorTiers: [],
  status: null,
}

function readTheme(): 'light' | 'dark' {
  const stored = localStorage.getItem(THEME_KEY)
  return stored === 'dark' ? 'dark' : 'light'
}

function toggleInList<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

export const useUiStore = create<UiState>((set, get) => ({
  theme: readTheme(),
  panelMode: 'closed',
  selectedCableName: null,
  selectedIncidentId: null,
  selectedGroupIncidentIds: [],
  groupIncidents: [],
  cableDetail: null,
  incidentDetail: null,
  hoverInfo: null,
  flyTarget: null,
  query: emptyQuery,
  filteredIncidents: [],
  filteredMarkers: [],
  resultCount: 0,
  queryLoading: false,
  setTheme: (theme) => {
    localStorage.setItem(THEME_KEY, theme)
    document.documentElement.classList.toggle('dark', theme === 'dark')
    set({ theme })
  },
  toggleTheme: () => {
    const next = get().theme === 'light' ? 'dark' : 'light'
    get().setTheme(next)
  },
  setQuery: (patch) => set({ query: { ...get().query, ...patch } }),
  toggleRegion: (region) =>
    set({
      query: {
        ...get().query,
        regions: toggleInList(get().query.regions, region),
      },
    }),
  toggleActorTier: (tier) =>
    set({
      query: {
        ...get().query,
        actorTiers: toggleInList(get().query.actorTiers, tier),
      },
    }),
  setStatusFilter: (status) =>
    set({
      query: {
        ...get().query,
        status: get().query.status === status ? null : status,
      },
    }),
  setFilteredResults: (incidents, markers) =>
    set({
      filteredIncidents: incidents,
      filteredMarkers: markers,
      resultCount: incidents.length,
      queryLoading: false,
    }),
  setQueryLoading: (loading) => set({ queryLoading: loading }),
  openCablePanel: (name, detail) =>
    set({
      panelMode: 'cable',
      selectedCableName: name,
      selectedIncidentId: null,
      selectedGroupIncidentIds: [],
      groupIncidents: [],
      cableDetail: detail,
      incidentDetail: null,
      hoverInfo: null,
    }),
  openIncidentPanel: (incident) =>
    set({
      panelMode: 'incident',
      selectedIncidentId: incident.id,
      selectedCableName: incident.canonical_cable_name,
      selectedGroupIncidentIds: [],
      groupIncidents: [],
      incidentDetail: incident,
      hoverInfo: null,
    }),
  openGroupPanel: (incidents) =>
    set({
      panelMode: 'group',
      selectedGroupIncidentIds: incidents.map((incident) => incident.id),
      groupIncidents: incidents,
      selectedIncidentId: null,
      incidentDetail: incidents[0] ?? null,
      hoverInfo: null,
    }),
  closePanel: () =>
    set({
      panelMode: 'closed',
      selectedCableName: null,
      selectedIncidentId: null,
      selectedGroupIncidentIds: [],
      groupIncidents: [],
      cableDetail: null,
      incidentDetail: null,
    }),
  setHoverInfo: (info) => set({ hoverInfo: info }),
  requestFlyTo: (latitude, longitude) => set({ flyTarget: { latitude, longitude } }),
  clearFlyTarget: () => set({ flyTarget: null }),
  selectIncidentFromList: (incident, detail) => {
    if (incident.latitude != null && incident.longitude != null) {
      set({ flyTarget: { latitude: incident.latitude, longitude: incident.longitude } })
    }
    get().openIncidentPanel(detail)
  },
}))

document.documentElement.classList.toggle('dark', readTheme() === 'dark')
