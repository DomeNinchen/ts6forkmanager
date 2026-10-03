import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Eye, EyeOff, X } from 'lucide-react';
import { toast } from 'sonner';
import { isSecretKey, type ConsoleExecuteResponse } from '@ts6/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import i18n from '@/lib/i18n';
import { cn, formatBytes } from '@/lib/utils';
import { groupRecords, hasSecret, toJson, toRawText } from '@/lib/console/format';
import { explainValue, type ValueMeaning } from '@/lib/console/explain';
import { useEntityList } from '@/lib/console/entities';

interface ResultViewProps {
  result: ConsoleExecuteResponse;
  configId: number | null;
}

/** More rows than this in one table are folded away behind a button: a large listing would otherwise freeze the page. */
const ROW_LIMIT = 300;

interface SelectedCell {
  field: string;
  value: string;
  record: Record<string, string>;
}

/** The browser only offers the clipboard on https and on localhost; elsewhere `navigator.clipboard` does not exist. */
function copy(text: string) {
  const failed = () => toast.error(i18n.t('pages.console.result.copyFailed'));
  if (!navigator.clipboard) return failed();
  navigator.clipboard.writeText(text).then(() => toast.success(i18n.t('common.copied')), failed);
}

function EntityNames({ meaning, configId, sid }: { meaning: Extract<ValueMeaning, { kind: 'entity' }>; configId: number | null; sid: number }) {
  const { t } = useTranslation();
  const list = useEntityList(meaning.entity, configId, sid, true);
  if (list.isLoading) return <span className="text-muted-foreground">{t('common.loading')}</span>;
  const names = new Map((list.data ?? []).map((item) => [item.id, item.name]));
  return (
    <ul className="space-y-0.5">
      {meaning.ids.map((id) => (
        <li key={id} className="font-mono">
          {id} <span className="text-muted-foreground">{'→'}</span>{' '}
          {names.has(id) ? (
            <span className="font-sans text-foreground">{names.get(id)}</span>
          ) : (
            <span className="font-sans text-muted-foreground">
              {id === '0' ? t('pages.console.explain.none') : t('pages.console.explain.notFound')}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Meaning({ meaning, configId, sid }: { meaning: ValueMeaning; configId: number | null; sid: number }) {
  const { t } = useTranslation();
  switch (meaning.kind) {
    case 'enum':
      return <span className="font-mono">{meaning.name}</span>;
    case 'yesNo':
      return <span>{meaning.yes ? t('common.yes') : t('common.no')}</span>;
    case 'clientType':
      return <span>{meaning.query ? t('pages.console.explain.queryClient') : t('pages.console.explain.voiceClient')}</span>;
    case 'timestamp':
      return <span>{meaning.date.toLocaleString()}</span>;
    case 'duration':
      return <span>{meaning.text}</span>;
    case 'bytes':
      return (
        <span>
          {formatBytes(meaning.bytes)}
          {meaning.perSecond ? '/s' : ''}
        </span>
      );
    case 'entity':
      return <EntityNames meaning={meaning} configId={configId} sid={sid} />;
  }
}

function ExplainPanel({ cell, configId, sid, onClose }: { cell: SelectedCell; configId: number | null; sid: number; onClose: () => void }) {
  const { t } = useTranslation();
  const meaning = explainValue(cell.field, cell.value, cell.record);
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="font-mono font-semibold">{cell.field}</span>
        <Button variant="ghost" size="sm" className="ml-auto h-6 px-1.5" onClick={() => copy(cell.value)} title={t('common.copy')}>
          <Copy className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="sm" className="h-6 px-1.5" onClick={onClose} title={t('common.close')}>
          <X className="h-3 w-3" />
        </Button>
      </div>
      <div className="break-all font-mono">{cell.value || <span className="text-muted-foreground">{t('pages.console.explain.empty')}</span>}</div>
      <div className="mt-2 border-t border-border pt-2">
        {meaning ? (
          <Meaning meaning={meaning} configId={configId} sid={sid} />
        ) : (
          <span className="text-muted-foreground">{t('pages.console.explain.nothingToExplain')}</span>
        )}
      </div>
    </div>
  );
}

export function ResultView({ result, configId }: ResultViewProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<'table' | 'raw'>('table');
  const [revealAll, setRevealAll] = useState(false);
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [selected, setSelected] = useState<SelectedCell | null>(null);

  const groups = useMemo(() => groupRecords(result.records), [result.records]);
  const containsSecret = useMemo(() => hasSecret(result.records), [result.records]);

  const { status } = result;
  const hint =
    status.code === 5120
      ? t('pages.console.hints.outOfScope')
      : status.code === -1
        ? t('pages.console.hints.noAnswer')
        : // 256 for a command WebQuery knows by name but the server lacks, 1538 "unknown command" for one it has never heard of.
          status.code === 256 || status.extraMessage === 'unknown command'
          ? t('pages.console.hints.unknownCommand')
          : null;

  const toggleCell = (id: string) =>
    setRevealed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className={cn('font-mono font-semibold', result.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive')}>
          error id={status.code} msg={status.message}
        </span>
        {status.extraMessage && <span className="text-muted-foreground">({status.extraMessage})</span>}
        {result.emptyResult && <Badge variant="secondary">{t('pages.console.result.emptyResult')}</Badge>}
        {result.recordCount > 0 && <span className="text-muted-foreground">{t('pages.console.result.records', { count: result.recordCount })}</span>}
        <span className="text-muted-foreground">{result.durationMs} ms</span>
        {result.loggedToTeamSpeak && <span className="text-muted-foreground">{t('pages.console.result.loggedToTeamSpeak')}</span>}
      </div>

      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {result.truncated && (
        <p className="text-xs text-amber-600 dark:text-amber-400">{t('pages.console.result.truncated', { shown: result.records.length, total: result.recordCount })}</p>
      )}

      {result.records.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="inline-flex rounded-md bg-muted p-0.5 text-xs">
            {(['table', 'raw'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={cn('rounded px-2 py-0.5', view === mode ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground')}
                onClick={() => setView(mode)}
              >
                {mode === 'table' ? t('pages.console.result.tableView') : t('pages.console.result.rawView')}
              </button>
            ))}
          </div>
          {containsSecret && (
            <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => setRevealAll((v) => !v)}>
              {revealAll ? <EyeOff className="mr-1 h-3 w-3" /> : <Eye className="mr-1 h-3 w-3" />}
              {revealAll ? t('pages.console.result.hideSecrets') : t('pages.console.result.revealSecrets')}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => copy(toRawText(result.records, status, { revealSecrets: revealAll }))}
          >
            <Copy className="mr-1 h-3 w-3" /> {t('pages.console.result.copyRaw')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => copy(toJson(result.records, { revealSecrets: revealAll }))}
          >
            <Copy className="mr-1 h-3 w-3" /> {t('pages.console.result.copyJson')}
          </Button>
        </div>
      )}

      {view === 'raw' && result.records.length > 0 ? (
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/30 p-3 font-mono text-xs">
          {toRawText(result.records, status, { revealSecrets: revealAll })}
        </pre>
      ) : (
        groups.map((group, groupIndex) => {
          const limited = group.records.length > ROW_LIMIT && !expanded.has(groupIndex);
          const rows = limited ? group.records.slice(0, ROW_LIMIT) : group.records;
          return (
            <div key={groupIndex} className="overflow-x-auto rounded-md border border-border">
              <table className="w-full border-collapse font-mono text-xs">
                <thead>
                  <tr className="bg-muted/50 text-left text-muted-foreground">
                    {group.keys.map((key) => (
                      <th key={key} className="whitespace-nowrap px-2 py-1 font-medium">
                        {key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((record, rowIndex) => (
                    <tr key={rowIndex} className="border-t border-border/60 hover:bg-muted/20">
                      {group.keys.map((key) => {
                        const value = record[key];
                        const cellId = `${groupIndex}:${rowIndex}:${key}`;
                        const secret = value !== '' && isSecretKey(key);
                        const shown = !secret || revealAll || revealed.has(cellId);
                        const explained = shown && explainValue(key, value, record) !== null;
                        return (
                          <td key={key} className="max-w-[24rem] whitespace-nowrap px-2 py-1 align-top">
                            {secret ? (
                              <span className="inline-flex items-center gap-1">
                                <span className={shown ? 'select-all' : 'select-none text-muted-foreground'}>{shown ? value : '••••••••'}</span>
                                <button
                                  type="button"
                                  className="text-muted-foreground hover:text-foreground"
                                  title={shown ? t('pages.console.result.hideSecrets') : t('pages.console.result.revealSecrets')}
                                  onClick={() => toggleCell(cellId)}
                                >
                                  {shown ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                                </button>
                                {shown && (
                                  <button
                                    type="button"
                                    className="text-muted-foreground hover:text-foreground"
                                    title={t('common.copy')}
                                    onClick={() => copy(value)}
                                  >
                                    <Copy className="h-3 w-3" />
                                  </button>
                                )}
                              </span>
                            ) : (
                              <button
                                type="button"
                                className={cn(
                                  'block max-w-full truncate text-left hover:text-primary',
                                  explained && 'underline decoration-dotted underline-offset-2',
                                  selected?.field === key && selected.record === record && 'text-primary',
                                )}
                                title={value}
                                onClick={() => setSelected({ field: key, value, record })}
                              >
                                {value === '' ? <span className="text-muted-foreground">{'·'}</span> : value}
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {limited && (
                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-1 border-t border-border py-1.5 text-xs text-primary hover:bg-muted/30"
                  onClick={() => setExpanded((current) => new Set(current).add(groupIndex))}
                >
                  {t('pages.console.result.showAll', { count: group.records.length })}
                </button>
              )}
            </div>
          );
        })
      )}

      {selected && view === 'table' && (
        <ExplainPanel cell={selected} configId={configId} sid={result.sid} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
