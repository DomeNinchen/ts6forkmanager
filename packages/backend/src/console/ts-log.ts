import type { WebQueryClient } from '../ts-client/webquery-client.js';

// Every console command that changes something also leaves a line in the
// TeamSpeak server's own log (logadd), so an admin looking at that log sees who
// asked for the change - without this the log only says that the shared query
// identity did it, no matter which WebGUI user was behind it.

/** logadd's own scale: 1 error, 2 warning, 3 debug, 4 info. */
const LOG_LEVEL_INFO = '4';
/** Long enough for a normal command; a `channeledit` with a huge description is shortened, not refused. */
export const LOG_MESSAGE_MAX_LENGTH = 400;

export function buildLogMessage(username: string, maskedCommand: string): string {
  const message = `[TS6 Manager] ${username}: ${maskedCommand}`;
  return message.length > LOG_MESSAGE_MAX_LENGTH ? `${message.slice(0, LOG_MESSAGE_MAX_LENGTH - 1)}…` : message;
}

/**
 * Best effort: a query identity without the permission to write to the log (or a
 * log that is full or unavailable) must not stop the command itself, so this
 * never throws. The audit trail in the app's own database is the record that
 * counts; this reports whether the second copy made it.
 */
export async function writeTeamSpeakLog(client: WebQueryClient, sid: number, message: string): Promise<boolean> {
  try {
    const answer = await client.executeRaw(sid, 'logadd', { loglevel: LOG_LEVEL_INFO, logmsg: message });
    return answer.status.code === 0;
  } catch {
    return false;
  }
}
