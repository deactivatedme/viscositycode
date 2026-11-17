// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
import glyphMaskUrl from "@/renderer/viscosity/brand/viscosity-glyph-mask.png";

/**
 * ViscosityCode: the small in-app product mark (model menus, composer summary,
 * experiment targets). Draws the fork's "V" logo silhouette in `currentColor`
 * through a CSS mask, so it follows text colour like the upstream glyph did.
 * The export name stays upstream's to keep call sites (and merges) unchanged.
 */
export function PoracodeGlyph({ className }: { className?: string | undefined }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block bg-current ${className ?? ""}`}
      style={{
        maskImage: `url(${glyphMaskUrl})`,
        maskSize: "contain",
        maskRepeat: "no-repeat",
        maskPosition: "center",
      }}
    />
  );
}
