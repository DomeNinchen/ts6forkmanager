import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MetricRollup, type MetricReading } from './metric-rollup.js';
import { voiceQuality } from './bandwidth-sampler.js';
import { buildMetricHistory, type RollupSampleRow } from '../utils/metric-history-series.js';

const reading = (at: number, quality: MetricReading['quality']): MetricReading => ({
  at, counterIn: null, counterOut: null, rateIn: 0, rateOut: 0, ping: 5, quality,
});

test('voiceQuality: no voice client means no measurement, real values pass through', () => {
  // Field values as TeamSpeak 6.0.0-beta13.1 answered them (measured with netem 40 ms / 10 % loss).
  const base = {
    virtualserver_total_packetloss_speech: '0.0520',
    virtualserver_total_packetloss_total: '0.0553',
    virtualserver_total_ping: '40.0000',
  };
  assert.deepEqual(
    voiceQuality({ ...base, virtualserver_clientsonline: '3', virtualserver_queryclientsonline: '1' }),
    { lossSpeech: 0.052, lossTotal: 0.0553, clientPing: 40 },
  );
  // Only the app's own query client online: TeamSpeak reports zeros, which are no measurement.
  assert.equal(voiceQuality({ ...base, virtualserver_clientsonline: '1', virtualserver_queryclientsonline: '1' }), null);
  // A server build without the fields.
  assert.equal(voiceQuality({ virtualserver_clientsonline: '2', virtualserver_queryclientsonline: '0' }), null);
});

test('rollup: averages and maxima over readings with clients only', () => {
  const r = new MetricRollup();
  const t0 = 1_800_000_000_000 - (1_800_000_000_000 % 600_000);
  r.add('1:1', reading(t0, { lossSpeech: 0.02, lossTotal: 0.03, clientPing: 30 }), 600);
  r.add('1:1', reading(t0 + 30_000, null), 600);
  r.add('1:1', reading(t0 + 60_000, { lossSpeech: 0.06, lossTotal: 0.05, clientPing: 50 }), 600);
  const row = r.add('1:1', reading(t0 + 600_000, null), 600)!;
  assert.equal(row.qualityN, 2);
  assert.ok(Math.abs(row.lossSpeechAvg! - 0.04) < 1e-9);
  assert.equal(row.lossSpeechMax, 0.06);
  assert.ok(Math.abs(row.lossTotalAvg! - 0.04) < 1e-9);
  assert.equal(row.lossTotalMax, 0.05);
  assert.equal(row.clientPingAvg, 40);
  assert.equal(row.clientPingMax, 50);

  // The next window had no clients at all: counted as zero readings, figures null - never a 0.
  const [{ row: empty }] = r.flushAll();
  assert.equal(empty.qualityN, 0);
  assert.equal(empty.lossSpeechAvg, null);
  assert.equal(empty.clientPingMax, null);
});

test('quality series: weighted by readings, in percent, empty bucket flagged as no clients', () => {
  const now = Date.UTC(2026, 10, 12, 12, 0, 0);
  const row = (minutesAgo: number, q: Partial<RollupSampleRow>): RollupSampleRow => ({
    t: now - minutesAgo * 60_000, intervalSec: 600,
    bytesIn: null, bytesOut: null, spanSec: null, peakIn: null, peakOut: null,
    pingOk: 1, pingFailed: 0, pingAvg: 5, pingMin: 5, pingMax: 5,
    qualityN: 0, lossSpeechAvg: null, lossSpeechMax: null, lossTotalAvg: null, lossTotalMax: null, clientPingAvg: null, clientPingMax: null,
    ...q,
  });
  const rows = [
    row(120, { qualityN: 1, lossSpeechAvg: 0.1, lossSpeechMax: 0.1, lossTotalAvg: 0.1, lossTotalMax: 0.1, clientPingAvg: 100, clientPingMax: 100 }),
    row(110, { qualityN: 3, lossSpeechAvg: 0.02, lossSpeechMax: 0.05, lossTotalAvg: 0.02, lossTotalMax: 0.04, clientPingAvg: 20, clientPingMax: 60 }),
    row(60, {}),
    row(10, { qualityN: 2, lossSpeechAvg: 0.01, lossSpeechMax: 0.01, lossTotalAvg: 0.015, lossTotalMax: 0.02, clientPingAvg: 30, clientPingMax: 35 }),
  ];
  const s = buildMetricHistory('quality', rows, [], '24h', now);
  assert.equal(s.metric, 'quality');
  if (s.metric !== 'quality') return;

  // (0.1*1 + 0.02*3 + 0.01*2) / 6 = 0.03 -> 3 %
  assert.equal(s.stats.averageLossSpeech, 3);
  assert.equal(s.stats.averageClientPing, round1((100 + 60 + 60) / 6));
  assert.deepEqual(s.stats.peakLossSpeech, { value: 10, at: now - 120 * 60_000 });
  assert.deepEqual(s.stats.peakClientPing, { value: 100, at: now - 120 * 60_000 });
  assert.equal(s.stats.currentLossSpeech, 1);
  assert.equal(s.stats.currentClientPing, 30);

  const quiet = s.points.filter((p) => p.noClients);
  assert.equal(quiet.length, 1);
  assert.equal(quiet[0].lossSpeech, null);
  // Never a 0 for a bucket nobody measured.
  assert.ok(s.points.every((p) => p.lossSpeech === null || p.lossSpeech > 0));
});

function round1(v: number) {
  return Math.round(v * 10) / 10;
}
