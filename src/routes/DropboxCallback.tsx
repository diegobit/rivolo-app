import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { completeDropboxAuth } from '../lib/dropbox'
import { useDropboxStore } from '../store/useDropboxStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { useSyncStore } from '../store/useSyncStore'

export default function DropboxCallback() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { passcode, loadSettings } = useSettingsStore()
  const { loadState: loadDropboxState } = useDropboxStore()
  const { setActiveProvider } = useSyncStore()
  const [status, setStatus] = useState('Connecting to Dropbox...')
  const [error, setError] = useState<string | null>(null)
  const [settingsReady, setSettingsReady] = useState(false)

  useEffect(() => {
    void (async () => {
      await loadSettings()
      setSettingsReady(true)
    })()
  }, [loadSettings])

  useEffect(() => {
    if (!settingsReady) return

    const errorParam = searchParams.get('error_description') ?? searchParams.get('error')
    if (errorParam) {
      setError(`Dropbox auth failed: ${errorParam}`)
      return
    }

    const code = searchParams.get('code')
    const state = searchParams.get('state')
    if (!code) {
      setError('Missing Dropbox authorization code.')
      return
    }

    if (!passcode.trim()) {
      setError('Set a passcode before connecting Dropbox.')
      return
    }

    void (async () => {
      try {
        await completeDropboxAuth(passcode, code, state)
        await loadDropboxState()
        await setActiveProvider('dropbox')
        setStatus('Dropbox connected. Redirecting...')
        navigate('/settings', { replace: true })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Dropbox connect failed.')
      }
    })()
  }, [loadDropboxState, navigate, passcode, searchParams, setActiveProvider, settingsReady])

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-600">Dropbox Connect</h2>
      <p className="mt-3 text-sm text-slate-500">{error ?? status}</p>
      {!error && (
        <p className="mt-2 text-xs text-slate-400">You can close this tab if it does not redirect.</p>
      )}
    </section>
  )
}
