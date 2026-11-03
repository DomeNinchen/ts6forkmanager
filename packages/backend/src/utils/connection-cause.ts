import type { ConnectionCause } from '@ts6/common';
import { TSApiError } from '../middleware/error-handler.js';

// Node/axios error codes, as measured against TS6 6.0.0-beta13.1 WebQuery (R10).
const TRANSPORT_CAUSES: Record<string, ConnectionCause> = {
  ENOTFOUND: 'dns',
  EAI_AGAIN: 'dns',
  ECONNREFUSED: 'refused',
  ECONNABORTED: 'timeout', // axios' own request timeout
  ETIMEDOUT: 'timeout',
  EHOSTUNREACH: 'unreachable',
  ENETUNREACH: 'unreachable',
  ECONNRESET: 'reset',
  EPIPE: 'reset',
  ERR_TLS_CERT_ALTNAME_INVALID: 'tls-name',
  CERT_HAS_EXPIRED: 'tls-expired',
  CERT_NOT_YET_VALID: 'tls-expired',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'tls-untrusted',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'tls-untrusted',
  SELF_SIGNED_CERT_IN_CHAIN: 'tls-untrusted',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'tls-untrusted',
  ERR_BAD_REQUEST: 'unexpected-response', // an HTTP 4xx without TeamSpeak's status block
  ERR_BAD_RESPONSE: 'unexpected-response',
};

/** TeamSpeak's "invalid apikey" (HTTP 401). */
const TS_KEY_REJECTED = 5122;

/** Turn a failed WebQuery request into a fixed cause key plus the technical detail behind it. */
export function classifyWebQueryError(err: unknown): { cause: ConnectionCause; detail: string } {
  if (err instanceof TSApiError) {
    if (err.code === TS_KEY_REJECTED) return { cause: 'key-rejected', detail: `${err.code} ${err.message}` };
    if (err.code >= 0) return { cause: 'ts-error', detail: `${err.code} ${err.message}` };
    const code = err.transportCode;
    const cause = code ? causeFromNodeCode(code) : 'unexpected-response';
    return { cause, detail: code ? `${code}: ${err.message}` : err.message };
  }
  return { cause: 'unknown', detail: err instanceof Error ? err.message : String(err) };
}

/** The cause behind a Node socket/TLS error code. */
export function causeFromNodeCode(code: string): ConnectionCause {
  return TRANSPORT_CAUSES[code] ?? (/^ERR_(SSL|TLS)_|^EPROTO$/.test(code) ? 'tls-other' : 'unknown');
}

/** A failed SSH query login, as ssh2 / SshQueryClient report it (measured against TS6, R10 stage 2). */
export function classifySshError(err: any): { cause: ConnectionCause; detail: string } {
  const message = String(err?.message ?? err);
  const level = err?.level as string | undefined;
  let cause: ConnectionCause;
  if (err?.code) cause = causeFromNodeCode(err.code);
  else if (level === 'client-authentication') cause = 'ssh-auth-rejected';
  else if (level === 'client-timeout' || /connect timeout/i.test(message)) cause = 'timeout';
  // Both a wrong port and a blocked address end this way (measured), so they share one cause.
  else if (level === 'protocol' || level === 'closed-before-login') cause = 'ssh-closed';
  else cause = 'unknown';
  return { cause, detail: err?.code ? `${err.code}: ${message}` : message };
}
