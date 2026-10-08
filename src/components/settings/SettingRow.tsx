// One settings row: label on the left, control on the right. Wide controls
// wrap under the label on narrow screens instead of overflowing.
export default function SettingRow({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor?: string
  children: React.ReactNode
}) {
  const Label = htmlFor ? 'label' : 'span'
  return (
    <div className="flex min-h-[52px] flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2">
      <Label htmlFor={htmlFor} className="text-sm font-medium text-[var(--theme-text-soft)]">
        {label}
      </Label>
      {children}
    </div>
  )
}
