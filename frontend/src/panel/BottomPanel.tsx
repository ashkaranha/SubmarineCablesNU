import { useEffect } from 'react'
import { fetchIncident } from '../api/client'
import { IncidentMarkerDot } from '../map/IncidentMarkerDot'
import { useUiStore, type PanelTextSize } from '../store/uiStore'
import type { IncidentSummary } from '../types/api'
import { CableView } from './CableView'
import { IncidentView } from './IncidentView'

const TEXT_SIZES: PanelTextSize[] = ['sm', 'md', 'lg']

export function BottomPanel() {
  const panelMode = useUiStore((state) => state.panelMode)
  const cableDetail = useUiStore((state) => state.cableDetail)
  const incidentDetail = useUiStore((state) => state.incidentDetail)
  const groupIncidents = useUiStore((state) => state.groupIncidents)
  const closePanel = useUiStore((state) => state.closePanel)
  const openIncidentPanel = useUiStore((state) => state.openIncidentPanel)
  const panelTextSize = useUiStore((state) => state.panelTextSize)
  const panelTextBold = useUiStore((state) => state.panelTextBold)
  const setPanelTextSize = useUiStore((state) => state.setPanelTextSize)
  const setPanelTextBold = useUiStore((state) => state.setPanelTextBold)

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
    <section className="pointer-events-auto absolute bottom-0 left-[340px] right-0 z-30 flex max-h-[min(55vh,32rem)] flex-col border-t border-[var(--border)] bg-[var(--surface)] shadow-[0_-1px_0_var(--shadow)]">
      <div className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-6 py-6">
        <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
            {panelMode === 'cable' ? 'Cable' : panelMode === 'group' ? 'Incidents' : 'Incident'}
          </p>
          <div className="flex items-center gap-2">
            <div className="flex border border-[var(--border)]" role="group" aria-label="Text size">
              {TEXT_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => setPanelTextSize(size)}
                  className={`px-2 py-1 text-xs font-medium uppercase ${
                    panelTextSize === size
                      ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                      : 'text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                  aria-pressed={panelTextSize === size}
                >
                  {size === 'sm' ? 'S' : size === 'md' ? 'M' : 'L'}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setPanelTextBold(!panelTextBold)}
              className={`border px-2 py-1 text-xs font-semibold ${
                panelTextBold
                  ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)]'
                  : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]'
              }`}
              aria-pressed={panelTextBold}
            >
              Bold
            </button>
            <button
              type="button"
              onClick={closePanel}
              className="border border-[var(--border)] px-3 py-1 text-sm text-[var(--muted)] hover:text-[var(--text)]"
              aria-label="Close panel"
            >
              Close
            </button>
          </div>
        </div>

        <div
          className="panel-type min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1"
          data-panel-size={panelTextSize}
          data-panel-bold={panelTextBold ? 'true' : 'false'}
          onWheel={(event) => event.stopPropagation()}
        >
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
                    className="flex w-full items-center gap-3 border border-[var(--border)] bg-[var(--bg)] px-3 py-3 text-left hover:border-[var(--text)]"
                  >
                    <IncidentMarkerDot
                      marker_fill={incident.marker_fill}
                      status_stroke={incident.status_stroke}
                      actor_tier={incident.actor_tier}
                      status={incident.status}
                      size="md"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{incident.original_cable_name}</p>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {incident.date} · {incident.region}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-[var(--muted)]">{incident.status || '—'}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
