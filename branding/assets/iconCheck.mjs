// Verifies generated or installed icon assets against iconManifest.mjs: every
// file decodes, has the expected pixel size and frames, and (for ICNS) survives
// an iconutil round trip on macOS.
import sharp from "sharp";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { readIcnsChunks, readIcoEntries } from "./iconContainers.mjs";
import { ICNS_IMAGE_CHUNKS, ICNSET_MEMBERS, MAC_SAFE_AREA_BBOX } from "./iconManifest.mjs";

const run = promisify(execFile);

/** macOS ships iconutil at a fixed path; fall back to PATH lookup elsewhere. */
export function iconutilCommand() {
  return existsSync("/usr/bin/iconutil") ? "/usr/bin/iconutil" : "iconutil";
}

/** @param {Buffer} buf */
async function rgba(buf) {
  return sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

/** @param {{ data: Buffer, info: { width: number, height: number } }} image */
function alphaStats({ data, info }) {
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  let minAlpha = 255;
  let tinted = false;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const o = (y * info.width + x) * 4;
      const alpha = data[o + 3];
      minAlpha = Math.min(minAlpha, alpha);
      if (alpha === 0) continue;
      if (data[o] !== 0 || data[o + 1] !== 0 || data[o + 2] !== 0) tinted = true;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { bbox: { minX, minY, maxX, maxY }, minAlpha, tinted };
}

/**
 * @param {Buffer} buf
 * @param {import("./iconManifest.mjs").IconAssetSpec} spec
 * @param {string[]} problems
 */
async function checkPng(buf, spec, problems) {
  const meta = await sharp(buf).metadata();
  if (meta.format !== "png") problems.push(`${spec.path}: expected PNG, got ${meta.format}`);
  if (meta.width !== spec.size || meta.height !== spec.size) {
    problems.push(
      `${spec.path}: expected ${spec.size}x${spec.size}, got ${meta.width}x${meta.height}`,
    );
    return;
  }
  const stats = alphaStats(await rgba(buf));
  const last = (spec.size ?? 0) - 1;
  const expected =
    spec.bbox === "mac"
      ? MAC_SAFE_AREA_BBOX
      : spec.bbox === "full"
        ? { minX: 0, minY: 0, maxX: last, maxY: last }
        : null;
  if (expected && JSON.stringify(stats.bbox) !== JSON.stringify(expected)) {
    problems.push(
      `${spec.path}: opaque box ${JSON.stringify(stats.bbox)} != ${JSON.stringify(expected)}`,
    );
  }
  // ViscosityCode: a transparent-background mark must leave the corners clear
  // and still fill most of the canvas; the Dock PNG must sit inside the macOS
  // optical safe area.
  if (spec.bbox === "mark") {
    const { minX, minY, maxX, maxY } = stats.bbox;
    const span = Math.max(maxX - minX, maxY - minY) + 1;
    if (stats.minAlpha !== 0) problems.push(`${spec.path}: background must be transparent`);
    if (maxX < 0 || span < spec.size * 0.6) {
      problems.push(`${spec.path}: mark too small or empty (span ${span}px)`);
    }
  }
  if (spec.bbox === "withinMac") {
    const box = stats.bbox;
    const safe = MAC_SAFE_AREA_BBOX;
    if (
      box.maxX < 0 ||
      box.minX < safe.minX ||
      box.minY < safe.minY ||
      box.maxX > safe.maxX ||
      box.maxY > safe.maxY
    ) {
      problems.push(
        `${spec.path}: mark ${JSON.stringify(box)} outside the macOS safe area ${JSON.stringify(safe)}`,
      );
    }
  }
  if (spec.opaque && stats.minAlpha !== 255) {
    problems.push(`${spec.path}: must be opaque corner to corner (min alpha ${stats.minAlpha})`);
  }
  if (spec.template && (stats.tinted || stats.bbox.maxX < 0)) {
    problems.push(`${spec.path}: template image must be a non-empty black-on-transparent glyph`);
  }
}

/**
 * @param {Buffer} buf
 * @param {import("./iconManifest.mjs").IconAssetSpec} spec
 * @param {string[]} problems
 */
async function checkIco(buf, spec, problems) {
  const entries = readIcoEntries(buf);
  const sizes = entries.map((entry) => entry.width);
  if (JSON.stringify(sizes) !== JSON.stringify(spec.frames)) {
    problems.push(`${spec.path}: frames ${sizes.join(",")} != ${spec.frames?.join(",")}`);
  }
  for (const entry of entries) {
    if (!entry.png || entry.bitCount !== 32) {
      problems.push(`${spec.path}: ${entry.width}px frame is not a 32bpp PNG entry`);
      continue;
    }
    const meta = await sharp(entry.data).metadata();
    if (meta.width !== entry.width || meta.height !== entry.height) {
      problems.push(`${spec.path}: ${entry.width}px frame decodes as ${meta.width}x${meta.height}`);
    }
  }
}

/**
 * @param {Buffer} buf
 * @param {string} file
 * @param {import("./iconManifest.mjs").IconAssetSpec} spec
 * @param {string[]} problems
 * @param {{ roundTrip: boolean }} options
 */
async function checkIcns(buf, file, spec, problems, { roundTrip }) {
  const types = new Set(readIcnsChunks(buf).map((chunk) => chunk.type));
  const missing = ICNS_IMAGE_CHUNKS.filter((type) => !types.has(type));
  if (missing.length > 0) problems.push(`${spec.path}: missing ICNS chunks ${missing.join(",")}`);
  if (!roundTrip) return;
  const stage = await mkdtemp(join(tmpdir(), "vc-icns-check-"));
  try {
    const iconset = join(stage, "roundtrip.iconset");
    await run(iconutilCommand(), ["-c", "iconset", file, "-o", iconset]);
    for (const [name, px] of ICNSET_MEMBERS) {
      const meta = await sharp(await readFile(join(iconset, name))).metadata();
      if (meta.width !== px || meta.height !== px) {
        problems.push(`${spec.path}: ${name} round-trips as ${meta.width}x${meta.height}`);
      }
    }
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

/**
 * @param {Buffer} buf
 * @param {import("./iconManifest.mjs").IconAssetSpec} spec
 * @param {string[]} problems
 */
async function checkSvg(buf, spec, problems) {
  const meta = await sharp(buf).metadata();
  if (meta.format !== "svg") problems.push(`${spec.path}: expected SVG, got ${meta.format}`);
  const text = buf.toString("utf8");
  if (spec.label && !text.includes(`aria-label="${spec.label}"`)) {
    problems.push(`${spec.path}: missing aria-label="${spec.label}"`);
  }
  if (/poracode/i.test(text)) problems.push(`${spec.path}: still names the upstream product`);
}

/**
 * @param {string} root directory the spec paths are relative to
 * @param {readonly import("./iconManifest.mjs").IconAssetSpec[]} specs
 * @returns {Promise<string[]>} human-readable problems; empty when every asset passes
 */
export async function checkIconAssets(root, specs) {
  const roundTrip = process.platform === "darwin";
  /** @type {string[]} */
  const problems = [];
  for (const spec of specs) {
    const file = join(root, spec.path);
    if (!existsSync(file)) {
      problems.push(`${spec.path}: missing`);
      continue;
    }
    const buf = await readFile(file);
    try {
      if (spec.kind === "png") await checkPng(buf, spec, problems);
      else if (spec.kind === "ico") await checkIco(buf, spec, problems);
      else if (spec.kind === "icns") await checkIcns(buf, file, spec, problems, { roundTrip });
      else await checkSvg(buf, spec, problems);
    } catch (error) {
      problems.push(`${spec.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return problems;
}
