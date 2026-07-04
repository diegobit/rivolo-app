import type { SetupNotice } from '../../lib/setupAttention'

type SetupNoticeBannerProps = {
  notice: SetupNotice
  onOpen: () => void
  onDismiss: () => void
}

export default function SetupNoticeBanner({
  notice,
  onOpen,
  onDismiss,
}: SetupNoticeBannerProps) {
  return (
    <div className="flex overflow-hidden rounded-xl border border-amber-200 bg-amber-50 text-amber-800">
      <button
        type="button"
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-xs outline-none transition hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-300"
        onClick={onOpen}
      >
        <span className="min-w-0 flex-1">
          <span className="font-semibold">{notice.title}</span> — {notice.description}
        </span>
        <svg
          className="h-4 w-4 shrink-0"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M7.3 5.3a1 1 0 0 1 1.4 0l4 4a1 1 0 0 1 0 1.4l-4 4a1 1 0 0 1-1.42-1.4L10.58 10 7.3 6.7a1 1 0 0 1 0-1.4Z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      <button
        type="button"
        className="flex h-11 w-11 shrink-0 items-center justify-center border-l border-amber-200 text-lg outline-none transition hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-300"
        aria-label={`Dismiss ${notice.title}`}
        title="Dismiss reminder"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  )
}
