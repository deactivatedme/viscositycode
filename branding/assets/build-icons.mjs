// Modified for ViscosityCode (fork of Poracode). See FORK_CHANGES.md.
// Renders the ViscosityCode SVG masters into every production icon asset.
// Uses the repo's `sharp` for SVG->PNG, macOS `iconutil` for .icns, and the
// PNG-in-ICO packer in iconContainers.mjs for .ico. Outputs mirror the repo
// layout under branding/assets/out/. Run from the repo root:
//   node branding/assets/build-icons.mjs              render every section into out/ and verify it
//   node branding/assets/build-icons.mjs pwa          render one section (build|tray|website|pwa|extension)
//   node branding/assets/build-icons.mjs --install    render, verify, copy into build/ + public/, re-verify
//   node branding/assets/build-icons.mjs --check      verify the installed build/ + public/ assets only
//
// ViscosityCode: replaces upstream's Poracode masters with the fork's own
// droplet mark. The upstream poracode-*.svg masters stay in this folder for
// build-native-assets.mjs (the native iOS/Android apps are not rebranded).
import sharp from "sharp";
import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { BRAND_NAME, BRAND_NAME_NIGHTLY } from "../../src/shared/brand.ts";
import { checkIconAssets, iconutilCommand } from "./iconCheck.mjs";
import { buildIco } from "./iconContainers.mjs";
import {
  APP_ICO_SIZES,
  ICNSET_MEMBERS,
  TRAY_ICO_SIZES,
  installedIconAssets,
} from "./iconManifest.mjs";
import { fullBleedSvg, publicIconSvg, tintGlyphSvg } from "./iconSvg.mjs";
import { padToMacSafeArea } from "./macSafeAreaIcon.mjs";

const run = promisify(execFile);

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const OUT = join(HERE, "out");

const MASTERS = {
  stable: join(HERE, "viscositycode-icon.svg"),
  nightly: join(HERE, "viscositycode-icon-nightly.svg"),
  glyph: join(HERE, "viscositycode-glyph.svg"),
};

const CHANNELS = [
  { suffix: "", master: MASTERS.stable, label: BRAND_NAME },
  { suffix: "-nightly", master: MASTERS.nightly, label: BRAND_NAME_NIGHTLY },
];

const INSTALLED = installedIconAssets({ stable: BRAND_NAME, nightly: BRAND_NAME_NIGHTLY });

// Windows draws the tray glyph straight onto the theme-coloured taskbar with no
// template-image support, so each channel ships two single-colour droplets:
// the default for dark taskbars and `-dark` (dark ink) for light ones. Nightly
// keeps the amber identity so the two channels stay distinguishable.
const TRAY_VARIANTS = [
  { name: "tray-icon", color: "#EEF0FA" },
  { name: "tray-icon-dark", color: "#0A0A0B" },
  { name: "tray-icon-nightly", color: "#FBBF24" },
  { name: "tray-icon-nightly-dark", color: "#C2410C" },
];

/**
 * Render an SVG to a square PNG. Rasterise at up to 4x the target and
 * downsample with Lanczos so small sizes keep clean anti-aliased edges.
 *
 * @param {Buffer} svg
 * @param {number} size
 */
async function png(svg, size) {
  const { width = 1024 } = await sharp(svg).metadata();
  const renderPx = Math.min(Math.max(size * 4, 256), 4096);
  return sharp(svg, { density: (72 * renderPx) / width })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// app.dock.setIcon() displays a supplied PNG literally, so a full-bleed asset
// visibly grows when the app launches. Pad it into the macOS optical safe area
// (shared with scripts/make-nightly-icon.mjs).
/** @param {Buffer} svg */
async function macPng(svg) {
  return padToMacSafeArea(sharp(await png(svg, 1024)), 1024)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * @param {Buffer} svg
 * @param {readonly number[]} sizes
 */
async function ico(svg, sizes) {
  const frames = [];
  for (const size of sizes) frames.push({ size, buf: await png(svg, size) });
  return buildIco(frames);
}

/**
 * @param {Buffer} svg
 * @param {string} outFile
 */
async function icns(svg, outFile) {
  if (process.platform !== "darwin") {
    throw new Error("the build section needs macOS iconutil for .icns; run `tray`/`pwa` elsewhere");
  }
  const set = outFile.replace(/\.icns$/, ".iconset");
  await rm(set, { recursive: true, force: true });
  await mkdir(set, { recursive: true });
  for (const [name, px] of ICNSET_MEMBERS) await writeFile(join(set, name), await png(svg, px));
  await run(iconutilCommand(), ["-c", "icns", set, "-o", outFile]);
  await rm(set, { recursive: true, force: true });
}

/**
 * Desktop app icons for one channel. The bundle ICNS and the Windows/Linux
 * PNG/ICO stay full-bleed (as upstream ships them); only the runtime Dock PNG
 * is padded.
 *
 * @param {{ suffix: string, master: string }} channel
 * @param {string} dir
 */
async function buildAppIcons({ suffix, master }, dir) {
  const name = `icon${suffix}`;
  const svg = await readFile(master);
  await mkdir(dir, { recursive: true });
  for (const size of [1024, 512, 256, 128, 64, 48, 32, 24, 16]) {
    await writeFile(join(dir, `${name}-${size}.png`), await png(svg, size));
  }
  await writeFile(join(dir, `${name}.png`), await png(svg, 1024));
  await writeFile(join(dir, `${name}-mac.png`), await macPng(svg));
  await writeFile(join(dir, `${name}.ico`), await ico(svg, APP_ICO_SIZES));
  await icns(svg, join(dir, `${name}.icns`));
  console.log(`  ✓ ${name}: png ladder + -mac.png + .ico + .icns`);
}

// macOS template image: a solid-black droplet on a transparent canvas. macOS
// reads only the alpha channel and tints it per menu-bar appearance, so one
// channel-neutral pair serves stable and nightly. The canvas matches the bar
// height; the glyph sits at ~76% so it does not tower over neighbouring items.
/**
 * @param {string} glyph
 * @param {number} size
 */
async function trayMacTemplatePng(glyph, size) {
  const inner = Math.round(size * 0.76);
  const mark = await png(Buffer.from(tintGlyphSvg(glyph, "#000000")), inner);
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: mark, gravity: "centre" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** @param {string} dir */
async function buildTrayIcons(dir) {
  const glyph = await readFile(MASTERS.glyph, "utf8");
  await mkdir(dir, { recursive: true });
  for (const { name, color } of TRAY_VARIANTS) {
    await writeFile(
      join(dir, `${name}.ico`),
      await ico(Buffer.from(tintGlyphSvg(glyph, color)), TRAY_ICO_SIZES),
    );
    console.log(`  ✓ ${name}: ${TRAY_ICO_SIZES.join("/")}px .ico`);
  }
  await writeFile(join(dir, "tray-icon-mac.png"), await trayMacTemplatePng(glyph, 22));
  await writeFile(join(dir, "tray-icon-mac@2x.png"), await trayMacTemplatePng(glyph, 44));
  console.log("  ✓ tray-icon-mac: 22px + @2x template PNG");
}

// One installable icon set per release channel: stable and nightly can be
// installed side by side, so nightly needs its own art on a home screen.
/**
 * @param {{ suffix: string, master: string, label: string }} channel
 * @param {string} publicDir
 */
async function buildPwaIcons({ suffix, master, label }, publicDir) {
  const icons = join(publicDir, "icons");
  await mkdir(icons, { recursive: true });
  const source = await readFile(master, "utf8");
  const svg = Buffer.from(source);
  // Plain renders keep the tile's transparent corners.
  await writeFile(join(icons, `icon${suffix}-192.png`), await png(svg, 192));
  await writeFile(join(icons, `icon${suffix}-512.png`), await png(svg, 512));
  // Maskable/apple-touch are opaque corner to corner. The droplet sits well
  // inside the maskable 80% safe circle at this viewBox.
  const bleed = Buffer.from(fullBleedSvg(source));
  await writeFile(join(icons, `icon${suffix}-maskable-512.png`), await png(bleed, 512));
  await writeFile(join(icons, `apple-touch-icon${suffix}.png`), await png(bleed, 180));
  await writeFile(join(publicDir, `app-icon${suffix}.svg`), publicIconSvg(source, label));
  console.log(`  ✓ icon${suffix}: 192 + 512 + maskable-512 + apple-touch + app-icon${suffix}.svg`);
}

/** @param {string} dir */
async function buildWebsiteIcons(dir) {
  await mkdir(dir, { recursive: true });
  const svg = await readFile(MASTERS.stable);
  const sizes = {
    "favicon-48x48.png": 48,
    "favicon-96x96.png": 96,
    "icon-192.png": 192,
    "icon-512.png": 512,
    "icon.png": 512,
  };
  for (const [file, size] of Object.entries(sizes)) {
    await writeFile(join(dir, file), await png(svg, size));
  }
  await writeFile(join(dir, "favicon.ico"), await ico(svg, [48, 32, 16]));
  console.log("  ✓ favicons + favicon.ico");
}

// Chrome side-panel extension icons (manifest sizes). Written to out/ only:
// chrome-extension/ is installed by its owner.
/** @param {string} dir */
async function buildExtensionIcons(dir) {
  await mkdir(dir, { recursive: true });
  const svg = await readFile(MASTERS.stable);
  for (const size of [16, 32, 48, 128]) {
    await writeFile(join(dir, `icon-${size}.png`), await png(svg, size));
  }
  console.log("  ✓ extension icons 16/32/48/128");
}

async function install() {
  for (const { path } of INSTALLED) {
    const target = join(REPO_ROOT, path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(OUT, path), target);
  }
  console.log(`  ✓ installed ${INSTALLED.length} files into build/ and public/`);
}

/**
 * @param {string} root
 * @param {string} where
 */
async function verify(root, where) {
  const problems = await checkIconAssets(root, INSTALLED);
  if (problems.length > 0) {
    throw new Error(`icon check failed in ${where}:\n  - ${problems.join("\n  - ")}`);
  }
  const roundTrip = process.platform === "darwin" ? " (ICNS round-tripped through iconutil)" : "";
  console.log(`  ✓ ${INSTALLED.length} assets verified in ${where}${roundTrip}`);
}

const SECTIONS = ["build", "tray", "website", "pwa", "extension"];

function parseArgs(argv) {
  const flags = new Set(argv.filter((arg) => arg.startsWith("--")));
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  for (const flag of flags) {
    if (flag !== "--install" && flag !== "--check") throw new Error(`unknown flag ${flag}`);
  }
  const only = positional[0];
  if (positional.length > 1 || (only && !SECTIONS.includes(only))) {
    throw new Error(
      `unknown section "${positional.join(" ")}"; expected one of ${SECTIONS.join(", ")}`,
    );
  }
  if (only && flags.has("--install"))
    throw new Error("--install needs every section; drop the section");
  return {
    only,
    install: flags.has("--install"),
    checkOnly: flags.has("--check") && !flags.has("--install"),
  };
}

async function main() {
  const { only, install: shouldInstall, checkOnly } = parseArgs(process.argv.slice(2));
  if (checkOnly) {
    await verify(REPO_ROOT, "the repo");
    return;
  }
  const wants = (section) => !only || only === section;
  const buildDir = join(OUT, "build");
  const publicDir = join(OUT, "public");

  if (!only) await rm(OUT, { recursive: true, force: true });
  if (wants("build")) {
    console.log("build/ (app icons):");
    for (const channel of CHANNELS) await buildAppIcons(channel, buildDir);
  }
  if (wants("build") || wants("tray")) {
    console.log("build/ (tray icons):");
    await buildTrayIcons(buildDir);
  }
  if (wants("website")) {
    console.log("website/ (favicons):");
    await buildWebsiteIcons(join(OUT, "website"));
  }
  if (wants("pwa")) {
    console.log("public/ (installable app icons):");
    for (const channel of CHANNELS) await buildPwaIcons(channel, publicDir);
  }
  if (wants("extension")) {
    console.log("extension/ (Chrome side panel):");
    await buildExtensionIcons(join(OUT, "extension"));
  }
  if (!only) await verify(OUT, "out/");
  if (shouldInstall) {
    await install();
    await verify(REPO_ROOT, "the repo");
  }
  console.log(`\nDone → ${OUT}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
