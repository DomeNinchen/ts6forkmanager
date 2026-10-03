import axios, { AxiosInstance, AxiosResponse } from 'axios';
import http from 'http';
import https from 'https';
import { TSApiError } from '../middleware/error-handler.js';
import { config } from '../config.js';
import { isDebugEnabled } from '../utils/debug-flags.js';

/** TeamSpeak's answer to one command, as WebQuery delivered it. */
export interface WebQueryEnvelope {
  httpStatus: number;
  /** TeamSpeak's own verdict, code 0 = ok. -1 when the answer was not TeamSpeak's JSON status block at all. */
  status: { code: number; message: string; extraMessage?: string };
  /** The result records; empty for commands that return nothing and for an empty result set. */
  body: unknown[];
  /** TeamSpeak reported 1281 (empty result set), which its own WebQuery docs say to treat as OK. */
  emptyResult: boolean;
}

function toEnvelope(httpStatus: number, data: unknown): WebQueryEnvelope {
  const status = (data as any)?.status;
  if (status && typeof status.code === 'number') {
    if (status.code === 1281) {
      return { httpStatus, status: { code: 0, message: 'ok' }, body: [], emptyResult: true };
    }
    const rawBody = (data as any).body;
    const body = Array.isArray(rawBody) ? rawBody : rawBody && typeof rawBody === 'object' ? [rawBody] : [];
    return {
      httpStatus,
      status: {
        code: status.code,
        message: String(status.message ?? ''),
        ...(status.extra_message ? { extraMessage: String(status.extra_message) } : {}),
      },
      body,
      emptyResult: false,
    };
  }
  // Not TeamSpeak's status block: WebQuery answers a route it does not have (e.g. `help`) with a bare
  // "not found" text, and a proxy in front of it could answer with anything.
  const text = typeof data === 'string' ? data.trim() : '';
  return {
    httpStatus,
    status: { code: -1, message: text || 'Unexpected response from WebQuery', extraMessage: `HTTP ${httpStatus}` },
    body: [],
    emptyResult: false,
  };
}

export class WebQueryClient {
  private http: AxiosInstance;
  private agent: http.Agent | https.Agent;
  private target: string;

  constructor(
    host: string,
    port: number,
    apiKey: string,
    useHttps: boolean = false,
  ) {
    this.target = `${host}:${port}`;
    const protocol = useHttps ? 'https' : 'http';

    // Use a single persistent TCP connection (keep-alive) to the TS WebQuery API.
    // Without this, each concurrent request opens a new TCP connection, and the
    // TS server registers each one as a separate "serveradmin" query client
    // (serveradmin, serveradmin1, serveradmin2, ...).
    this.agent = useHttps
      ? new https.Agent({ keepAlive: true, maxSockets: 1, rejectUnauthorized: !config.tsAllowSelfSigned })
      : new http.Agent({ keepAlive: true, maxSockets: 1 });

    this.http = axios.create({
      baseURL: `${protocol}://${host}:${port}`,
      headers: { 'x-api-key': apiKey },
      timeout: 15000,
      httpAgent: useHttps ? undefined : this.agent,
      httpsAgent: useHttps ? this.agent : undefined,
    });
  }

  async execute(sid: number, command: string, params?: Record<string, any>): Promise<any> {
    const cleaned = this.cleanParams(params);
    const debug = isDebugEnabled('query');
    if (debug) {
      console.log(`[WebQuery ${this.target}] → GET sid=${sid} ${command}${cleaned ? ' ' + JSON.stringify(cleaned) : ''}`);
    }
    try {
      // WebQuery URL pattern: /{sid}/{command}
      // For instance-level commands (sid=0): /{command}
      const path = sid > 0 ? `/${sid}/${command}` : `/${command}`;

      const response = await this.http.get(path, { params: cleaned });

      const data = response.data;

      if (data.status && data.status.code !== 0) {
        // 1281 = ERROR_database_empty_result - TeamSpeak's own WebQuery docs
        // say this "can happen if there are no entries in a database, but for
        // client purposes you may wish to treat this as OK" - e.g. a list
        // command genuinely finding zero matching rows is not a failure.
        if (data.status.code === 1281) {
          if (debug) console.log(`[WebQuery ${this.target}] ← ok (empty result set)`);
          return [];
        }
        if (debug) console.log(`[WebQuery ${this.target}] ← error id=${data.status.code} msg=${data.status.message}`);
        throw new TSApiError(data.status.code, data.status.message);
      }

      if (debug) console.log(`[WebQuery ${this.target}] ← ok ${JSON.stringify(data.body ?? data)}`);
      return data.body || data;
    } catch (error: any) {
      if (error instanceof TSApiError) throw error;
      if (error.response?.data?.status) {
        if (debug) console.log(`[WebQuery ${this.target}] ← error id=${error.response.data.status.code} msg=${error.response.data.status.message}`);
        throw new TSApiError(
          error.response.data.status.code,
          error.response.data.status.message,
        );
      }
      if (debug) console.log(`[WebQuery ${this.target}] ← failed: ${error.message}`);
      throw new TSApiError(-1, error.message || 'Connection failed');
    }
  }

  async executePost(sid: number, command: string, params?: Record<string, any>): Promise<any> {
    const cleaned = this.cleanParams(params);
    const debug = isDebugEnabled('query');
    if (debug) {
      console.log(`[WebQuery ${this.target}] → POST sid=${sid} ${command}${cleaned ? ' ' + JSON.stringify(cleaned) : ''}`);
    }
    try {
      const path = sid > 0 ? `/${sid}/${command}` : `/${command}`;
      const response = await this.http.post(path, null, { params: cleaned });

      const data = response.data;
      if (data.status && data.status.code !== 0) {
        if (data.status.code === 1281) {
          if (debug) console.log(`[WebQuery ${this.target}] ← ok (empty result set)`);
          return [];
        }
        if (debug) console.log(`[WebQuery ${this.target}] ← error id=${data.status.code} msg=${data.status.message}`);
        throw new TSApiError(data.status.code, data.status.message);
      }

      if (debug) console.log(`[WebQuery ${this.target}] ← ok ${JSON.stringify(data.body ?? data)}`);
      return data.body || data;
    } catch (error: any) {
      if (error instanceof TSApiError) throw error;
      if (error.response?.data?.status) {
        if (error.response.data.status.code === 1281) {
          if (debug) console.log(`[WebQuery ${this.target}] ← ok (empty result set)`);
          return [];
        }
        if (debug) console.log(`[WebQuery ${this.target}] ← error id=${error.response.data.status.code} msg=${error.response.data.status.message}`);
        throw new TSApiError(
          error.response.data.status.code,
          error.response.data.status.message,
        );
      }
      if (debug) console.log(`[WebQuery ${this.target}] ← failed: ${error.message}`);
      throw new TSApiError(-1, error.message || 'Connection failed');
    }
  }

  // Like executePost, but sends `body` as a real JSON request body instead of query
  // params - needed for commands that take an array for one parameter (e.g. clientmove's
  // `clid`, to move several clients in one call: { cid: 3, clid: [1, 4] }). WebQuery's own
  // docs show this exact array-in-JSON-body form; query-string params can't express an
  // array unambiguously the same way. Confirmed working live against a real TS6 server
  // (clientmove with a 2-element clid array moved both clients in one call).
  async executeJsonBody(sid: number, command: string, body: Record<string, any>): Promise<any> {
    const debug = isDebugEnabled('query');
    if (debug) {
      console.log(`[WebQuery ${this.target}] → POST(json) sid=${sid} ${command} ${JSON.stringify(body)}`);
    }
    try {
      const path = sid > 0 ? `/${sid}/${command}` : `/${command}`;
      const response = await this.http.post(path, body);

      const data = response.data;
      if (data.status && data.status.code !== 0) {
        if (data.status.code === 1281) {
          if (debug) console.log(`[WebQuery ${this.target}] ← ok (empty result set)`);
          return [];
        }
        if (debug) console.log(`[WebQuery ${this.target}] ← error id=${data.status.code} msg=${data.status.message}`);
        throw new TSApiError(data.status.code, data.status.message);
      }

      if (debug) console.log(`[WebQuery ${this.target}] ← ok ${JSON.stringify(data.body ?? data)}`);
      return data.body || data;
    } catch (error: any) {
      if (error instanceof TSApiError) throw error;
      if (error.response?.data?.status) {
        if (error.response.data.status.code === 1281) {
          if (debug) console.log(`[WebQuery ${this.target}] ← ok (empty result set)`);
          return [];
        }
        if (debug) console.log(`[WebQuery ${this.target}] ← error id=${error.response.data.status.code} msg=${error.response.data.status.message}`);
        throw new TSApiError(
          error.response.data.status.code,
          error.response.data.status.message,
        );
      }
      if (debug) console.log(`[WebQuery ${this.target}] ← failed: ${error.message}`);
      throw new TSApiError(-1, error.message || 'Connection failed');
    }
  }

  /**
   * Sends any command and reports exactly what TeamSpeak answered, without
   * turning a TeamSpeak-level error into an exception - the query console shows
   * the answer as it is instead of guessing what the caller wants done with it.
   * Only a failure to reach the server at all throws.
   *
   * `payload` becomes the JSON request body: one object for a single command, or
   * an array of objects for a `a=1|a=2` style list (WebQuery's own form for it,
   * see doc/server/webquery.md). Options such as `-uid` are keys with an empty
   * value. Parameters are never put into the URL, so an API key in a parameter
   * can not override the real one.
   */
  async executeRaw(
    sid: number,
    command: string,
    payload?: Record<string, string> | Record<string, string>[],
  ): Promise<WebQueryEnvelope> {
    // The name becomes part of the URL path, so nothing but a plain command name may get through.
    if (!/^[a-z][a-z0-9_]*$/.test(command)) {
      throw new TSApiError(-1, 'Invalid command name');
    }
    const debug = isDebugEnabled('query');
    // Deliberately no parameters in the log line: the console is where passwords and keys get typed.
    if (debug) console.log(`[WebQuery ${this.target}] → console POST sid=${sid} ${command}`);

    let response: AxiosResponse;
    try {
      const path = sid > 0 ? `/${sid}/${command}` : `/${command}`;
      response = await this.http.post(path, payload ?? {}, { validateStatus: () => true });
    } catch (error: any) {
      if (debug) console.log(`[WebQuery ${this.target}] ← failed: ${error.message}`);
      throw new TSApiError(-1, error.message || 'Connection failed');
    }

    const envelope = toEnvelope(response.status, response.data);
    if (debug) console.log(`[WebQuery ${this.target}] ← console ${command} id=${envelope.status.code} msg=${envelope.status.message}`);
    return envelope;
  }

  // Remove undefined/null values from params
  private cleanParams(params?: Record<string, any>): Record<string, any> | undefined {
    if (!params) return undefined;
    const cleaned: Record<string, any> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        cleaned[key] = value;
      }
    }
    return Object.keys(cleaned).length > 0 ? cleaned : undefined;
  }

  // Test connection
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.execute(0, 'version');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || 'Connection failed' };
    }
  }

  // Destroy the HTTP agent, closing all keep-alive sockets.
  // Call this for temporary clients (e.g. test connection) to avoid lingering query logins.
  destroy(): void {
    this.agent.destroy();
  }
}
