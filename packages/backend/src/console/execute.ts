import {
  formatQueryLine,
  getDangerReason,
  isReadOnlyCommand,
  isSecretKey,
  parseQueryLine,
  type ConsoleErrorBody,
  type ConsoleExecuteResponse,
  type ConsoleSettings,
  type ParsedQueryLine,
} from '@ts6/common';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { ConnectionPool } from '../ts-client/connection-pool.js';
import type { WebQueryEnvelope } from '../ts-client/webquery-client.js';
import { finishAudit, pruneAuditIfDue, startAudit } from './audit.js';
import { consoleFloodGuard } from './flood-guard.js';
import { buildLogMessage, writeTeamSpeakLog } from './ts-log.js';

/** A command line is one line of typing; this only stops something absurd from being parsed. */
export const MAX_LINE_LENGTH = 8192;
/** Items in one `a=1|a=2|...` list. */
export const MAX_LIST_ITEMS = 200;
/** Values in the audit trail and the TeamSpeak log are cut to this length. */
const MAX_LOGGED_VALUE_LENGTH = 500;
/** Roughly how much reply the browser is sent; a snapshot or a huge log view could be far bigger. */
const MAX_RESULT_CHARS = 2_000_000;

export interface ExecuteContext {
  prisma: PrismaClient;
  pool: ConnectionPool;
  user: { id: number; username: string };
  configId: number;
  serverName: string;
  sid: number;
  line: string;
  confirm?: string;
  settings: ConsoleSettings;
}

export type ExecuteOutcome =
  | { ok: true; response: ConsoleExecuteResponse }
  | { ok: false; httpStatus: number; body: ConsoleErrorBody };

function refuse(httpStatus: number, body: ConsoleErrorBody): ExecuteOutcome {
  return { ok: false, httpStatus, body };
}

/**
 * The typed command as WebQuery wants it: one JSON object, or - for an
 * `a=1|a=2` list - an array with one object per item, exactly as the items were
 * written. Options (`-uid`) are keys with an empty value.
 */
export function toWebQueryPayload(command: Pick<ParsedQueryLine, 'options' | 'blocks'>): Record<string, string> | Record<string, string>[] {
  const options: Record<string, string> = {};
  for (const option of command.options) options[option] = '';

  const [first, ...rest] = command.blocks;
  if (rest.length === 0) return { ...options, ...first };
  return [{ ...options, ...first }, ...rest];
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function shapeRecords(body: unknown[]): { records: Record<string, string>[]; recordCount: number; truncated: boolean } {
  const records: Record<string, string>[] = [];
  let size = 0;
  let truncated = false;

  for (const item of body) {
    const record: Record<string, string> = {};
    if (item && typeof item === 'object') {
      for (const [key, value] of Object.entries(item)) record[key] = stringifyValue(value);
    } else {
      record.value = stringifyValue(item);
    }
    size += JSON.stringify(record).length;
    if (size > MAX_RESULT_CHARS) {
      truncated = true;
      break;
    }
    records.push(record);
  }
  return { records, recordCount: body.length, truncated };
}

/**
 * Runs one console command: parse, insist on confirmation for the dangerous
 * ones, keep clear of the query flood limit, write the audit row (and, for a
 * command that changes something, the TeamSpeak log line), then send it.
 *
 * TeamSpeak's own verdict - including an error - is a normal result here, not a
 * failure of this function: the admin typed the command precisely to see what
 * TeamSpeak says. Only a command that never went out (unparseable, unconfirmed,
 * held back by the flood guard) comes back as a refusal.
 */
export async function executeConsoleCommand(ctx: ExecuteContext): Promise<ExecuteOutcome> {
  const { prisma, pool, user, configId, serverName, sid, line, confirm, settings } = ctx;

  if (line.length > MAX_LINE_LENGTH) {
    return refuse(400, { code: 'INVALID_REQUEST', error: `A command line can be at most ${MAX_LINE_LENGTH} characters long` });
  }

  const parsed = parseQueryLine(line);
  if (!parsed.ok) {
    return refuse(400, { code: 'PARSE_ERROR', error: 'The command line could not be understood', parseError: parsed.error });
  }
  const command = parsed.value;
  if (command.blocks.length > MAX_LIST_ITEMS) {
    return refuse(400, { code: 'INVALID_REQUEST', error: `A list can have at most ${MAX_LIST_ITEMS} items` });
  }

  // Enforced here and not only in the dialog the frontend shows: the API has
  // to be safe against anything that can send it a request.
  const dangerReason = getDangerReason(command.command);
  if (dangerReason && confirm !== command.command) {
    return refuse(428, {
      code: 'CONFIRMATION_REQUIRED',
      error: `${command.command} needs to be confirmed`,
      command: command.command,
      reason: dangerReason,
    });
  }

  const mutating = !isReadOnlyCommand(command.command);
  if (settings.floodGuardEnabled) {
    // A command that is also logged to the TeamSpeak server log is two commands to its flood counter.
    const verdict = await consoleFloodGuard.acquire(pool, configId, mutating ? 2 : 1);
    if (!verdict.ok) {
      return refuse(429, {
        code: 'RATE_LIMITED',
        error: "Too many commands in a short time; TeamSpeak's query flood protection would ban the whole app",
        retryAfterMs: verdict.retryAfterMs,
      });
    }
  }

  const client = pool.getClient(configId);
  const loggedCommand = formatQueryLine(command, { maskKey: isSecretKey, maxValueLength: MAX_LOGGED_VALUE_LENGTH });

  const auditId = await startAudit(prisma, {
    userId: user.id,
    username: user.username,
    serverConfigId: configId,
    serverName,
    virtualServerId: sid,
    command: loggedCommand,
    commandName: command.command,
    danger: dangerReason !== null,
    mutating,
  });
  void pruneAuditIfDue(prisma, settings.auditRetentionDays);

  // Before the command, not after: one that takes the whole TeamSpeak process
  // down never gets to write a line afterwards.
  const loggedToTeamSpeak = mutating
    ? await writeTeamSpeakLog(client, sid, buildLogMessage(user.username, loggedCommand))
    : false;

  const startedAt = Date.now();
  let answer: WebQueryEnvelope;
  try {
    answer = await client.executeRaw(sid, command.command, toWebQueryPayload(command));
  } catch (err: any) {
    // TeamSpeak could not be reached at all.
    answer = { httpStatus: 0, status: { code: -1, message: err?.message || 'Connection failed' }, body: [], emptyResult: false };
  }
  const durationMs = Date.now() - startedAt;
  const ok = answer.status.code === 0;

  await finishAudit(prisma, auditId, {
    status: ok ? 'ok' : 'error',
    errorCode: ok ? null : answer.status.code,
    errorMessage: ok ? null : answer.status.message,
    durationMs,
    loggedToTeamSpeak,
  });

  const { records, recordCount, truncated } = shapeRecords(answer.body);
  return {
    ok: true,
    response: {
      command: command.command,
      sid,
      ok,
      status: answer.status,
      emptyResult: answer.emptyResult,
      records,
      recordCount,
      truncated,
      durationMs,
      warnings: command.warnings,
      loggedToTeamSpeak,
    },
  };
}
