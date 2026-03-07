import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { completeDropboxAuth } from '../lib/dropbox'
import { useDropboxStore } from '../store/useDropboxStore'
import { useSyncStore } from '../store/useSyncStore'

export default function DropboxCallback() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { loadState: loadDropboxState } = useDropboxStore()
  const { setActiveProvider } = useSyncStore()
  const errorParam = searchParams.get('error_description') ?? searchParams.get('error')
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const initialError = errorParam ? `Dropbox auth failed: ${errorParam}` : code ? null : 'Missing Dropbox authorization code.'
  const [status, setStatus] = useState(initialError ? 'Dropbox connection could not be completed.' : 'Connecting to Dropbox...')
  const [error, setError] = useState<string | null>(initialError)

  useEffect(() => {
    if (initialError || !code) {
      return
    }

    void (async () => {
      try {
        await completeDropboxAuth(code, state)
        await loadDropboxState()
        await setActiveProvider('dropbox')
        setStatus('Dropbox connected. Redirecting...')
        navigate('/settings', { replace: true })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Dropbox connect failed.')
      }
    })()
  }, [code, initialError, loadDropboxState, navigate, setActiveProvider, state])

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
