import net from 'net';
import dgram from 'dgram';
import crypto from 'crypto';
import type { ConnectionDiagnosis, DiagnosisStep } from '@ts6/common';
import { WebQueryClient } from '../ts-client/webquery-client.js';
import { SshQueryClient } from '../bot-engine/ssh-query-client.js';
import { causeFromNodeCode, classifySshError, classifyWebQueryError } from './connection-cause.js';
import { claimTestLogin, sshRejection, type SshCredentials } from './ssh-login-guard.js';
import { INIT_MAC, INIT_VERSION } from '../voice/tslib/crypto.js';

export interface DiagnosisTarget {
  host: string;
  useHttps: boolean;
  webqueryPort: number;
  /** null: the connection has no key. A stored key that cannot be used is reported through `apiKeyProblem`. */
  apiKey: string | null;
  apiKeyProblem?: string;
  ssh: Omit<SshCredentials, 'host'> | null;
  sshProblem?: string;
  /** Voice ports of this connection's music bots, checked as well when the server list does not name them. */
  voicePorts?: number[];
}

const FT_CONNECT_TIMEOUT_MS = 5000;
const VOICE_ANSWER_TIMEOUT_MS = 3000;
const SIDECAR_TIMEOUT_MS = 3000;
/** At most this many voice ports per diagnosis: one datagram each (TS6 starts warning at bursts of ~100, measured). */
const MAX_VOICE_PORTS = 5;

/**
 * Checks the ways the manager talks to one TeamSpeak server, one step each: WebQuery, SSH query,
 * file-transfer port. Uses throwaway clients only, so the running pool client and event sessions
 * are left alone; a connected event session is reused for the SSH step instead of a new login.
 */
export async function diagnoseConnection(t: DiagnosisTarget, liveSsh?: SshQueryClient): Promise<ConnectionDiagnosis> {
  const steps: DiagnosisStep[] = [];

  // WebQuery, and on the way the file-transfer port (an instance setting, so no ticket is needed).
  let webQueryFailed = false;
  let ftPort: number | undefined;
  let ftPortError: unknown;
  let voiceTargets: { port: number; sid?: number }[] | undefined;
  if (t.apiKeyProblem) {
    webQueryFailed = true;
    steps.push({ id: 'webquery', status: 'failed', cause: 'not-configured', detail: t.apiKeyProblem, port: t.webqueryPort });
  } else if (!t.apiKey) {
    steps.push({ id: 'webquery', status: 'skipped', cause: 'not-configured', port: t.webqueryPort });
  } else {
    const client = new WebQueryClient(t.host, t.webqueryPort, t.apiKey, t.useHttps);
    try {
      const r = await client.testConnection();
      webQueryFailed = !r.success;
      steps.push({ id: 'webquery', status: r.success ? 'ok' : 'failed', cause: r.cause, detail: r.detail, durationMs: r.durationMs, port: t.webqueryPort });
      if (r.success) {
        try {
          const info = await client.execute(0, 'instanceinfo');
          const port = Number((Array.isArray(info) ? info[0] : info)?.serverinstance_filetransfer_port);
          if (Number.isInteger(port) && port > 0) ftPort = port;
        } catch (err) { ftPortError = err; }
        try {
          const list = await client.execute(0, 'serverlist');
          voiceTargets = (Array.isArray(list) ? list : [list])
            .filter((vs: any) => vs?.virtualserver_status === 'online')
            .map((vs: any) => ({ port: Number(vs.virtualserver_port), sid: Number(vs.virtualserver_id) }))
            .filter((v) => Number.isInteger(v.port) && v.port > 0);
        } catch { /* the bots' ports below are still checked */ }
      }
    } finally {
      client.destroy();
    }
  }

  // SSH query.
  if (t.sshProblem) {
    steps.push({ id: 'ssh', status: 'failed', cause: 'not-configured', detail: t.sshProblem });
  } else if (!t.ssh) {
    steps.push({ id: 'ssh', status: 'skipped', cause: 'not-configured' });
  } else if (webQueryFailed) {
    steps.push({ id: 'ssh', status: 'skipped', cause: 'prerequisite-failed', port: t.ssh.port });
  } else {
    steps.push(await sshStep({ host: t.host, ...t.ssh }, liveSsh));
  }

  // File-transfer port: only a TCP connection, opened and closed again; no ticket, nothing written.
  if (!t.ssh && !t.sshProblem) {
    // File commands run over SSH, so without SSH there is no file transfer to check.
    steps.push({ id: 'filetransfer', status: 'skipped', cause: 'not-configured' });
  } else if (webQueryFailed || !t.apiKey) {
    steps.push({ id: 'filetransfer', status: 'skipped', cause: 'prerequisite-failed', detail: 'The file-transfer port is read over WebQuery' });
  } else if (ftPort === undefined) {
    const { cause, detail } = ftPortError ? classifyWebQueryError(ftPortError) : { cause: 'unexpected-response' as const, detail: 'instanceinfo did not name a file-transfer port' };
    steps.push({ id: 'filetransfer', status: 'failed', cause, detail });
  } else {
    steps.push(await tcpStep(t.host, ftPort));
  }

  // Voice: one Init0 datagram per port, up to the server's first answer; no client is created.
  const targets = [...(voiceTargets ?? [])];
  for (const port of new Set(t.voicePorts ?? [])) if (!targets.some((v) => v.port === port)) targets.push({ port });
  if (targets.length === 0) {
    steps.push(voiceTargets
      ? { id: 'voice', status: 'skipped', cause: 'not-configured', detail: 'No virtual server is online' }
      : { id: 'voice', status: 'skipped', cause: webQueryFailed ? 'prerequisite-failed' : 'not-configured' });
  } else {
    steps.push(...await Promise.all(targets.slice(0, MAX_VOICE_PORTS).map((v) => voiceStep(t.host, v.port, v.sid))));
  }

  steps.push(await sidecarStep(process.env.SIDECAR_URL));
  return { host: t.host, useHttps: t.useHttps, steps };
}

async function sshStep(c: SshCredentials, live?: SshQueryClient): Promise<DiagnosisStep> {
  const started = Date.now();
  const took = () => Date.now() - started;
  if (live) {
    try {
      await live.executeCommand('whoami');
      return { id: 'ssh', status: 'ok', cause: 'ok', source: 'live-session', durationMs: took(), port: c.port };
    } catch (err) {
      return { id: 'ssh', status: 'failed', ...classifySshError(err), source: 'live-session', durationMs: took(), port: c.port };
    }
  }
  const refused = sshRejection(c);
  if (refused) {
    return { id: 'ssh', status: 'failed', cause: 'ssh-auth-rejected', source: 'remembered', detail: `${refused.message} (${refused.at.toISOString()})`, port: c.port };
  }
  const wait = claimTestLogin(c.host, c.port);
  if (wait > 0) return { id: 'ssh', status: 'skipped', cause: 'rate-limited', detail: `${wait} s`, port: c.port };

  const client = new SshQueryClient(c);
  client.on('error', () => {}); // reported through connect()'s rejection
  try {
    await client.connect();
    await client.executeCommand('whoami');
    return { id: 'ssh', status: 'ok', cause: 'ok', source: 'test-login', durationMs: took(), port: c.port };
  } catch (err) {
    return { id: 'ssh', status: 'failed', ...classifySshError(err), source: 'test-login', durationMs: took(), port: c.port };
  } finally {
    await client.destroy();
  }
}

/** The client's first handshake packet (Init0), built the way voice/tslib sends it. */
function init0Packet(): Buffer {
  const data = Buffer.alloc(21);
  data.writeUInt32BE(INIT_VERSION, 0);
  data[4] = 0; // step 0
  data.writeUInt32BE(Math.floor(Date.now() / 1000), 5);
  crypto.randomFillSync(data, 9, 4);
  const raw = Buffer.alloc(8 + 5 + data.length);
  INIT_MAC.copy(raw, 0);
  raw.writeUInt16BE(101, 8); // packet id
  raw.writeUInt16BE(0, 10); // client id
  raw[12] = 0x80 | 8; // unencrypted, Init1
  data.copy(raw, 13);
  return raw;
}

/** The server's answer to Init0: MAC "TS3INIT1", packet id, type, then init step 1. */
export function isInit1Answer(msg: Buffer): boolean {
  return msg.length >= 12 && msg.subarray(0, 8).equals(INIT_MAC) && msg[11] === 1;
}

export function voiceStep(host: string, port: number, sid?: number): Promise<DiagnosisStep> {
  const started = Date.now();
  return new Promise((resolve) => {
    const socket = dgram.createSocket(net.isIPv6(host) ? 'udp6' : 'udp4');
    let done = false;
    const finish = (step: Pick<DiagnosisStep, 'status' | 'cause' | 'detail'>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { socket.close(); } catch { }
      resolve({ id: 'voice', ...step, durationMs: Date.now() - started, port, ...(sid !== undefined ? { sid } : {}) });
    };
    const timer = setTimeout(() => finish({ status: 'failed', cause: 'timeout', detail: `no answer on UDP ${port} within ${VOICE_ANSWER_TIMEOUT_MS / 1000} s` }), VOICE_ANSWER_TIMEOUT_MS);
    socket.on('message', (msg) => finish(isInit1Answer(msg)
      ? { status: 'ok', cause: 'ok' }
      : { status: 'failed', cause: 'unexpected-response', detail: `${msg.length} bytes that are no TeamSpeak handshake answer` }));
    // A connected UDP socket also receives the ICMP "port unreachable", as ECONNREFUSED.
    socket.on('error', (err: NodeJS.ErrnoException) => finish({ status: 'failed', cause: err.code ? causeFromNodeCode(err.code) : 'unknown', detail: err.code ? `${err.code}: ${err.message}` : err.message }));
    socket.connect(port, host, () => socket.send(init0Packet()));
  });
}

/** The video sidecar in Docker mode (SIDECAR_URL). Without it a sidecar process starts with each video stream, so there is nothing to check. */
export async function sidecarStep(url: string | undefined): Promise<DiagnosisStep> {
  if (!url) return { id: 'sidecar', status: 'skipped', cause: 'not-configured', detail: 'SIDECAR_URL is not set: a sidecar process starts with each video stream' };
  const started = Date.now();
  const took = () => Date.now() - started;
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/health`, { signal: AbortSignal.timeout(SIDECAR_TIMEOUT_MS) });
    const body = res.ok ? (await res.json().catch(() => null)) as { status?: string } | null : null;
    if (body?.status === 'ok') return { id: 'sidecar', status: 'ok', cause: 'ok', durationMs: took() };
    return { id: 'sidecar', status: 'failed', cause: 'unexpected-response', detail: `HTTP ${res.status}`, durationMs: took() };
  } catch (err: any) {
    if (err?.name === 'TimeoutError') return { id: 'sidecar', status: 'failed', cause: 'timeout', detail: `no answer within ${SIDECAR_TIMEOUT_MS / 1000} s`, durationMs: took() };
    const code = err?.cause?.code as string | undefined;
    return { id: 'sidecar', status: 'failed', cause: code ? causeFromNodeCode(code) : 'unknown', detail: code ? `${code}: ${err.cause.message ?? err.message}` : String(err?.message ?? err), durationMs: took() };
  }
}

function tcpStep(host: string, port: number): Promise<DiagnosisStep> {
  const started = Date.now();
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (step: Omit<DiagnosisStep, 'id' | 'durationMs' | 'port'>) => {
      socket.destroy();
      resolve({ id: 'filetransfer', ...step, durationMs: Date.now() - started, port });
    };
    socket.setTimeout(FT_CONNECT_TIMEOUT_MS, () => finish({ status: 'failed', cause: 'timeout', detail: `no answer within ${FT_CONNECT_TIMEOUT_MS / 1000} s` }));
    socket.once('connect', () => finish({ status: 'ok', cause: 'ok' }));
    socket.once('error', (err: NodeJS.ErrnoException) => finish({ status: 'failed', cause: err.code ? causeFromNodeCode(err.code) : 'unknown', detail: err.code ? `${err.code}: ${err.message}` : err.message }));
  });
}
