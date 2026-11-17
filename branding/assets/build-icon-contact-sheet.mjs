// Renders a labelled contact sheet of every installed icon asset so a change to
// the masters can be reviewed at a glance (ICO frames and ICNS members are
// decoded from the shipped containers, not re-rendered from SVG).
//   node branding/assets/build-icon-contact-sheet.mjs <out.png> [--root branding/assets/out]
import sharp from "sharp";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { iconutilCommand } from "./iconCheck.mjs";
import { readIcoEntries } from "./iconContainers.mjs";

const run = promisify(execFile);
const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

const SHEET_WIDTH = 1480;
const PAD = 24;
const GAP = 20;
const LABEL_HEIGHT = 34;
const TITLE_HEIGHT = 40;
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/** @param {string} text */
function escapeXml(text) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * @param {string} text
 * @param {number} width
 * @param {number} height
 * @param {{ size: number, color: string, weight?: number }} style
 */
function textPng(text, width, height, { size, color, weight = 400 }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <text x="0" y="${size}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${escapeXml(text)}</text>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * @param {Buffer} buf
 * @param {number} display
 * @param {"lanczos3" | "nearest"} [kernel]
 */
function scaled(buf, display, kernel = "lanczos3") {
  return sharp(buf)
    .resize(display, display, { fit: "contain", background: TRANSPARENT, kernel })
    .png()
    .toBuffer();
}

/**
 * Alpha-only template glyph drawn white, as macOS shows it on a dark menu bar.
 *
 * @param {Buffer} buf
 */
async function whiteTemplate(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let o = 0; o < data.length; o += 4) {
    data[o] = 255;
    data[o + 1] = 255;
    data[o + 2] = 255;
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

/**
 * Preview a maskable icon under the most aggressive platform mask (circle).
 *
 * @param {Buffer} buf
 * @param {number} display
 */
async function circleMasked(buf, display) {
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${display}" height="${display}"><circle cx="${display / 2}" cy="${display / 2}" r="${display / 2}" fill="#fff"/></svg>`,
  );
  return sharp(await scaled(buf, display))
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

/**
 * @param {string} root
 * @param {string} path
 */
function load(root, path) {
  return readFile(join(root, path));
}

/**
 * @param {string} root
 * @param {string} path
 * @param {number} maxDisplay
 * @param {{ zoom?: number }} [options]
 */
async function icoItems(root, path, maxDisplay, { zoom } = {}) {
  const items = [];
  for (const entry of readIcoEntries(await load(root, path))) {
    const display = Math.min(entry.width, maxDisplay);
    const shown = display === entry.width ? "" : ` (shown ${display})`;
    items.push({ label: `${entry.width}px${shown}`, buf: await scaled(entry.data, display) });
    if (zoom) {
      items.push({
        label: `${entry.width}px ×${zoom}`,
        buf: await scaled(entry.data, entry.width * zoom, "nearest"),
      });
    }
  }
  return items;
}

/**
 * @param {string} root
 * @param {string} path
 * @param {number} display
 */
async function icnsItem(root, path, display) {
  const stage = await mkdtemp(join(tmpdir(), "vc-icns-sheet-"));
  try {
    const iconset = join(stage, "sheet.iconset");
    await run(iconutilCommand(), ["-c", "iconset", join(root, path), "-o", iconset]);
    const member = await readFile(join(iconset, "icon_512x512@2x.png"));
    return { label: `${path} (1024 member)`, buf: await scaled(member, display) };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

/**
 * @param {string} root
 * @param {string} suffix
 * @param {string} title
 */
async function appRow(root, suffix, title) {
  const big = 168;
  const items = [
    {
      label: `icon${suffix}.png`,
      buf: await scaled(await load(root, `build/icon${suffix}.png`), big),
    },
    {
      label: `icon${suffix}-mac.png`,
      buf: await scaled(await load(root, `build/icon${suffix}-mac.png`), big),
    },
  ];
  if (process.platform === "darwin")
    items.push(await icnsItem(root, `build/icon${suffix}.icns`, big));
  for (const item of await icoItems(root, `build/icon${suffix}.ico`, 128)) {
    items.push({ ...item, label: `.ico ${item.label}` });
  }
  return { title, background: "#e7e7ec", ink: "#1b1b22", items };
}

/**
 * @param {string} root
 * @param {string} suffix
 * @param {string} title
 */
async function pwaRow(root, suffix, title) {
  const show = 136;
  const maskable = await load(root, `public/icons/icon${suffix}-maskable-512.png`);
  const svg = await load(root, `public/app-icon${suffix}.svg`);
  return {
    title,
    background: "#f4f4f7",
    ink: "#1b1b22",
    items: [
      {
        label: "icon-192",
        buf: await scaled(await load(root, `public/icons/icon${suffix}-192.png`), show),
      },
      {
        label: "icon-512",
        buf: await scaled(await load(root, `public/icons/icon${suffix}-512.png`), show),
      },
      { label: "maskable-512", buf: await scaled(maskable, show) },
      { label: "maskable (circle)", buf: await circleMasked(maskable, show) },
      {
        label: "apple-touch 180",
        buf: await scaled(await load(root, `public/icons/apple-touch-icon${suffix}.png`), show),
      },
      {
        label: `app-icon${suffix}.svg`,
        // The public SVG has only a 1024 viewBox: rasterise at 4x, then downsample.
        buf: await sharp(svg, { density: (72 * show * 4) / 1024 })
          .resize(show, show)
          .png()
          .toBuffer(),
      },
    ],
  };
}

/** @param {string} root */
async function trayRows(root) {
  const zoom = 3;
  const dark = [];
  for (const name of ["tray-icon", "tray-icon-nightly"]) {
    for (const item of await icoItems(root, `build/${name}.ico`, 32, { zoom })) {
      dark.push({ ...item, label: `${name} ${item.label}` });
    }
  }
  const light = [];
  for (const name of ["tray-icon-dark", "tray-icon-nightly-dark"]) {
    for (const item of await icoItems(root, `build/${name}.ico`, 32, { zoom })) {
      light.push({ ...item, label: `${name} ${item.label}` });
    }
  }
  const mac = [];
  const macDark = [];
  for (const [file, px] of [
    ["tray-icon-mac.png", 22],
    ["tray-icon-mac@2x.png", 44],
  ]) {
    const buf = await load(root, `build/${file}`);
    mac.push(
      { label: file, buf },
      { label: `${file} ×4`, buf: await scaled(buf, px * 4, "nearest") },
    );
    const white = await whiteTemplate(buf);
    macDark.push(
      { label: file, buf: white },
      { label: `${file} ×4`, buf: await scaled(white, px * 4, "nearest") },
    );
  }
  return [
    { title: "Windows tray · dark taskbar", background: "#202020", ink: "#f2f2f2", items: dark },
    { title: "Windows tray · light taskbar", background: "#f3f3f3", ink: "#1b1b22", items: light },
    { title: "macOS menu bar template · light", background: "#e9e9e9", ink: "#1b1b22", items: mac },
    {
      title: "macOS menu bar template · dark (system-tinted)",
      background: "#2b2b30",
      ink: "#f2f2f2",
      items: macDark,
    },
  ];
}

/**
 * Lay items out left to right, wrapping, with a label under each.
 *
 * @param {{ title: string, background: string, ink: string, items: { label: string, buf: Buffer }[] }} row
 */
async function renderRow(row) {
  const metas = await Promise.all(row.items.map((item) => sharp(item.buf).metadata()));
  const placements = [];
  let x = PAD;
  let y = TITLE_HEIGHT;
  let lineHeight = 0;
  row.items.forEach((item, index) => {
    // ~7px per character at the 12px label size keeps labels from clipping.
    const width = Math.max(metas[index].width ?? 0, item.label.length * 7 + 8, 96);
    const height = metas[index].height ?? 0;
    if (x + width > SHEET_WIDTH - PAD) {
      x = PAD;
      y += lineHeight + LABEL_HEIGHT + GAP;
      lineHeight = 0;
    }
    placements.push({ item, x, y, width, height });
    lineHeight = Math.max(lineHeight, height);
    x += width + GAP;
  });
  const rowHeight = y + lineHeight + LABEL_HEIGHT + GAP;
  const composites = [
    {
      input: await textPng(row.title, SHEET_WIDTH - PAD * 2, 30, {
        size: 20,
        color: row.ink,
        weight: 600,
      }),
      left: PAD,
      top: 10,
    },
  ];
  for (const { item, x: left, y: top, width, height } of placements) {
    composites.push({ input: item.buf, left, top });
    composites.push({
      input: await textPng(item.label, width, 20, { size: 12, color: row.ink }),
      left,
      top: top + height + 6,
    });
  }
  return sharp({
    create: { width: SHEET_WIDTH, height: rowHeight, channels: 4, background: row.background },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

async function main() {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf("--root");
  const root = rootIndex >= 0 ? resolve(args[rootIndex + 1] ?? ".") : REPO_ROOT;
  const rootArgs = rootIndex >= 0 ? [rootIndex, rootIndex + 1] : [];
  const outFile = args.find((_, index) => !rootArgs.includes(index));
  if (!outFile) throw new Error("usage: build-icon-contact-sheet.mjs <out.png> [--root <dir>]");

  const rows = [
    await appRow(root, "", "Desktop app icon · stable (build/)"),
    await appRow(root, "-nightly", "Desktop app icon · nightly (build/)"),
    await pwaRow(root, "", "Web / PWA · stable (public/)"),
    await pwaRow(root, "-nightly", "Web / PWA · nightly (public/)"),
    ...(await trayRows(root)),
  ];
  const rendered = await Promise.all(rows.map(renderRow));
  const heights = await Promise.all(
    rendered.map(async (buf) => (await sharp(buf).metadata()).height ?? 0),
  );
  const header = 64;
  const total = header + heights.reduce((sum, h) => sum + h, 0);
  const composites = [
    {
      input: await textPng("ViscosityCode icon set", SHEET_WIDTH - PAD * 2, 40, {
        size: 28,
        color: "#f4f4f7",
        weight: 700,
      }),
      left: PAD,
      top: 14,
    },
  ];
  let top = header;
  rendered.forEach((input, index) => {
    composites.push({ input, left: 0, top });
    top += heights[index];
  });
  await mkdir(dirname(resolve(outFile)), { recursive: true });
  await sharp({ create: { width: SHEET_WIDTH, height: total, channels: 4, background: "#0a0a0b" } })
    .composite(composites)
    .png()
    .toFile(resolve(outFile));
  console.log(`contact sheet → ${resolve(outFile)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
