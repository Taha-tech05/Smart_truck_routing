import Map from './components/Map'
import { useHealth } from './hooks/useHealth'

export default function App() {
  const { data, isLoading } = useHealth()
  const connected = data?.status === 'ok'
  const label = isLoading ? 'Checking…' : connected ? 'Backend connected' : 'Backend disconnected'
  const color = isLoading ? 'bg-gray-400' : connected ? 'bg-green-500' : 'bg-red-500'

  return (
    <div className="relative h-full w-full">
      <Map />
      <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-md bg-white/90 px-3 py-1.5 text-sm shadow">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />
        {label}
      </div>
    </div>
  )
}
