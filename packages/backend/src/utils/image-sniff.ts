// Recognising the five image formats every browser draws on its own, from the
// bytes alone, for the Files page's preview.
//
// A file in a channel is whatever a channel member put there, so nothing about
// it - not its name, not what the TeamSpeak server says - is trusted: a file is
// shown only if its first bytes are those of PNG, JPEG, GIF, BMP or WebP, and the
// `Content-Type` that goes out is the one found here. SVG, HTML and anything else
// that could carry active content is simply not on the list.
//
// The size in pixels is read from the header as well, because a small file can
// still ask a browser tab for an absurd amount of memory (a 10 MB PNG can declare
// 40 000 x 40 000 pixels).

export type PreviewImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/bmp' | 'image/webp';

export interface SniffedImage {
  type: PreviewImageType;
  width: number;
  height: number;
}

/** Largest picture the preview will hand to a browser, in pixels (64 megapixels,
 * about 8000 x 8000). */
export const MAX_PREVIEW_PIXELS = 64_000_000;

const ascii = (data: Buffer, start: number, end: number) => data.toString('latin1', start, end);

function png(data: Buffer): SniffedImage | null {
  // 8-byte signature, then the IHDR chunk: length 13, "IHDR", width, height (big endian)
  if (data.length < 24) return null;
  if (data.readUInt32BE(0) !== 0x89504e47 || data.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  if (data.readUInt32BE(8) !== 13 || ascii(data, 12, 16) !== 'IHDR') return null;
  return { type: 'image/png', width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function gif(data: Buffer): SniffedImage | null {
  // "GIF87a" or "GIF89a", then the logical screen descriptor: width and height (little
  // endian), a packed byte (bit 7: a global colour table follows, bits 0-2: its size),
  // the background colour and the aspect ratio
  if (data.length < 14) return null;
  const signature = ascii(data, 0, 6);
  if (signature !== 'GIF87a' && signature !== 'GIF89a') return null;
  const packed = data[10];
  const next = 13 + (packed & 0x80 ? 3 << ((packed & 0x07) + 1) : 0);
  // What comes after is an extension (0x21), an image (0x2c) or the end (0x3b), never
  // anything else - six letters of "GIF89a" in front of some HTML are not a picture
  if (next >= data.length || (data[next] !== 0x21 && data[next] !== 0x2c && data[next] !== 0x3b)) return null;
  return { type: 'image/gif', width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
}

// The sizes of the DIB headers in use: BITMAPCOREHEADER, BITMAPINFOHEADER and its
// V2 to V5 successors. Two letters are a weak signature on their own; a header
// size that is one of these narrows a stray "BM" down a good deal.
const BMP_HEADER_SIZES = new Set([12, 40, 52, 56, 64, 108, 124]);

function bmp(data: Buffer): SniffedImage | null {
  // "BM", a 14-byte file header, then a DIB header whose first field is its own size
  if (data.length < 26 || ascii(data, 0, 2) !== 'BM') return null;
  const headerSize = data.readUInt32LE(14);
  if (!BMP_HEADER_SIZES.has(headerSize)) return null;
  if (headerSize === 12) {
    // BITMAPCOREHEADER: 16-bit width and height
    return { type: 'image/bmp', width: data.readUInt16LE(18), height: data.readUInt16LE(20) };
  }
  // BITMAPINFOHEADER and later: 32-bit width, 32-bit height (negative = stored top-down)
  return { type: 'image/bmp', width: Math.abs(data.readInt32LE(18)), height: Math.abs(data.readInt32LE(22)) };
}

function jpeg(data: Buffer): SniffedImage | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) return null;
  // Walk the marker segments until the frame header (SOF) that carries the size
  let offset = 2;
  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff) return null;
    const marker = data[offset + 1];
    if (marker === 0xff) { // fill byte
      offset++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2; // markers without a length
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end of image / start of scan before any frame header
    const length = data.readUInt16BE(offset + 2);
    const isFrameHeader = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrameHeader) {
      if (offset + 9 > data.length) return null;
      return { type: 'image/jpeg', width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5) };
    }
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

function webp(data: Buffer): SniffedImage | null {
  // "RIFF" <size> "WEBP", then the first chunk: lossy (VP8 ), lossless (VP8L) or extended (VP8X)
  if (data.length < 30 || ascii(data, 0, 4) !== 'RIFF' || ascii(data, 8, 12) !== 'WEBP') return null;
  const chunk = ascii(data, 12, 16);
  if (chunk === 'VP8 ') {
    // frame tag (3 bytes), start code 9d 01 2a, then 14-bit width and height
    if (data[23] !== 0x9d || data[24] !== 0x01 || data[25] !== 0x2a) return null;
    return { type: 'image/webp', width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    // signature byte 0x2f, then 14 bits of width - 1 and 14 bits of height - 1
    if (data[20] !== 0x2f) return null;
    const bits = data.readUInt32LE(21);
    return { type: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    // flags (4 bytes), then the canvas size as two 24-bit little-endian numbers, each minus one
    return {
      type: 'image/webp',
      width: (data[24] | (data[25] << 8) | (data[26] << 16)) + 1,
      height: (data[27] | (data[28] << 8) | (data[29] << 16)) + 1,
    };
  }
  return null;
}

/** What this is, by its bytes - or null if it is not one of the five formats, or
 * its header cannot be read. A picture that declares no size at all is refused
 * too: there is nothing to check its size against. */
export function sniffImage(data: Buffer): SniffedImage | null {
  const image = png(data) ?? jpeg(data) ?? gif(data) ?? bmp(data) ?? webp(data);
  if (!image || image.width < 1 || image.height < 1) return null;
  return image;
}
