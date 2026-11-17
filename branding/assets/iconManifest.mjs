// Every icon file the repo ships, with the names, pixel sizes and container
// layouts that packaging, the tray, the Dock refresh, and the PWA expect.
// build-icons.mjs writes these paths under out/ (mirroring the repo layout),
// --install copies them into place, and --check verifies them.

/** Windows app icon frames, largest first (PNG-compressed entries). */
export const APP_ICO_SIZES = [256, 128, 64, 48, 32, 24, 16];

/** Windows notification-area frames (100%-200% DPI for a 16px slot). */
export const TRAY_ICO_SIZES = [16, 20, 24, 32];

/** `.iconset` members iconutil turns into ICNS, as [file name, pixel size]. */
export const ICNSET_MEMBERS = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
];

/** Image chunks iconutil writes for the iconset above. */
export const ICNS_IMAGE_CHUNKS = [
  "ic04",
  "ic05",
  "ic07",
  "ic08",
  "ic09",
  "ic10",
  "ic11",
  "ic12",
  "ic13",
  "ic14",
];

/** Opaque-pixel box of a 1024px runtime Dock PNG padded by macSafeAreaIcon.mjs. */
export const MAC_SAFE_AREA_BBOX = { minX: 100, minY: 100, maxX: 923, maxY: 923 };

/**
 * @typedef {{
 *   path: string,
 *   kind: "png" | "ico" | "icns" | "svg",
 *   size?: number,
 *   frames?: readonly number[],
 *   bbox?: "full" | "mac" | "mark" | "withinMac",
 *   opaque?: boolean,
 *   template?: boolean,
 *   label?: string,
 * }} IconAssetSpec
 */

/**
 * @param {{ stable: string, nightly: string }} labels product names for the SVG aria-labels
 * @returns {IconAssetSpec[]}
 */
export function installedIconAssets(labels) {
  /** @type {IconAssetSpec[]} */
  const assets = [];
  for (const suffix of ["", "-nightly"]) {
    assets.push(
      { path: `build/icon${suffix}.png`, kind: "png", size: 1024, bbox: "mark" },
      { path: `build/icon${suffix}-mac.png`, kind: "png", size: 1024, bbox: "withinMac" },
      { path: `build/icon${suffix}.ico`, kind: "ico", frames: APP_ICO_SIZES },
      { path: `build/icon${suffix}.icns`, kind: "icns" },
      { path: `build/tray-icon${suffix}.ico`, kind: "ico", frames: TRAY_ICO_SIZES },
      { path: `build/tray-icon${suffix}-dark.ico`, kind: "ico", frames: TRAY_ICO_SIZES },
      { path: `public/icons/icon${suffix}-192.png`, kind: "png", size: 192, bbox: "mark" },
      { path: `public/icons/icon${suffix}-512.png`, kind: "png", size: 512, bbox: "mark" },
      { path: `public/icons/icon${suffix}-maskable-512.png`, kind: "png", size: 512, opaque: true },
      { path: `public/icons/apple-touch-icon${suffix}.png`, kind: "png", size: 180, opaque: true },
      {
        path: `public/app-icon${suffix}.svg`,
        kind: "svg",
        label: suffix ? labels.nightly : labels.stable,
      },
    );
  }
  // The menu-bar template is channel-neutral: macOS tints it per appearance.
  assets.push(
    { path: "build/tray-icon-mac.png", kind: "png", size: 22, template: true },
    { path: "build/tray-icon-mac@2x.png", kind: "png", size: 44, template: true },
  );
  return assets;
}
