import { create } from 'zustand'
import type {
  ActorTier,
  CableDetail,
  HoverInfo,
  IncidentListItem,
  IncidentMarker,
  IncidentQuery,
  IncidentSummary,
  InvestigationStatus,
  PanelMode,
} from '../types/api'

interface FlyTarget {
  latitude: number
  longitude: number
}

export type PanelTextSize = 'sm' | 'md' | 'lg'

interface UiState {
  theme: 'light' | 'dark'
  panelTextSize: PanelTextSize
  panelTextBold: boolean
  panelMode: PanelMode
  selectedCableName: string | null
  selectedIncidentId: string | null
  selectedGroupIncidentIds: string[]
  groupIncidents: IncidentListItem[]
  cableDetail: CableDetail | null
  incidentDetail: IncidentSummary | null
  hoverInfo: HoverInfo | null
  flyTarget: FlyTarget | null
  hideQuietCables: boolean
  fitBoundsRequestId: number
  query: IncidentQuery
  filteredIncidents: IncidentListItem[]
  filteredMarkers: IncidentMarker[]
  resultCount: number
  queryLoading: boolean
  setTheme: (theme: 'light' | 'dark') => void
  toggleTheme: () => void
  setPanelTextSize: (size: PanelTextSize) => void
  setPanelTextBold: (bold: boolean) => void
  toggleHideQuietCables: () => void
  requestFitBounds: () => void
  clearFitBoundsRequest: () => void
  setQuery: (patch: Partial<IncidentQuery>) => void
  toggleRegion: (region: string) => void
  toggleActorTier: (tier: ActorTier) => void
  toggleInvestigationStatus: (status: InvestigationStatus) => void
  toggleSuspectedCountry: (country: string) => void
  toggleCableType: (cableType: string) => void
  setFilteredResults: (incidents: IncidentListItem[], markers: IncidentMarker[]) => void
  setQueryLoading: (loading: boolean) => void
  openCablePanel: (name: string, detail: CableDetail) => void
  openIncidentPanel: (incident: IncidentSummary) => void
  openGroupPanel: (incidents: IncidentListItem[]) => void
  closePanel: () => void
  setHoverInfo: (info: HoverInfo | null) => void
  requestFlyTo: (latitude: number, longitude: number) => void
  clearFlyTarget: () => void
  selectIncidentFromList: (incident: IncidentListItem, detail: IncidentSummary) => void
}

const THEME_KEY = 'cableincidents-theme'
const HIDE_QUIET_KEY = 'cableincidents-hide-quiet-cables'
const PANEL_SIZE_KEY = 'cableincidents-panel-text-size'
const PANEL_BOLD_KEY = 'cableincidents-panel-text-bold'

const emptyQuery: IncidentQuery = {
  q: '',
  regions: [],
  actorTiers: [],
  investigationStatuses: [],
  suspectedCountries: [],
  cableTypes: [],
}

function readTheme(): 'light' | 'dark' {
  const stored = localStorage.getItem(THEME_KEY)
  return stored === 'dark' ? 'dark' : 'light'
}

function readPanelTextSize(): PanelTextSize {
  const stored = localStorage.getItem(PANEL_SIZE_KEY)
  return stored === 'sm' || stored === 'lg' ? stored : 'md'
}

function readPanelTextBold(): boolean {
  return localStorage.getItem(PANEL_BOLD_KEY) === 'true'
}

function readHideQuietCables(): boolean {
  const stored = localStorage.getItem(HIDE_QUIET_KEY)
  if (stored === null) {
    return true
  }
  return stored === 'true'
}

function toggleInList<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

export const useUiStore = create<UiState>((set, get) => ({
  theme: readTheme(),
  panelTextSize: readPanelTextSize(),
  panelTextBold: readPanelTextBold(),
  panelMode: 'closed',
  selectedCableName: null,
  selectedIncidentId: null,
  selectedGroupIncidentIds: [],
  groupIncidents: [],
  cableDetail: null,
  incidentDetail: null,
  hoverInfo: null,
  flyTarget: null,
  hideQuietCables: readHideQuietCables(),
  fitBoundsRequestId: 0,
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
  setPanelTextSize: (size) => {
    localStorage.setItem(PANEL_SIZE_KEY, size)
    set({ panelTextSize: size })
  },
  setPanelTextBold: (bold) => {
    localStorage.setItem(PANEL_BOLD_KEY, String(bold))
    set({ panelTextBold: bold })
  },
  toggleHideQuietCables: () => {
    const next = !get().hideQuietCables
    localStorage.setItem(HIDE_QUIET_KEY, String(next))
    set({ hideQuietCables: next })
  },
  requestFitBounds: () => set({ fitBoundsRequestId: get().fitBoundsRequestId + 1 }),
  clearFitBoundsRequest: () => set({ fitBoundsRequestId: 0 }),
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
  toggleInvestigationStatus: (status) =>
    set({
      query: {
        ...get().query,
        investigationStatuses: toggleInList(get().query.investigationStatuses, status),
      },
    }),
  toggleSuspectedCountry: (country) =>
    set({
      query: {
        ...get().query,
        suspectedCountries: toggleInList(get().query.suspectedCountries, country),
      },
    }),
  toggleCableType: (cableType) =>
    set({
      query: {
        ...get().query,
        cableTypes: toggleInList(get().query.cableTypes, cableType),
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
      incidentDetail: null,
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
