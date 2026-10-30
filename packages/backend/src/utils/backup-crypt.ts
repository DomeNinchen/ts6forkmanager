// Passphrase encryption for backups that leave the volume (R7 stage 3), in the format of
// `openssl enc -aes-256-cbc -pbkdf2 -md sha256 -iter 600000`, so a file can be opened with the
// standard tool alone, without this app:
//   "Salted__" | 8-byte salt | AES-256-CBC(PKCS#7) ciphertext,
//   key and IV = PBKDF2-HMAC-SHA256(passphrase, salt, 600000 rounds, 48 bytes).
// CBC has no integrity check of its own; what is inside (a ZIP with CRCs, a manifest with the
// database's SHA-256) catches a damaged or tampered file.
import { createCipheriv, createDecipheriv, pbkdf2, randomBytes, type Cipher } from 'node:crypto';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

export const OPENSSL_MAGIC = Buffer.from('Salted__', 'latin1');
export const PBKDF2_ITERATIONS = 600_000;
/** What an admin runs to open a file without the app. */
export const OPENSSL_DECRYPT_COMMAND = `openssl enc -d -aes-256-cbc -pbkdf2 -md sha256 -iter ${PBKDF2_ITERATIONS} -in <file>.zip.enc -out <file>.zip`;

const pbkdf2Async = promisify(pbkdf2);

// Async: 600000 rounds take a few hundred milliseconds, which belong in the thread pool, not on
// the main thread that feeds the music bots.
async function keyAndIv(passphrase: string, salt: Buffer): Promise<{ key: Buffer; iv: Buffer }> {
  const derived = await pbkdf2Async(passphrase, salt, PBKDF2_ITERATIONS, 48, 'sha256');
  return { key: derived.subarray(0, 32), iv: derived.subarray(32, 48) };
}

/** The 16-byte header and a cipher stream; header first, then everything the cipher puts out. */
export async function encryptor(passphrase: string): Promise<{ header: Buffer; cipher: Cipher }> {
  const salt = randomBytes(8);
  const { key, iv } = await keyAndIv(passphrase, salt);
  return { header: Buffer.concat([OPENSSL_MAGIC, salt]), cipher: createCipheriv('aes-256-cbc', key, iv) };
}

/** Size of the encrypted file for `plainSize` bytes: header plus PKCS#7-padded blocks. */
export function encryptedSize(plainSize: number): number {
  return 16 + (Math.floor(plainSize / 16) + 1) * 16;
}

export function isEncrypted(file: string): boolean {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(8);
    return fs.readSync(fd, head, 0, 8, 0) === 8 && head.equals(OPENSSL_MAGIC);
  } finally {
    fs.closeSync(fd);
  }
}

/** Decrypts `src` into `dst`. A wrong passphrase (or a damaged file) throws and leaves no `dst`. */
export async function decryptFile(src: string, dst: string, passphrase: string): Promise<void> {
  const fd = fs.openSync(src, 'r');
  const head = Buffer.alloc(16);
  try {
    if (fs.readSync(fd, head, 0, 16, 0) !== 16 || !head.subarray(0, 8).equals(OPENSSL_MAGIC)) throw new Error('Not an encrypted backup');
  } finally {
    fs.closeSync(fd);
  }
  const { key, iv } = await keyAndIv(passphrase, head.subarray(8, 16));
  try {
    await pipeline(fs.createReadStream(src, { start: 16 }), createDecipheriv('aes-256-cbc', key, iv), fs.createWriteStream(dst, { mode: 0o600 }));
  } catch (err) {
    fs.rmSync(dst, { force: true });
    throw err;
  }
}
