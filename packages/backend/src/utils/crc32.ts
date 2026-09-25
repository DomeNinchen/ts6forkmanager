// CRC32 (IEEE 802.3, the same polynomial zlib/PNG use). TeamSpeak names an
// uploaded icon `icon_<crc32 of its bytes>` and that checksum is the icon ID
// every group/channel/server refers to, so the ID is derived here rather than
// chosen - uploading the same image twice deterministically yields the same ID.

const TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

/** CRC32 of `data`, as an unsigned 32-bit number. */
export function crc32(data: Buffer | Uint8Array): number {
  let crc = -1;
  for (let i = 0; i < data.length; i++) {
    crc = TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}
