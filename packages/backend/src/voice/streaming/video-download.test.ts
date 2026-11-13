import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AppError } from '../../middleware/error-handler.js';

// See change-log-policy.test.ts: importing the media modules creates the music folders at MUSIC_DIR
// (/data/music by default, not writable on CI).
let tempMusicDir: string | null = null;
if (!process.env.MUSIC_DIR) {
  tempMusicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts6-video-download-'));
  process.env.MUSIC_DIR = tempMusicDir;
}
after(() => { if (tempMusicDir) fs.rmSync(tempMusicDir, { recursive: true, force: true }); });
const { missingDownloadError, downloadTimeoutMs } = await import('./video-download.js');

test('a video skipped by the duration filter becomes a readable 400', () => {
  // yt-dlp 2026.08.19 output for a 47:38 video with --match-filter "duration <= 900"
  const stdout = '[youtube] O3v7j17PsRo: Downloading m3u8 information\n[download] ADHD 2 (dnb mix to stay focus) does not pass filter (duration <= 900), skipping ..\n';
  const err = missingDownloadError(stdout, 900);
  assert.ok(err instanceof AppError);
  assert.equal(err.statusCode, 400);
  assert.equal(err.code, 'VIDEO_TOO_LONG');
  assert.equal(err.message, 'The video is longer than 15 minutes, the limit for a stream (an admin can raise it under Settings -> Streaming)');
  assert.match(missingDownloadError(stdout, 240 * 60).message, /longer than 240 minutes/);
});

test('the download timeout grows with the allowed video length', () => {
  assert.equal(downloadTimeoutMs(15 * 60), 13 * 60_000);
  assert.equal(downloadTimeoutMs(240 * 60), 58 * 60_000);
});

test('a missing file for any other reason stays a server error with yt-dlp output', () => {
  const err = missingDownloadError('[youtube] abc: something odd\n', 900);
  assert.ok(!(err instanceof AppError));
  assert.match(err.message, /^yt-dlp finished without a video file: \[youtube\] abc: something odd$/);
});
