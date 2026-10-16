import type { ReactNode } from 'react'

type Segment<T extends string> = {
  value: T
  label: ReactNode
  ariaLabel: string
}

type SegmentedCapsuleProps<T extends string> = {
  label: string
  value: T
  segments: Segment<T>[]
  onChange: (value: T) => void
  className?: string
}

// The Chat | Search switch and the search result toggle share one capsule:
// a track, a thumb that slides between equal halves, and transparent buttons.
export default function SegmentedCapsule<T extends string>({
  label,
  value,
  segments,
  onChange,
  className,
}: SegmentedCapsuleProps<T>) {
  const index = Math.max(0, segments.findIndex((segment) => segment.value === value))

  return (
    <div role="group" aria-label={label} className={className ? `mode-capsule ${className}` : 'mode-capsule'}>
      <span
        className="mode-capsule-thumb"
        aria-hidden="true"
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {segments.map((segment) => (
        <button
          key={segment.value}
          type="button"
          className="mode-capsule-button"
          aria-pressed={segment.value === value}
          aria-label={segment.ariaLabel}
          onClick={() => onChange(segment.value)}
        >
          {segment.label}
        </button>
      ))}
    </div>
  )
}
