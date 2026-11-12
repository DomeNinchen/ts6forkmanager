import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyYtDlpError, ytDlpErrorToAppError, parseLivePrint, liveRetryDelayMs, LIVE_MAX_RETRIES, LIVE_AUDIO_FORMAT } from './live-source.js';
import { liveOrDownloadedItem } from './youtube.js';

test('classifyYtDlpError sorts real yt-dlp messages', () => {
  // Wording from yt-dlp 2026.08.19 (UserNotLive, twitch.py, youtube/_video.py)
  assert.equal(classifyYtDlpError('ERROR: [twitch:stream] somechan: The channel is not currently live'), 'offline');
  assert.equal(classifyYtDlpError('ERROR: [youtube] abc: This live event will begin in 3 hours.'), 'offline');
  assert.equal(classifyYtDlpError('ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.'), 'age');
  assert.equal(classifyYtDlpError("ERROR: [youtube] abc: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies for the authentication."), 'login');
  assert.equal(classifyYtDlpError('ERROR: [twitch:stream] x: You must be logged into an account that has access to this subscriber-only content'), 'login');
  assert.equal(classifyYtDlpError('ERROR: [twitch:stream] nobody123: nobody123 does not exist'), 'not_found');
  assert.equal(classifyYtDlpError('ERROR: Unable to download webpage: HTTP Error 404: Not Found'), 'not_found');
  assert.equal(classifyYtDlpError('ERROR: Unsupported URL: https://example.com/'), 'unknown');
});

test('ytDlpErrorToAppError gives a 400 with a code for known kinds only', () => {
  const offline = ytDlpErrorToAppError('offline');
  assert.equal(offline?.statusCode, 400);
  assert.equal(offline?.code, 'LIVE_OFFLINE');
  assert.equal(ytDlpErrorToAppError('age')?.code, 'SOURCE_AGE_RESTRICTED');
  assert.equal(ytDlpErrorToAppError('login')?.code, 'SOURCE_LOGIN_REQUIRED');
  assert.equal(ytDlpErrorToAppError('unknown'), null);
});

test('parseLivePrint reads the is_live and url lines', () => {
  // As printed for the local live HLS test stream
  assert.deepEqual(parseLivePrint('True\nhttp://1.2.3.4:8088/live.m3u8\n'), { isLive: true, url: 'http://1.2.3.4:8088/live.m3u8' });
  assert.deepEqual(parseLivePrint('False\nhttps://x/y.m3u8'), { isLive: false, url: 'https://x/y.m3u8' });
  assert.equal(parseLivePrint('True\nNA\n'), null);
  assert.equal(parseLivePrint(''), null);
  // YouTube live, separate picture and sound: two addresses (yt-dlp 2026.08.19 --print urls)
  assert.deepEqual(parseLivePrint('True\nhttps://m/v.m3u8\nhttps://m/a.m3u8\n'), { isLive: true, url: 'https://m/v.m3u8', audioUrl: 'https://m/a.m3u8' });
  assert.equal(parseLivePrint('True\nhttps://m/v.m3u8\nERROR x\n'), null);
});

test('retry delay grows and stays bounded', () => {
  assert.deepEqual([1, 2, 3].map(liveRetryDelayMs), [2000, 4000, 8000]);
  assert.equal(liveRetryDelayMs(99), 1000 * 2 ** LIVE_MAX_RETRIES);
  assert.equal(liveRetryDelayMs(0), 2000);
});

test('audio format prefers Twitch audio_only, then any audio', () => {
  assert.equal(LIVE_AUDIO_FORMAT.split('/')[0], 'audio_only');
});

test('liveOrDownloadedItem: a live page streams, a download plays as a file', () => {
  const base = { id: 'chan', title: 'Chan (live)', artist: 'Chan', duration: 0, thumbnail: '', url: 'https://www.twitch.tv/chan' };
  const live = liveOrDownloadedItem('', { ...base, isLive: true });
  assert.equal(live.source, 'live');
  assert.equal(live.streamUrl, 'https://www.twitch.tv/chan');
  assert.equal(live.duration, undefined);
  const song = liveOrDownloadedItem('/data/music/x.opus', { ...base, duration: 200 });
  assert.equal(song.source, 'youtube');
  assert.equal(song.streamUrl, undefined);
  assert.equal(song.filePath, '/data/music/x.opus');
});

test('rebuffer target is 5 s of 48 kHz stereo 16-bit PCM', async () => {
  const { LIVE_REBUFFER_BYTES } = await import('./live-source.js');
  assert.equal(LIVE_REBUFFER_BYTES, 5 * 48000 * 2 * 2);
});

test('live video format: one muxed stream up to the preset height', async () => {
  const { liveVideoFormat } = await import('./live-source.js');
  assert.equal(liveVideoFormat(720), 'best[height<=720]/bv*[height<=720]+ba/best');
});
