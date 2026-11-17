// Run with: node --test branding/assets/
// (branding/ sits outside the Vitest projects, so these use node:test.)
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import sharp from "sharp";
import { buildIco, isPng, readIcnsChunks, readIcoEntries } from "./iconContainers.mjs";
import { APP_ICO_SIZES, installedIconAssets } from "./iconManifest.mjs";
import { fullBleedSvg, publicIconSvg, tintGlyphSvg } from "./iconSvg.mjs";

/** @param {number} size */
function solidPng(size) {
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 56, g: 189, b: 248, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

/** @param {ReadonlyArray<[string, number]>} chunks type + payload bytes */
function fakeIcns(chunks) {
  const parts = chunks.map(([type, bytes]) => {
    const chunk = Buffer.alloc(8 + bytes);
    chunk.write(type, 0, "latin1");
    chunk.writeUInt32BE(8 + bytes, 4);
    return chunk;
  });
  const head = Buffer.alloc(8);
  head.write("icns", 0, "latin1");
  head.writeUInt32BE(8 + parts.reduce((sum, part) => sum + part.length, 0), 4);
  return Buffer.concat([head, ...parts]);
}

void describe("buildIco / readIcoEntries", () => {
  void it("round-trips PNG frames in order, storing 256px as 0", async () => {
    const frames = await Promise.all(
      APP_ICO_SIZES.map(async (size) => ({ size, buf: await solidPng(size) })),
    );
    const ico = buildIco(frames);

    assert.equal(ico.readUInt8(6), 0, "256px side is encoded as 0");
    const entries = readIcoEntries(ico);
    assert.deepEqual(
      entries.map((entry) => entry.width),
      APP_ICO_SIZES,
    );
    for (const [index, entry] of entries.entries()) {
      assert.equal(entry.height, entry.width);
      assert.equal(entry.bitCount, 32);
      assert.ok(entry.png);
      assert.ok(entry.data.equals(frames[index].buf));
      const meta = await sharp(entry.data).metadata();
      assert.equal(meta.width, entry.width);
    }
  });

  void it("rejects frames that are not PNG or out of range", async () => {
    assert.throws(() => buildIco([]), /at least one frame/);
    assert.throws(() => buildIco([{ size: 16, buf: Buffer.from("BM not a png") }]), /not a PNG/);
    assert.throws(() => buildIco([{ size: 512, buf: Buffer.alloc(0) }]), /1-256/);
  });

  void it("rejects malformed ICO data", async () => {
    assert.throws(() => readIcoEntries(Buffer.from("nope")), /not an ICO/);
    const ico = buildIco([{ size: 16, buf: await solidPng(16) }]);
    assert.throws(() => readIcoEntries(ico.subarray(0, 12)), /truncated/);
    assert.throws(() => readIcoEntries(ico.subarray(0, ico.length - 1)), /past the file/);
  });
});

void describe("readIcnsChunks", () => {
  void it("lists chunk types in file order", () => {
    const chunks = readIcnsChunks(
      fakeIcns([
        ["ic12", 4],
        ["ic07", 0],
        ["info", 2],
      ]),
    );
    assert.deepEqual(chunks, [
      { type: "ic12", length: 12 },
      { type: "ic07", length: 8 },
      { type: "info", length: 10 },
    ]);
  });

  void it("rejects a bad magic, length header or chunk length", () => {
    const valid = fakeIcns([["ic04", 4]]);
    assert.throws(() => readIcnsChunks(Buffer.from("icon0000")), /not an ICNS/);
    const shortHeader = Buffer.from(valid);
    shortHeader.writeUInt32BE(valid.length + 1, 4);
    assert.throws(() => readIcnsChunks(shortHeader), /length header/);
    const badChunk = Buffer.from(valid);
    badChunk.writeUInt32BE(4, 12);
    assert.throws(() => readIcnsChunks(badChunk), /invalid length/);
  });
});

void describe("SVG transforms", () => {
  const master = [
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1024 1024" width="1024" height="1024">',
    "  <!-- authoring note -->",
    '  <use xlink:href="#tile" fill="url(#tileFill)"/>',
    '  <use xlink:href="#tile" fill="url(#tileGlow)" />',
    '  <use xlink:href="#drop" fill="url(#liquid)"/>',
    "</svg>",
  ].join("\n");

  void it("expands every tile layer to a full-bleed square and leaves other layers alone", () => {
    const bleed = fullBleedSvg(master);
    assert.match(bleed, /<rect width="1024" height="1024" fill="url\(#tileFill\)"\/>/);
    assert.match(bleed, /<rect width="1024" height="1024" fill="url\(#tileGlow\)"\/>/);
    assert.match(bleed, /<use xlink:href="#drop" fill="url\(#liquid\)"\/>/);
    assert.doesNotMatch(bleed, /#tile"/);
    assert.throws(() => fullBleedSvg("<svg></svg>"), /no <use/);
  });

  void it("reveals the hidden backdrop and insets the mark for transparent-mark masters", () => {
    const transparent = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">',
      '  <rect id="maskable-backdrop" width="1024" height="1024" fill="#0a0a0b" opacity="0"/>',
      '  <image data-mark="1" x="72" y="150" width="880" height="753" href="data:,"/>',
      "</svg>",
    ].join("\n");
    const bleed = fullBleedSvg(transparent);
    assert.match(
      bleed,
      /<rect id="maskable-backdrop" width="1024" height="1024" fill="#0a0a0b" opacity="1"\/>/,
    );
    assert.match(bleed, /<image data-mark="1" transform="translate\(512 512\) scale\(0\.68\)/);
  });

  void it("labels the public SVG and drops comments and fixed size", () => {
    const svg = publicIconSvg(master, 'Brand "Nightly" & Co');
    assert.match(svg, /role="img" aria-label="Brand &quot;Nightly&quot; &amp; Co"/);
    assert.doesNotMatch(svg, /<!--|width="1024"/);
    assert.throws(() => publicIconSvg("<svg></svg>", "x"), /size attributes/);
  });

  void it("pins the glyph colour", () => {
    assert.equal(tintGlyphSvg('<path fill="currentColor"/>', "#000"), '<path fill="#000"/>');
    assert.throws(() => tintGlyphSvg('<path fill="#fff"/>', "#000"), /currentColor/);
  });
});

void describe("ViscosityCode masters", () => {
  const assetsDir = new URL(".", import.meta.url);

  void it("render, expand to full bleed, and keep the upstream mark out", async () => {
    for (const name of ["viscositycode-icon.svg", "viscositycode-icon-nightly.svg"]) {
      const source = await readFile(new URL(name, assetsDir), "utf8");
      assert.doesNotMatch(source, /poracode/i, name);
      const meta = await sharp(Buffer.from(source)).metadata();
      assert.equal(meta.width, 1024, name);
      const bleed = await sharp(Buffer.from(fullBleedSvg(source)), { density: 18 })
        .resize(64, 64)
        .ensureAlpha()
        .raw()
        .toBuffer();
      assert.equal(bleed[3], 255, `${name} maskable corner is opaque`);
    }
    const glyph = await readFile(new URL("viscositycode-glyph.svg", assetsDir), "utf8");
    assert.ok(
      isPng(
        await sharp(Buffer.from(tintGlyphSvg(glyph, "#000")))
          .png()
          .toBuffer(),
      ),
    );
  });

  void it("covers every shipped icon path exactly once", () => {
    const paths = installedIconAssets({ stable: "S", nightly: "N" }).map((asset) => asset.path);
    assert.equal(new Set(paths).size, paths.length);
    for (const expected of [
      "build/icon.png",
      "build/icon-mac.png",
      "build/icon.ico",
      "build/icon.icns",
      "build/icon-nightly-mac.png",
      "build/tray-icon.ico",
      "build/tray-icon-dark.ico",
      "build/tray-icon-nightly.ico",
      "build/tray-icon-nightly-dark.ico",
      "build/tray-icon-mac.png",
      "build/tray-icon-mac@2x.png",
      "public/app-icon.svg",
      "public/app-icon-nightly.svg",
      "public/icons/icon-192.png",
      "public/icons/icon-512.png",
      "public/icons/icon-maskable-512.png",
      "public/icons/apple-touch-icon.png",
      "public/icons/icon-nightly-192.png",
      "public/icons/icon-nightly-512.png",
      "public/icons/icon-nightly-maskable-512.png",
      "public/icons/apple-touch-icon-nightly.png",
    ]) {
      assert.ok(paths.includes(expected), expected);
    }
  });
});
