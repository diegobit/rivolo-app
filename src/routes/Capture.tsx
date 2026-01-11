import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { buttonPrimary, buttonSecondary } from '../lib/ui'
import { useDaysStore } from '../store/useDaysStore'

export default function Capture() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { appendToToday } = useDaysStore()
  const [text, setText] = useState('')
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    const incoming = params.get('text') ?? ''
    setText(incoming)
  }, [params])

  const handleSave = async () => {
    if (!text.trim()) {
      setStatus('Nothing to save.')
      return
    }

    await appendToToday(text)
    setStatus('Saved to today.')
    navigate('/')
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-600">Capture</h2>
        <textarea
          className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-slate-400"
          rows={6}
          placeholder="Paste or share text here"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="mt-3 flex gap-2">
          <button className={buttonPrimary} onClick={handleSave}>
            Save to Today
          </button>
          <button className={buttonSecondary} onClick={() => navigate('/')}>
            Cancel
          </button>
        </div>
        {status && <p className="mt-2 text-xs text-slate-500">{status}</p>}
      </section>
    </div>
  )
}
