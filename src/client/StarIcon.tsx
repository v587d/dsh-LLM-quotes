/**
 * Custom star icon for the watchlist feature.
 *
 * The dsh icon library has no star or heart glyph, so this small inline SVG
 * provides the universally-recognized ★ / ☆ shapes for watchlist toggling.
 * @module dsh-llm-quotes/client/StarIcon
 */

export interface StarIconProps {
  /** Icon width & height in pixels (default 16). */
  size?: number
  /** Optional extra class name. */
  className?: string
  /** When true, renders a filled star; otherwise an outline star. */
  filled?: boolean
}

/**
 * Inline SVG star icon. Uses `currentColor` so it inherits text color
 * from the parent element — no hardcoded palette.
 */
export function StarIcon({ size = 16, className, filled = false }: StarIconProps) {
  // 5-point star path (viewBox 0 0 24 24, centered, slightly rounded tips).
  const d = 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  )
}
