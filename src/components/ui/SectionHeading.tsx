interface SectionHeadingProps {
  eyebrow?: string
  title: string
  description?: string
  align?: 'center' | 'left'
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = 'center',
}: SectionHeadingProps) {
  const isCenter = align === 'center'
  return (
    <div className={isCenter ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'}>
      {eyebrow && (
        <span className="mb-3 inline-block rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold tracking-wide text-[var(--accent)]">
          {eyebrow}
        </span>
      )}
      <h2 className="font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight text-[var(--ink)] sm:text-4xl">
        {title}
      </h2>
      {description && (
        <p className="mt-3 text-base text-[var(--ink-muted)] sm:text-lg">{description}</p>
      )}
    </div>
  )
}
