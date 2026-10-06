import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AlertTriangle, Loader2 } from 'lucide-react';
import type { BotConnectionInfo } from '@ts6/common';

const KEY = 'pages.musicBots.botPlayerCard.connection';

/** One sentence in plain words for why the server refused a bot; '' when it
 * said nothing specific (a timeout, an unresolvable host, ...). */
export function botFailureKindText(t: TFunction, kind?: string | null): string {
  return kind && kind !== 'other' ? t(`${KEY}.kind.${kind}`) : '';
}

/** Seconds left until `iso`, ticking once a second; null without a target. */
function useSecondsUntil(iso: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [iso]);
  return iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000)) : null;
}

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} min`;
}

/** What a music bot that is not connected is doing about it: connecting right
 * now, waiting for the next automatic attempt (with a countdown), or done
 * trying - and in every case the reason, in the server's own words. */
export function BotConnectionNotice({ connection }: { connection: BotConnectionInfo }) {
  const { t } = useTranslation();
  const wait = useSecondsUntil(connection.phase === 'retrying' ? connection.nextAttemptAt : null);
  const failed = connection.phase === 'failed';
  const params = { attempt: connection.attempt, max: connection.maxAttempts };

  let headline: string;
  if (connection.phase === 'connecting') {
    headline = connection.attempt > 0 ? t(`${KEY}.connectingRetry`, params) : t(`${KEY}.connecting`);
  } else if (connection.phase === 'retrying') {
    headline = t(`${KEY}.retrying`, { ...params, time: formatWait(wait ?? 0) });
  } else {
    headline = connection.attempt >= connection.maxAttempts ? t(`${KEY}.gaveUp`, params) : t(`${KEY}.final`);
  }
  const kindText = botFailureKindText(t, connection.kind);

  return (
    <div
      role="status"
      className={`rounded-md border p-2 text-[11px] space-y-1 ${
        failed ? 'border-red-500/40 bg-red-500/10' : 'border-amber-500/40 bg-amber-500/10'
      }`}
    >
      <div className="flex items-start gap-1.5">
        {failed
          ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px text-red-500" />
          : <Loader2 className="h-3.5 w-3.5 shrink-0 mt-px animate-spin text-amber-500" />}
        <p className="font-medium">{headline}</p>
      </div>
      {kindText && <p className="text-muted-foreground">{kindText}</p>}
      {connection.reason && (
        <p className="text-muted-foreground text-[10px] font-mono-data break-words">
          {t(`${KEY}.details`, { reason: connection.reason })}
        </p>
      )}
      {failed && <p>{t(`${KEY}.pressStart`)}</p>}
    </div>
  );
}
