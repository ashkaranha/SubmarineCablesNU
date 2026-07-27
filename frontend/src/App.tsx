import { BottomPanel } from './panel/BottomPanel'
import { Header } from './components/Header'
import { CableMap } from './map/CableMap'
import { IncidentRail } from './rail/IncidentRail'

function App() {
  return (
    <div className="fixed inset-0 overflow-hidden bg-[var(--bg)]">
      <div className="absolute inset-0 left-[340px]">
        <CableMap />
      </div>
      <IncidentRail />
      <Header />
      <BottomPanel />
    </div>
  )
}

export default App
