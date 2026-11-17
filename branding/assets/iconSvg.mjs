// String transforms that derive every icon variant from the SVG masters, so
// the masters stay the only hand-edited source.

const TILE_USE = /<use xlink:href="#tile" fill="([^"]+)"\s*\/>/g;
const MASTER_SIZE_ATTRS = ' width="1024" height="1024"';
const XML_COMMENT = /\s*<!--[\s\S]*?-->/g;
const MASKABLE_BACKDROP = /<rect id="maskable-backdrop"([^>]*?) opacity="0"\s*\/>/;
const MARK_IMAGE = /<image data-mark="1"/;

/**
 * Maskable and apple-touch icons must be opaque corner to corner: the platform
 * applies its own mask, and transparency around the tile shows as a notch.
 * Every tile layer in the masters is a `<use>` of `#tile`; swapping each for a
 * full-bleed square keeps all fills (base, sheen, glow) as the backdrop.
 *
 * @param {string} source
 */
export function fullBleedSvg(source) {
  const bleed = source.replaceAll(TILE_USE, '<rect width="1024" height="1024" fill="$1"/>');
  if (bleed !== source) return bleed;
  // ViscosityCode: transparent-mark masters carry a hidden full-bleed backdrop
  // instead of tile layers. Reveal it and shrink the mark into the maskable
  // safe zone (the inner 80% circle).
  if (MASKABLE_BACKDROP.test(source)) {
    return source
      .replace(MASKABLE_BACKDROP, '<rect id="maskable-backdrop"$1 opacity="1"/>')
      .replace(
        MARK_IMAGE,
        '<image data-mark="1" transform="translate(512 512) scale(0.68) translate(-512 -512)"',
      );
  }
  throw new Error('master has no <use xlink:href="#tile"> layer or #maskable-backdrop to expand');
}

/**
 * The web favicon / PWA `any` icon: the master without authoring comments or
 * fixed pixel size, labelled for assistive tech.
 *
 * @param {string} source
 * @param {string} label
 */
export function publicIconSvg(source, label) {
  if (!source.includes(MASTER_SIZE_ATTRS)) {
    throw new Error("master is missing its 1024x1024 size attributes");
  }
  const safeLabel = label
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
  return source
    .replaceAll(XML_COMMENT, "")
    .replace(MASTER_SIZE_ATTRS, ` role="img" aria-label="${safeLabel}"`);
}

/**
 * Pin the monochrome glyph's `currentColor` (which renders black outside a DOM)
 * to a concrete colour.
 *
 * @param {string} source
 * @param {string} color
 */
export function tintGlyphSvg(source, color) {
  if (!source.includes('fill="currentColor"')) throw new Error("glyph has no currentColor fill");
  return source.replaceAll('fill="currentColor"', `fill="${color}"`);
}
