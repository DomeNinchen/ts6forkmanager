import net from 'net';
import type { ConnectionDiagnosis, DiagnosisStep } from '@ts6/common';
import { WebQueryClient } from '../ts-client/webquery-client.js';
import { SshQueryClient } from '../bot-engine/ssh-query-client.js';
import { causeFromNodeCode, classifySshError, classifyWebQueryError } from './connection-cause.js';
import { claimTestLogin, sshRejection, type SshCredentials } from './ssh-login-guard.js';

export interface DiagnosisTarget {
  host: string;
  useHttps: boolean;
  webqueryPort: number;
  /** null: the connection has no key. A stored key that cannot be used is reported through `apiKeyProblem`. */
  apiKey: string | null;
  apiKeyProblem?: string;
  ssh: Omit<SshCredentials, 'host'> | null;
  sshProblem?: string;
}

const FT_CONNECT_TIMEOUT_MS = 5000;

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
