import { Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell'
import DropboxCallback from './routes/DropboxCallback.tsx'
import Privacy from './routes/Privacy.tsx'
import Settings from './routes/Settings.tsx'
import Timeline from './routes/Timeline.tsx'

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Timeline />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/auth/dropbox/callback" element={<DropboxCallback />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
