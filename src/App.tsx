import { Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell'
import Capture from './routes/Capture.tsx'
import Chat from './routes/Chat.tsx'
import DayEditor from './routes/DayEditor.tsx'
import DropboxCallback from './routes/DropboxCallback.tsx'
import Search from './routes/Search.tsx'
import Settings from './routes/Settings.tsx'
import Timeline from './routes/Timeline.tsx'

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Timeline />} />
        <Route path="/day/:dayId" element={<DayEditor />} />
        <Route path="/search" element={<Search />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/auth/dropbox/callback" element={<DropboxCallback />} />
        <Route path="/capture" element={<Capture />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
