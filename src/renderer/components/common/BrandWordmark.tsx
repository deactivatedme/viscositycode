// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import { BRAND_NAME } from "@/shared/brand";

/**
 * ViscosityCode: the product halves of the wordmark, "Viscosity" + the accent
 * baseline dot + "Code" (upstream drew "Pora" · "code" the same way).
 */
const WORDMARK_LEAD = "Viscosity";
const WORDMARK_TAIL = "Code";

/**
 * The brand wordmark — lead + the accent baseline dot + tail.
 *
 * The dot is a real round SVG circle, not a typed period: Geist (like most
 * geometric sans) renders the "." glyph as a square. It's tuned to sit on the
 * baseline and inherits the theme accent, mirroring
 * `branding/brand-showcase.html`. Reads as the product name to assistive tech.
 */
export function BrandWordmark({ className }: { className?: string | undefined }) {
  return (
    <span className={className} aria-label={BRAND_NAME}>
      <span className="font-bold" aria-hidden="true">
        {WORDMARK_LEAD}
      </span>
      <svg
        viewBox="0 0 24 100"
        aria-hidden="true"
        className="ml-[0.1em] mr-[0.03em] inline-block h-[1em] w-[0.24em] overflow-visible align-baseline [fill:var(--accent)]"
      >
        <circle cx="12" cy="96" r="9" />
      </svg>
      <span className="font-semibold" aria-hidden="true">
        {WORDMARK_TAIL}
      </span>
    </span>
  );
}
