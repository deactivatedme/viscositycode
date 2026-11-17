// Builds the ViscosityCode SVG icon masters from the owner-supplied raster "V"
// logo (branding/assets/viscositycode-logo.png, transparent PNG). The owner
// wants the logo on its own with a transparent background — no tile — so the
// masters draw only the mark. A hidden #maskable-backdrop rect lets
// build-icons.mjs make the two formats that platforms require to be opaque
// (PWA maskable + apple-touch) without changing the regular icons.
// Writes viscositycode-icon.svg, viscositycode-icon-nightly.svg (amber hue) and
// viscositycode-glyph.svg (currentColor silhouette for tray/menu-bar). Then run
// build-icons.mjs --install to regenerate every installed asset.
//   node branding/assets/build-icon-masters.mjs [logo.png] [out-dir]
import sharp from "sharp";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const HERE = fileURLToPath(new URL(".", import.meta.url));
const [logoPath = `${HERE}viscositycode-logo.png`, outDir = HERE.replace(/\/$/, "")] =
  process.argv.slice(2);

const meta = await sharp(logoPath).metadata();
const ratio = meta.height / meta.width; // ~0.856
const EMBED_W = 960;
const embedH = Math.round(EMBED_W * ratio);

async function dataUri(pipeline) {
  const buf = await pipeline
    .resize(EMBED_W, embedH)
    .png({ compressionLevel: 9, palette: true, quality: 92, effort: 10 })
    .toBuffer();
  return { uri: `data:image/png;base64,${buf.toString("base64")}`, bytes: buf.length };
}
const stable = await dataUri(sharp(logoPath));
const nightly = await dataUri(sharp(logoPath).modulate({ hue: 135, saturation: 1.15 }));
// White silhouette (alpha preserved) so the glyph works as a luminance mask.
const { data, info } = await sharp(logoPath)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
for (let i = 0; i < data.length; i += 4) {
  data[i] = 255;
  data[i + 1] = 255;
  data[i + 2] = 255;
}
const silhouette = await dataUri(
  sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }),
);

// Mark placement on the transparent 1024 canvas: ~86% wide, optically
// centred (the V's mass sits high, so nudge it down a touch).
const W = 880,
  H = Math.round(W * ratio),
  X = Math.round((1024 - W) / 2),
  Y = Math.round((1024 - H) / 2) + 10;

const master = (
  variant,
  backdrop,
  img,
) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1024 1024" width="1024" height="1024">
  <!-- ViscosityCode app icon (${variant}). The owner-supplied flowing "V" logo
       (branding/assets/viscositycode-logo.png) on a transparent background.
       #maskable-backdrop stays invisible; build-icons.mjs reveals it only for
       the PWA maskable / apple-touch icons, which platforms require opaque. -->
  <rect id="maskable-backdrop" width="1024" height="1024" fill="${backdrop}" opacity="0"/>
  <image data-mark="1" x="${X}" y="${Y}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid meet" xlink:href="${img.uri}"/>
</svg>
`;
await writeFile(`${outDir}/viscositycode-icon.svg`, master("stable", "#0a0a0b", stable));
await writeFile(`${outDir}/viscositycode-icon-nightly.svg`, master("nightly", "#0b0807", nightly));

// Glyph: square viewBox around the mark, filled with currentColor through the
// silhouette mask, so tintGlyphSvg can recolour it for tray/menu-bar use.
const side = info.width; // mark is wider than tall; square it on width
const glyphH = Math.round(side * ratio);
const off = Math.round((side - glyphH) / 2);
const glyph = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${side} ${side}" width="${side}" height="${side}">
  <!-- Tile-less ViscosityCode "V" silhouette for monochrome contexts (tray,
       menu-bar template). The logo's alpha is used as a mask over a
       currentColor fill so tintGlyphSvg can recolour it. -->
  <defs>
    <mask id="v" maskUnits="userSpaceOnUse" x="0" y="0" width="${side}" height="${side}">
      <image x="0" y="${off}" width="${side}" height="${glyphH}" xlink:href="${silhouette.uri}"/>
    </mask>
  </defs>
  <rect width="${side}" height="${side}" fill="currentColor" mask="url(#v)"/>
</svg>
`;
await writeFile(`${outDir}/viscositycode-glyph.svg`, glyph);
console.log({
  stable: stable.bytes,
  nightly: nightly.bytes,
  silhouette: silhouette.bytes,
  placement: { X, Y, W, H },
});
