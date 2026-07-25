import { create } from 'zustand'
import type { CableDetail, HoverInfo, IncidentSummary, PanelMode } from '../types/api'

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
  setTheme: (theme: 'light' | 'dark') => void
  toggleTheme: () => void
  openCablePanel: (name: string, detail: CableDetail) => void
  openIncidentPanel: (incident: IncidentSummary) => void
  openGroupPanel: (incidents: IncidentSummary[]) => void
  closePanel: () => void
  setHoverInfo: (info: HoverInfo | null) => void
  requestFlyTo: (latitude: number, longitude: number) => void
  clearFlyTarget: () => void
}

const THEME_KEY = 'cableincidents-theme'

function readTheme(): 'light' | 'dark' {
  const stored = localStorage.getItem(THEME_KEY)
  return stored === 'dark' ? 'dark' : 'light'
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
  setTheme: (theme) => {
    localStorage.setItem(THEME_KEY, theme)
    document.documentElement.classList.toggle('dark', theme === 'dark')
    set({ theme })
  },
  toggleTheme: () => {
    const next = get().theme === 'light' ? 'dark' : 'light'
    get().setTheme(next)
  },
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
}))

document.documentElement.classList.toggle('dark', readTheme() === 'dark')
