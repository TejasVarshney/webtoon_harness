/** The product's mark: a webtoon strip, three panels stacked for scrolling, the middle one inked in the accent. */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="1.5" width="14" height="6" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <rect x="5" y="9.5" width="14" height="6" rx="1.2" className="brand-mark-ink" />
      <rect x="5" y="17.5" width="14" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}
