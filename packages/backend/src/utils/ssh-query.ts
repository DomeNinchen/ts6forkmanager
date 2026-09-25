import type { Request } from 'express';
import { parseQueryResponse, tsEscape } from '@ts6/common';
import { AppError, TSApiError } from '../middleware/error-handler.js';
import type { BotEngine } from '../bot-engine/engine.js';

/** Thrown when the server config has no usable SSH connection. `ft*` commands
 * are the only reason this app needs SSH for plain request/response work:
 * WebQuery explicitly does not implement them (see doc/server/webquery.md,
 * "the following ServerQuery commands are currently unsupported in WebQuery:
 * ft*, help, login/logout, quit, servernotifyregister/-unregister, use"). */
export const SSH_REQUIRED_MESSAGE =
  'SSH credentials are not configured for this server. File and icon access needs SSH, because the WebQuery HTTP API does not support ft* commands.';

export function isSshUnavailable(err: any): boolean {
  return Boolean(err?.message?.includes('SSH not connected') || err?.message?.includes('SSH credentials'));
}

/** Turn an SSH-availability failure into a 400 with a consistent explanation,
 * and leave every other error untouched. */
export function toSshAppError(err: any): any {
  return isSshUnavailable(err) ? new AppError(400, SSH_REQUIRED_MESSAGE) : err;
}

/**
 * Execute a ServerQuery command via the shared SSH connection (EventBridge).
 * Reuses the same SSH session used for bot events — no extra server slots.
 */
export async function sshExecute(
  req: Request,
  command: string,
  params: Record<string, string | number> = {},
): Promise<Record<string, string>[]> {
  const engine: BotEngine = req.app.locals.botEngine;
  if (!engine) throw new AppError(503, 'Bot engine not available');

  const bridge = engine.getEventBridge();
  const configId = parseInt(String(req.params.configId));
  const sid = parseInt(String(req.params.sid));

  // Build raw ServerQuery command string
  const paramStr = Object.entries(params)
    .map(([k, v]) => `${k}=${tsEscape(String(v))}`)
    .join(' ');
  const fullCommand = paramStr ? `${command} ${paramStr}` : command;

  let rawResponse: string;
  try {
    rawResponse = await bridge.executeCommand(configId, sid, fullCommand);
  } catch (err: any) {
    // Convert "TS error {code}: {msg}" to TSApiError
    const match = err.message?.match(/^TS error (\d+): (.+)$/);
    if (match) {
      throw new TSApiError(parseInt(match[1]), match[2]);
    }
    throw err;
  }

  if (!rawResponse.trim()) return [];
  return parseQueryResponse(rawResponse);
}
