import axios, { AxiosInstance } from 'axios';
import http from 'http';
import https from 'https';
import { TSApiError } from '../middleware/error-handler.js';
import { config } from '../config.js';
import { isDebugEnabled } from '../utils/debug-flags.js';

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
