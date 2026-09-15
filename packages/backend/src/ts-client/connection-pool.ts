import { PrismaClient } from '../generated/prisma/client.js';
import { WebQueryClient } from './webquery-client.js';
import { decrypt } from '../utils/crypto.js';

export class ConnectionPool {
  private clients: Map<number, WebQueryClient> = new Map();
  // Separate, optional per-server identity used only for bot-flow actions -
  // see the botQueryName/botApiKey comment on TsServerConfig for why.
  private botClients: Map<number, WebQueryClient> = new Map();

  constructor(private prisma: PrismaClient) {}

  async initialize(): Promise<void> {
    const servers = await this.prisma.tsServerConfig.findMany({
      where: { enabled: true },
    });

    for (const server of servers) {
      // H8: Decrypt API key before use
      await this.addClient(server.id, server.host, server.webqueryPort, decrypt(server.apiKey), server.useHttps, server.queryNickname);
      if (server.botApiKey) {
        await this.addBotClient(server.id, server.host, server.webqueryPort, decrypt(server.botApiKey), server.useHttps, server.botQueryName);
      }
    }

    console.log(`[ConnectionPool] Initialized ${this.clients.size} server connection(s), ${this.botClients.size} bot identit${this.botClients.size === 1 ? 'y' : 'ies'}`);
  }

  async addClient(id: number, host: string, port: number, apiKey: string, useHttps: boolean, nickname?: string | null): Promise<void> {
    const client = new WebQueryClient(host, port, apiKey, useHttps);
    this.clients.set(id, client);
    if (nickname) {
      try {
        await client.execute(0, 'clientupdate', { client_nickname: nickname });
      } catch (err: any) {
        console.warn(`[ConnectionPool] Failed to set query identity nickname for server ${id}: ${err.message}`);
      }
    }
  }

  removeClient(id: number): void {
    const client = this.clients.get(id);
    if (client) {
      client.destroy();
      this.clients.delete(id);
    }
    this.removeBotClient(id);
  }

  getClient(configId: number): WebQueryClient {
    const client = this.clients.get(configId);
    if (!client) {
      throw new Error(`No connection configured for server config ID ${configId}`);
    }
    return client;
  }

  hasClient(configId: number): boolean {
    return this.clients.has(configId);
  }

  async refreshClient(configId: number): Promise<void> {
    const server = await this.prisma.tsServerConfig.findUnique({
      where: { id: configId },
    });
    if (server && server.enabled) {
      await this.addClient(server.id, server.host, server.webqueryPort, decrypt(server.apiKey), server.useHttps, server.queryNickname);
    } else {
      this.removeClient(configId);
    }
  }

  /** Every request opens its own TCP connection unless kept alive, and each one the
   * server sees registers as a distinct client - re-apply the nickname on every
   * (re)connect rather than assuming TS remembers it from a previous session. */
  private async addBotClient(id: number, host: string, port: number, apiKey: string, useHttps: boolean, nickname: string | null): Promise<void> {
    const client = new WebQueryClient(host, port, apiKey, useHttps);
    this.botClients.set(id, client);
    if (nickname) {
      try {
        await client.execute(0, 'clientupdate', { client_nickname: nickname });
      } catch (err: any) {
        console.warn(`[ConnectionPool] Failed to set bot identity nickname for server ${id}: ${err.message}`);
      }
    }
  }

  removeBotClient(id: number): void {
    const client = this.botClients.get(id);
    if (client) {
      client.destroy();
      this.botClients.delete(id);
    }
  }

  /** The bot-flow-specific identity if one has been provisioned, otherwise the same
   * shared connection every manual WebUI action already uses. */
  getBotClient(configId: number): WebQueryClient {
    return this.botClients.get(configId) ?? this.getClient(configId);
  }

  async refreshBotClient(configId: number): Promise<void> {
    const server = await this.prisma.tsServerConfig.findUnique({
      where: { id: configId },
    });
    if (server && server.enabled && server.botApiKey) {
      await this.addBotClient(server.id, server.host, server.webqueryPort, decrypt(server.botApiKey), server.useHttps, server.botQueryName);
    } else {
      this.removeBotClient(configId);
    }
  }

  destroy(): void {
    for (const client of this.clients.values()) {
      client.destroy();
    }
    this.clients.clear();
    for (const client of this.botClients.values()) {
      client.destroy();
    }
    this.botClients.clear();
  }
}
