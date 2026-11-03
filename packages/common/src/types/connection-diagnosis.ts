/**
 * Why a connection test failed, as a fixed key the UI turns into a translated remedy.
 * `reset` covers several causes TeamSpeak cannot be told apart by (measured on 6.0.0-beta13.1):
 * HTTP sent to the HTTPS port or the other way round, the manager's address on the query deny list,
 * and the short query flood block - all close the connection without an answer.
 */
export const CONNECTION_CAUSES = [
  'ok',
  'dns',
  'refused',
  'timeout',
  'unreachable',
  'reset',
  'tls-name',
  'tls-untrusted',
  'tls-expired',
  'tls-other',
  'key-rejected',
  'ts-error',
  'unexpected-response',
  // SSH (measured on 6.0.0-beta13.1): wrong user and wrong password look the same.
  'ssh-auth-rejected',
  /**
   * The connection closed before the login. Two causes look the same: the port is not the SSH query
   * port (e.g. the WebQuery port), or TS6 blocks this non-allowlisted address after failed logins (~11 min).
   */
  'ssh-closed',
  // Why a step was not run.
  'not-configured',
  'prerequisite-failed',
  /** A test login for this target ran less than the minimum interval ago (query-ban protection). */
  'rate-limited',
  'unknown',
] as const;
export type ConnectionCause = (typeof CONNECTION_CAUSES)[number];

export interface ConnectionTestResult {
  success: boolean;
  /** The raw error text; kept for clients that read only this field. */
  error?: string;
  cause: ConnectionCause;
  /** The technical detail behind `cause` (error code, TeamSpeak's message); never a secret. */
  detail?: string;
  durationMs: number;
}

export type DiagnosisStepId = 'webquery' | 'ssh' | 'filetransfer' | 'voice' | 'sidecar';

export interface DiagnosisStep {
  id: DiagnosisStepId;
  status: 'ok' | 'failed' | 'skipped';
  cause: ConnectionCause;
  detail?: string;
  durationMs?: number;
  /** Where the SSH verdict came from: the running event session, a login of the test's own, or a refusal remembered from an earlier login. */
  source?: 'live-session' | 'test-login' | 'remembered';
  /** The port the step checked. */
  port?: number;
  /** The virtual server a voice step checked, when its port came from the server list. */
  sid?: number;
}

/** "Test with entered values": the connection form's fields; a blank secret of an existing connection (`configId`) means its stored one. */
export interface DiagnosisRequest {
  configId?: number;
  host: string;
  webqueryPort: number;
  useHttps: boolean;
  /** null: no WebQuery key. */
  apiKey: string | null;
  sshPort: number;
  sshUsername: string;
  sshPassword: string;
}

export interface ConnectionDiagnosis {
  host: string;
  useHttps: boolean;
  steps: DiagnosisStep[];
}
