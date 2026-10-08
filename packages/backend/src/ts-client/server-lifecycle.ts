import type { ConnectionPool } from './connection-pool.js';
import type { BandwidthSampler } from './bandwidth-sampler.js';
import type { TsLoginJournal } from './ts-login-journal.js';
import type { BotEngine } from '../bot-engine/engine.js';
import type { VoiceBotManager } from '../voice/voice-bot-manager.js';
import type { EventSessionManager } from '../console/event-sessions.js';
import { consoleFloodGuard } from '../console/flood-guard.js';

export interface ServerLifecycleDeps {
  pool: ConnectionPool;
  botEngine: Pick<BotEngine, 'reloadServer' | 'stopServer' | 'refreshServerConnections'>;
  voiceBots: Pick<VoiceBotManager, 'syncServerHost' | 'dropServerBots'>;
  consoleEvents: Pick<EventSessionManager, 'closeConfig'>;
  bandwidthSampler: Pick<BandwidthSampler, 'refresh'>;
  loginJournal: Pick<TsLoginJournal, 'refresh'>;
}

/**
 * What has to happen, across the whole backend, when a server connection is
 * created, edited or deleted while the backend is running.
 *
 * Each of those is a database write plus a number of services that built
 * something from the old row: the connection pool's clients, the bot engine's
 * flows and SSH sessions, the music bots, the console's live listeners, the
 * samplers. Before this class the routes updated the pool and a part of the
 * rest, so a connection edited or removed in the UI only took full effect
 * after a backend restart. The routes now hand over what changed and this
 * decides who needs to hear about it - one place to extend when another
 * service starts holding per-connection state.
 */
export class ServerLifecycle {
  constructor(private readonly deps: ServerLifecycleDeps) {}

  /** A connection row was created. */
  async created(configId: number): Promise<void> {
    await this.deps.pool.syncServer(configId);
    this.pokeSamplers();
    this.pokeJournal();
  }

  /**
   * A connection row was edited. `changed` are the columns the edit wrote; an
   * edit that touches none of what the services were built from (a rename) costs nothing.
   */
  async updated(configId: number, changed: ReadonlySet<string>): Promise<void> {
    const touches = (...fields: string[]) => fields.some((field) => changed.has(field));
    const { pool, botEngine, voiceBots, consoleEvents } = this.deps;

    // The WebQuery clients (and the identities' nicknames) are built from these.
    if (touches('host', 'webqueryPort', 'apiKey', 'useHttps', 'enabled', 'queryNickname', 'botQueryName')) {
      await pool.syncServer(configId);
    }

    if (touches('enabled')) {
      // Disabled: the flows must stop acting on a connection that has no client; enabled: they come back.
      // Starting the flows again also reconnects their SSH sessions on the current credentials.
      await botEngine.reloadServer(configId);
      await consoleEvents.closeConfig(configId);
    } else if (touches('host', 'sshPort', 'sshUsername', 'sshPassword')) {
      // Event registrations and command listeners are still running on the old
      // credentials - connecting is a no-op while a session exists - so force a reconnect.
      await botEngine.refreshServerConnections(configId);
      // The query console's live-event listeners are SSH sessions of their own and need the same.
      await consoleEvents.closeConfig(configId);
    }

    // Loaded music bots connect to the host the next time they connect.
    if (touches('host')) await voiceBots.syncServerHost(configId);

    // What the console's flood guard read from the old connection is not known to hold for the new one.
    if (touches('host', 'webqueryPort', 'apiKey', 'useHttps')) consoleFloodGuard.forget(configId);

    if (touches('host', 'webqueryPort', 'apiKey', 'useHttps', 'enabled')) this.pokeSamplers();

    // The connection journal rebuilds what it watches on a changed way in, and starts or stops on its own switch.
    if (touches('name', 'host', 'webqueryPort', 'apiKey', 'useHttps', 'sshPort', 'sshUsername', 'sshPassword', 'enabled', 'recordConnectionJournal')) {
      this.pokeJournal();
    }
  }

  /**
   * A connection row was deleted (its dependent rows with it, by cascade). Works
   * from what the services hold in memory, so nothing here reads the database.
   */
  async deleted(configId: number): Promise<void> {
    const { pool, botEngine, voiceBots, consoleEvents } = this.deps;
    pool.removeClient(configId);
    await botEngine.stopServer(configId);
    await voiceBots.dropServerBots(configId);
    await consoleEvents.closeConfig(configId);
    consoleFloodGuard.forget(configId);
    // Its sessions are closed with "recording stopped"; the rows stay in the journal.
    this.pokeJournal();
  }

  /** Lets the connection journal look at the connections now rather than at its next 30-second pass. Never throws, never blocks. */
  private pokeJournal(): void {
    void this.deps.loginJournal.refresh().catch(() => undefined);
  }

  /** Lets the dashboard sampler look at the new set of connections now rather than at its next 2-minute pass. Never throws, never blocks. */
  private pokeSamplers(): void {
    void this.deps.bandwidthSampler.refresh().catch(() => undefined);
  }
}
