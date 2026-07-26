import { useEffect } from 'react'
import { fetchIncident } from '../api/client'
import { useUiStore } from '../store/uiStore'
import type { IncidentSummary } from '../types/api'
import { CableView } from './CableView'
import { IncidentView } from './IncidentView'

export function BottomPanel() {
  const panelMode = useUiStore((state) => state.panelMode)
  const cableDetail = useUiStore((state) => state.cableDetail)
  const incidentDetail = useUiStore((state) => state.incidentDetail)
  const groupIncidents = useUiStore((state) => state.groupIncidents)
  const closePanel = useUiStore((state) => state.closePanel)
  const openIncidentPanel = useUiStore((state) => state.openIncidentPanel)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePanel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closePanel])

  if (panelMode === 'closed') {
    return null
  }

  const handleSelectIncident = (incident: IncidentSummary) => {
    if (incident.latitude != null && incident.longitude != null) {
      useUiStore.getState().requestFlyTo(incident.latitude, incident.longitude)
    }
    openIncidentPanel(incident)
  }

  const handleSelectGroupedIncident = async (incidentId: string) => {
    const incident = await fetchIncident(incidentId)
    if (incident.latitude != null && incident.longitude != null) {
      useUiStore.getState().requestFlyTo(incident.latitude, incident.longitude)
    }
    openIncidentPanel(incident)
  }

  return (
    <section className="pointer-events-auto absolute bottom-0 left-[340px] right-0 z-30 border-t border-[var(--border)] bg-[var(--surface)] shadow-[0_-1px_0_var(--shadow)]">
      <div className="mx-auto max-w-5xl px-6 py-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
            {panelMode === 'cable' ? 'Cable' : panelMode === 'group' ? 'Incidents' : 'Incident'}
          </p>
          <button
            type="button"
            onClick={closePanel}
            className="border border-[var(--border)] px-3 py-1 text-sm text-[var(--muted)] hover:text-[var(--text)]"
            aria-label="Close panel"
          >
            Close
          </button>
        </div>

        {panelMode === 'cable' && cableDetail && (
          <CableView cable={cableDetail} onSelectIncident={handleSelectIncident} />
        )}

        {panelMode === 'incident' && incidentDetail && <IncidentView incident={incidentDetail} />}

        {panelMode === 'group' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Multiple incidents at this location</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Select an incident to view details.
              </p>
            </div>
            <div className="space-y-2">
              {groupIncidents.map((incident) => (
                <button
                  key={incident.id}
                  type="button"
                  onClick={() => void handleSelectGroupedIncident(incident.id)}
                  className="flex w-full items-center justify-between border border-[var(--border)] bg-[var(--bg)] px-3 py-3 text-left hover:border-[var(--text)]"
                >
                  <div>
                    <p className="text-sm font-medium">{incident.original_cable_name}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {incident.date} · {incident.region}
                    </p>
                  </div>
                  <span className="text-xs text-[var(--muted)]">{incident.status || '—'}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
