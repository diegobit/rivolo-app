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
    <div className="mx-3 flex overflow-hidden rounded-xl border border-amber-200 bg-amber-50 text-amber-800 sm:mx-0">
      <button
        type="button"
        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 px-4 py-2 text-left text-xs outline-none transition hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-300"
        onClick={onOpen}
      >
        <svg
          className="h-4 w-4 shrink-0 opacity-80"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <circle cx="10" cy="10" r="7.5" />
          <path strokeLinecap="round" d="M10 6.5v4.25" />
          <circle cx="10" cy="13.5" r="0.75" fill="currentColor" stroke="none" />
        </svg>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{notice.title}</span>
          <span className="mt-0.5 block">{notice.description}</span>
        </span>
      </button>
      <button
        type="button"
        className="flex w-11 shrink-0 self-stretch items-center justify-center outline-none transition hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-300"
        aria-label={`Open ${notice.title}`}
        onClick={onOpen}
      >
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
        className="flex w-11 shrink-0 self-stretch items-center justify-center outline-none transition hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-300"
        aria-label={`Dismiss ${notice.title}`}
        title="Dismiss reminder"
        onClick={onDismiss}
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M4.3 4.3a1 1 0 0 1 1.4 0l4.3 4.29 4.3-4.3a1 1 0 1 1 1.4 1.42L11.42 10l4.3 4.3a1 1 0 0 1-1.42 1.4L10 11.42l-4.3 4.3a1 1 0 0 1-1.4-1.42L8.58 10l-4.3-4.3a1 1 0 0 1 .02-1.4Z" />
        </svg>
      </button>
    </div>
  )
}
