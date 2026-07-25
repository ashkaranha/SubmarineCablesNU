import { BottomPanel } from './panel/BottomPanel'
import { Header } from './components/Header'
import { CableMap } from './map/CableMap'

function App() {
  return (
    <div className="fixed inset-0 overflow-hidden bg-[var(--bg)]">
      <CableMap />
      <Header />
      <BottomPanel />
    </div>
  )
}

export default App
