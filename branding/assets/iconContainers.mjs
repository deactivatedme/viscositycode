// Minimal writers/readers for the icon containers the desktop build ships:
// PNG-compressed ICO (Windows Vista and later) and the Apple ICNS chunk list.
// Pure Buffer code so build-icons.mjs, its --check pass, and the contact sheet
// share one implementation.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ICO_HEADER_BYTES = 6;
const ICO_ENTRY_BYTES = 16;
const ICNS_HEADER_BYTES = 8;

/** @param {Buffer} buf */
export function isPng(buf) {
  return buf.length >= PNG_SIGNATURE.length && buf.subarray(0, 8).equals(PNG_SIGNATURE);
}

/**
 * Pack PNG frames into an ICO container. Entries keep the caller's order;
 * a 256px side is stored as 0, as the format requires.
 *
 * @param {ReadonlyArray<{ size: number, buf: Buffer }>} frames
 */
export function buildIco(frames) {
  if (frames.length === 0) throw new Error("ICO needs at least one frame");
  const head = Buffer.alloc(ICO_HEADER_BYTES);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(frames.length, 4);
  const dir = Buffer.alloc(ICO_ENTRY_BYTES * frames.length);
  let offset = ICO_HEADER_BYTES + dir.length;
  frames.forEach((frame, index) => {
    if (!Number.isInteger(frame.size) || frame.size < 1 || frame.size > 256) {
      throw new Error(`ICO frame size must be 1-256 px, got ${frame.size}`);
    }
    if (!isPng(frame.buf)) throw new Error(`ICO frame ${frame.size}px is not a PNG`);
    const o = index * ICO_ENTRY_BYTES;
    const side = frame.size === 256 ? 0 : frame.size;
    dir.writeUInt8(side, o);
    dir.writeUInt8(side, o + 1);
    dir.writeUInt8(0, o + 2); // palette colours
    dir.writeUInt8(0, o + 3); // reserved
    dir.writeUInt16LE(1, o + 4); // colour planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32LE(frame.buf.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += frame.buf.length;
  });
  return Buffer.concat([head, dir, ...frames.map((frame) => frame.buf)]);
}

/**
 * Parse an ICO directory and return each image's declared size and bytes.
 *
 * @param {Buffer} buf
 * @returns {{ width: number, height: number, bitCount: number, png: boolean, data: Buffer }[]}
 */
export function readIcoEntries(buf) {
  if (buf.length < ICO_HEADER_BYTES || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) {
    throw new Error("not an ICO file");
  }
  const count = buf.readUInt16LE(4);
  if (buf.length < ICO_HEADER_BYTES + count * ICO_ENTRY_BYTES) {
    throw new Error("ICO directory is truncated");
  }
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const o = ICO_HEADER_BYTES + index * ICO_ENTRY_BYTES;
    const length = buf.readUInt32LE(o + 8);
    const start = buf.readUInt32LE(o + 12);
    if (start + length > buf.length) throw new Error(`ICO entry ${index} points past the file`);
    const data = buf.subarray(start, start + length);
    entries.push({
      width: buf.readUInt8(o) || 256,
      height: buf.readUInt8(o + 1) || 256,
      bitCount: buf.readUInt16LE(o + 6),
      png: isPng(data),
      data,
    });
  }
  return entries;
}

/**
 * List the chunks of an ICNS file (`ic07`, `ic14`, `info`, ...).
 *
 * @param {Buffer} buf
 * @returns {{ type: string, length: number }[]}
 */
export function readIcnsChunks(buf) {
  if (buf.length < ICNS_HEADER_BYTES || buf.toString("latin1", 0, 4) !== "icns") {
    throw new Error("not an ICNS file");
  }
  if (buf.readUInt32BE(4) !== buf.length) throw new Error("ICNS length header mismatch");
  const chunks = [];
  let offset = ICNS_HEADER_BYTES;
  while (offset < buf.length) {
    if (offset + ICNS_HEADER_BYTES > buf.length) throw new Error("ICNS chunk header is truncated");
    const length = buf.readUInt32BE(offset + 4);
    if (length < ICNS_HEADER_BYTES || offset + length > buf.length) {
      throw new Error(`ICNS chunk at ${offset} has an invalid length`);
    }
    chunks.push({ type: buf.toString("latin1", offset, offset + 4), length });
    offset += length;
  }
  return chunks;
}
