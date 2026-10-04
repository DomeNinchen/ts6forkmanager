import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Copy, Eye, EyeOff } from 'lucide-react';
import { isSecretKey, type ConsoleEvent } from '@ts6/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { explainValue } from '@/lib/console/explain';
import { eventToLine, primaryCategory, summarizeEvent } from '@/lib/console/events';
import { cn } from '@/lib/utils';
import { ExplainPanel, copy, type SelectedCell } from './ResultView';

interface EventEntryProps {
  event: ConsoleEvent;
  /** The virtual server the event happened on. */
  sid: number;
  configId: number | null;
}

/** One live event in the transcript: a line that says what happened, and under it - on a click - every field TeamSpeak sent. */
export const EventEntry = memo(function EventEntry({ event, sid, configId }: EventEntryProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());

  const summary = summarizeEvent(event);
  const category = primaryCategory(event);
  const fields = Object.entries(event.data);

  const toggleSecret = (key: string) =>
    setRevealed((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <div className="text-xs">
      <button
        type="button"
        className="flex w-full items-baseline gap-2 rounded px-1 py-0.5 text-left hover:bg-muted/30"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight className={cn('h-3 w-3 shrink-0 self-center text-muted-foreground transition-transform', open && 'rotate-90')} />
        <span className="shrink-0 text-muted-foreground">{new Date(event.at).toLocaleTimeString()}</span>
        <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
          {category ? t(`pages.console.events.categories.${category}.short`) : t('pages.console.events.other')}
        </Badge>
        <span className="break-all">{t(`pages.console.events.summary.${summary.key}`, summary.values)}</span>
      </button>

      {open && (
        <div className="ml-5 mt-1 space-y-2">
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full border-collapse font-mono text-xs">
              <tbody>
                {fields.map(([key, value]) => {
                  const secret = value !== '' && isSecretKey(key);
                  const shown = !secret || revealed.has(key);
                  const explained = shown && explainValue(key, value, event.data) !== null;
                  return (
                    <tr key={key} className="border-t border-border/60 first:border-t-0">
                      <td className="whitespace-nowrap px-2 py-1 align-top text-muted-foreground">{key}</td>
                      <td className="px-2 py-1 align-top">
                        {secret ? (
                          <span className="inline-flex items-center gap-1">
                            <span className={shown ? 'select-all break-all' : 'select-none text-muted-foreground'}>{shown ? value : '••••••••'}</span>
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-foreground"
                              title={shown ? t('pages.console.result.hideSecrets') : t('pages.console.result.revealSecrets')}
                              onClick={() => toggleSecret(key)}
                            >
                              {shown ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className={cn(
                              'break-all text-left hover:text-primary',
                              explained && 'underline decoration-dotted underline-offset-2',
                              selected?.field === key && 'text-primary',
                            )}
                            onClick={() => setSelected({ field: key, value, record: event.data })}
                          >
                            {value === '' ? <span className="text-muted-foreground">{'·'}</span> : value}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => copy(eventToLine(event))}>
            <Copy className="mr-1 h-3 w-3" /> {t('pages.console.result.copyRaw')}
          </Button>
          {selected && <ExplainPanel cell={selected} configId={configId} sid={sid} onClose={() => setSelected(null)} />}
        </div>
      )}
    </div>
  );
});
