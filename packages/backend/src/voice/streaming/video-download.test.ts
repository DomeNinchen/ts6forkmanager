import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingDownloadError } from './video-download.js';
import { AppError } from '../../middleware/error-handler.js';

test('a video skipped by the duration filter becomes a readable 400', () => {
  // yt-dlp 2026.08.19 output for a 47:38 video with --match-filter "duration <= 900"
  const stdout = '[youtube] O3v7j17PsRo: Downloading m3u8 information\n[download] ADHD 2 (dnb mix to stay focus) does not pass filter (duration <= 900), skipping ..\n';
  const err = missingDownloadError(stdout, 900);
  assert.ok(err instanceof AppError);
  assert.equal(err.statusCode, 400);
  assert.equal(err.code, 'VIDEO_TOO_LONG');
  assert.equal(err.message, 'The video is longer than 15 minutes, the limit for a stream');
});

test('a missing file for any other reason stays a server error with yt-dlp output', () => {
  const err = missingDownloadError('[youtube] abc: something odd\n', 900);
  assert.ok(!(err instanceof AppError));
  assert.match(err.message, /^yt-dlp finished without a video file: \[youtube\] abc: something odd$/);
});
