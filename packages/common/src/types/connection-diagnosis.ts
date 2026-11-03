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
