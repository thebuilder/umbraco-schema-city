/*
 * Stands in for a slide that is still being built, so the deck runs end to end
 * and the timing can be rehearsed before every visual exists. Each part file
 * renders one of these until its own visual replaces it.
 */
export function Placeholder({
  label,
  shows,
}: {
  label: string
  shows: string
}) {
  return (
    <section
      className="flex h-full flex-col justify-center gap-10 px-[var(--slide-padding-inline)]"
      data-slide-surface=""
    >
      <p className="font-semibold text-[length:var(--slide-label-size)] text-muted-foreground uppercase tracking-[var(--slide-label-tracking)]">
        {`todo :: ${label}`}
      </p>
      <p className="max-w-[1500px] text-balance text-[length:var(--slide-heading-size)] text-primary leading-[1.15]">
        {shows}
      </p>
    </section>
  )
}
