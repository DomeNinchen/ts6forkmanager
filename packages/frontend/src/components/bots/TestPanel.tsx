import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AlertTriangle, CheckCircle2, CircleSlash, FlaskConical, History, Plus, Trash2, X, XCircle } from 'lucide-react';
import { TS_EVENT_FIELDS, TS_EVENTS, type FlowTestEffect, type FlowTestReport, type FlowTestStep, type TSEventFields } from '@ts6/common';
import { botsApi } from '@/api/bots.api';
import { badgeVariants } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface EditorNode { id: string; type: string; label: string; config: Record<string, any> }

type Row = { key: string; value: string };

/** The measured fields of the event a trigger listens to (a chat command arrives as a text message); undefined: not measured. */
function eventFields(trigger: EditorNode): TSEventFields | undefined {
  const event = trigger.type === 'trigger_command' ? TS_EVENTS.TEXT_MESSAGE : trigger.config.eventName;
  return (TS_EVENT_FIELDS as Record<string, TSEventFields | null>)[event] ?? undefined;
}

/** The sample fields a trigger starts with: the main fields its event carries, plus its own filters. */
function defaultRows(trigger: EditorNode): Row[] {
  const rows: Row[] = (eventFields(trigger)?.main ?? []).map((key) => ({ key, value: key === 'client_type' ? '0' : '' }));
  if (trigger.type === 'trigger_command') {
    const cmd = String(trigger.config.command || '');
    rows.find((r) => r.key === 'msg')!.value = `${cmd.startsWith('!') ? '' : trigger.config.commandPrefix || '!'}${cmd} `;
  }
  for (const [key, value] of Object.entries(trigger.config.filters || {})) {
    const row = rows.find((r) => r.key === key);
    if (row) row.value = String(value); else rows.push({ key, value: String(value) });
  }
  return rows;
}

const TRIGGER_TYPE: Record<string, string> = { trigger_event: 'event', trigger_command: 'command', trigger_webhook: 'webhook', trigger_cron: 'cron' };

/** The webhook secret, if a stored run still has it in its query, is never shown. */
function withoutSecret(queryJson: string): string {
  try {
    const { secret: _s, ...rest } = JSON.parse(queryJson || '{}');
    return JSON.stringify(rest);
  } catch {
    return '{}';
  }
}

function paramText(params: Record<string, unknown>): string {
  return Object.entries(params).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' ');
}

function EffectLine({ effect, t }: { effect: FlowTestEffect; t: TFunction }) {
  switch (effect.kind) {
    case 'write': {
      const command = t(`pages.botEditor.test.commands.${effect.command}`, { defaultValue: effect.command });
      const names = effect.names ? Object.values(effect.names).join(', ') : '';
      return (
        <div className="rounded-sm border border-amber-500/30 bg-amber-500/10 px-1.5 py-1">
          <p className="font-medium text-amber-300">{t('pages.botEditor.test.effect.write', { command })}{names && ` · ${names}`}</p>
          <p className="break-all font-mono-data text-[10px] text-muted-foreground">{effect.command} {paramText(effect.params)}</p>
        </div>
      );
    }
    case 'read':
      return <p className="text-[10px] text-muted-foreground">{t('pages.botEditor.test.effect.read', { command: effect.command, rows: effect.rows })}</p>;
    case 'http':
      return (
        <div className="rounded-sm border border-amber-500/30 bg-amber-500/10 px-1.5 py-1">
          <p className="break-all font-medium text-amber-300">{t('pages.botEditor.test.effect.http', { method: effect.method, url: effect.url })}</p>
          {Object.keys(effect.headers).length > 0 && <p className="break-all font-mono-data text-[10px] text-muted-foreground">{paramText(effect.headers)}</p>}
          {effect.body && <p className="whitespace-pre-wrap break-all font-mono-data text-[10px] text-muted-foreground">{effect.body}</p>}
          {effect.blocked && <p className="text-destructive">{t('pages.botEditor.test.effect.blocked', { reason: effect.blocked })}</p>}
        </div>
      );
    case 'voice':
      return (
        <div className="rounded-sm border border-amber-500/30 bg-amber-500/10 px-1.5 py-1">
          <p className="font-medium text-amber-300">{t('pages.botEditor.test.effect.voice', { action: effect.action })}</p>
          <p className="break-all font-mono-data text-[10px] text-muted-foreground">{paramText(effect.params)}</p>
        </div>
      );
    case 'variable':
      return <p>{t('pages.botEditor.test.effect.variable', { name: effect.name, from: effect.from, to: effect.to })}</p>;
    case 'delay':
      return <p className="text-muted-foreground">{t('pages.botEditor.test.effect.delay', { seconds: effect.ms / 1000 })}</p>;
    case 'note':
      return <p className="text-sky-300">{t(`pages.botEditor.test.note.${effect.code}`)}</p>;
  }
}

/** Something in this step needs a look: it failed, its condition broke, or a placeholder came out empty. */
export function stepProblem(step: FlowTestStep): 'error' | 'warning' | null {
  if (step.error || step.conditionError) return 'error';
  return step.placeholders.some((p) => p.empty) ? 'warning' : null;
}

/**
 * The flow editor's test side panel: pick a trigger, fill in a sample event (or take the last
 * real one), run the editor's current graph as a test and read what it did, step by step.
 * Clicking a step selects its node; the editor marks the path on the canvas from `onResult`.
 */
export function TestPanel({ botId, nodes, edges, template, onClose, onPick, onResult }: {
  botId: number;
  nodes: EditorNode[];
  edges: unknown[];
  template?: unknown;
  onClose: () => void;
  onPick: (nodeId: string) => void;
  onResult: (report: FlowTestReport | null) => void;
}) {
  const { t } = useTranslation();
  const triggers = useMemo(() => nodes.filter((n) => TRIGGER_TYPE[n.type]), [nodes]);
  const [triggerId, setTriggerId] = useState(triggers[0]?.id ?? '');
  const trigger = triggers.find((n) => n.id === triggerId) ?? triggers[0];
  const type = trigger ? TRIGGER_TYPE[trigger.type] : undefined;

  const [rows, setRows] = useState<Row[]>([]);
  const [body, setBody] = useState('{}');
  const [query, setQuery] = useState('{}');
  const [method, setMethod] = useState('POST');
  const [notice, setNotice] = useState<string | null>(null);
  const [report, setReport] = useState<FlowTestReport | null>(null);
  /** Condition node id -> the branch the next test takes there. */
  const [forced, setForced] = useState<Record<string, boolean>>({});
  const fields = trigger ? eventFields(trigger) : undefined;

  // A new trigger starts from its own default fields.
  useEffect(() => {
    if (!trigger) return;
    setRows(defaultRows(trigger));
    setForced({});
    setBody('{}');
    setQuery('{}');
    setMethod(trigger.config.method && trigger.config.method !== 'ANY' ? trigger.config.method : 'POST');
    setNotice(null);
    // Only when the picked trigger changes, not on every edit of its node.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger?.id]);

  const show = (r: FlowTestReport | null) => { setReport(r); onResult(r); };

  const fromLast = useMutation({
    mutationFn: () => botsApi.executions(botId),
    onSuccess: (executions: { id: number; triggeredBy: string; triggerData: string | null; status: string }[]) => {
      const last = executions.find((e) => e.triggeredBy === type && e.status !== 'dropped' && e.triggerData);
      if (!last) return setNotice(t('pages.botEditor.test.fromLastNone'));
      let data: Record<string, string> = {};
      try { data = JSON.parse(last.triggerData!); } catch { /* left empty */ }
      if (type === 'webhook') {
        setBody(data.webhook_body || '{}');
        setQuery(withoutSecret(data.webhook_query));
        if (data.webhook_method) setMethod(data.webhook_method);
      } else {
        // A command's stored data is already enriched; the test enriches the raw message again.
        setRows(Object.entries(data)
          .filter(([k]) => !k.startsWith('command_') && k !== '__cmd_listener_channel_id')
          .map(([key, value]) => ({ key, value: String(value) })));
      }
      setNotice(t('pages.botEditor.test.fromLastDone', { id: last.id }));
    },
    onError: (err: any) => setNotice(t('pages.botEditor.test.failedRequest', { error: err?.response?.data?.error || err.message })),
  });

  const run = useMutation({
    mutationFn: (forceBranches: Record<string, boolean>) => {
      let event: Record<string, string> = {};
      if (type === 'webhook') {
        JSON.parse(body || '{}');
        JSON.parse(query || '{}');
        event = { body, query, method };
      } else if (type !== 'cron') {
        for (const r of rows) if (r.key.trim()) event[r.key.trim()] = r.value;
      }
      return botsApi.test(botId, { flowData: { nodes, edges, ...(template ? { template } : {}) }, triggerNodeId: trigger!.id, event, forceBranches });
    },
    onMutate: () => setNotice(null),
    onSuccess: show,
    onError: (err: any) => {
      show(null);
      setNotice(err instanceof SyntaxError ? t('pages.botEditor.test.invalidJson') : t('pages.botEditor.test.failedRequest', { error: err?.response?.data?.error || err.message }));
    },
  });

  // Closing the panel takes the marks off the canvas.
  useEffect(() => () => onResult(null), [onResult]);

  /** Sets (true/false) or clears (undefined) the branch of one condition, and tests again with it. */
  const force = (nodeId: string, value: boolean | undefined) => {
    const { [nodeId]: _old, ...rest } = forced;
    const next = value === undefined ? rest : { ...rest, [nodeId]: value };
    setForced(next);
    run.mutate(next);
  };

  const effects = report?.steps.flatMap((s) => s.effects) ?? [];
  const writes = effects.filter((e) => e.kind === 'write' || e.kind === 'http' || e.kind === 'voice').length;
  const empty = report?.steps.reduce((n, s) => n + s.placeholders.filter((p) => p.empty).length, 0) ?? 0;

  return (
    <div className="flex w-full shrink-0 flex-col border-l border-border bg-card/50 max-md:absolute max-md:inset-0 max-md:z-40 max-md:border-l-0 max-md:bg-card md:w-96">
      <div className="flex items-center justify-between p-3 pb-2">
        <p className="flex items-center gap-1.5 font-display text-xs font-semibold tracking-wide">
          <FlaskConical className="h-3.5 w-3.5" /> {t('pages.botEditor.test.title')}
        </p>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose} title={t('common.close')} aria-label={t('common.close')}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-3 pt-0 text-xs">
          <p className="text-[11px] text-muted-foreground">{t('pages.botEditor.test.intro')}</p>

          {!trigger && <p className="text-muted-foreground">{t('pages.botEditor.test.noTrigger')}</p>}

          {trigger && (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run.mutate(forced); }}>
              {triggers.length > 1 && (
                <div>
                  <Label className="text-xs">{t('pages.botEditor.test.trigger')}</Label>
                  <Select value={trigger.id} onValueChange={(v) => { setTriggerId(v); show(null); }}>
                    <SelectTrigger className="mt-1 h-8 text-xs" aria-label={t('pages.botEditor.test.trigger')}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {triggers.map((n) => <SelectItem key={n.id} value={n.id}>{n.label} · {t(`pages.botEditor.nodeLabels.${n.type}`, { defaultValue: n.type })}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs">{t('pages.botEditor.test.sample')}</Label>
                  {type !== 'cron' && (
                    <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => fromLast.mutate()} disabled={fromLast.isPending}>
                      <History className="mr-1 h-3 w-3" /> {t('pages.botEditor.test.fromLast')}
                    </Button>
                  )}
                </div>

                {type === 'cron' && <p className="text-muted-foreground">{t('pages.botEditor.test.cronNoData')}</p>}

                {(type === 'event' || type === 'command') && (
                  <div className="space-y-1">
                    {rows.map((row, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <Input
                          className="h-7 w-2/5 font-mono-data text-[11px]"
                          aria-label={t('pages.botEditor.test.field')}
                          placeholder={t('pages.botEditor.test.field')}
                          list="flow-test-fields"
                          value={row.key}
                          onChange={(e) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))}
                        />
                        <Input
                          className="h-7 flex-1 text-[11px]"
                          aria-label={`${t('pages.botEditor.test.value')} ${row.key}`}
                          placeholder={t('pages.botEditor.test.value')}
                          value={row.value}
                          onChange={(e) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))}
                        />
                        <Button
                          type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0"
                          aria-label={t('pages.botEditor.test.removeField', { name: row.key })}
                          title={t('pages.botEditor.test.removeField', { name: row.key })}
                          onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                    <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => setRows((rs) => [...rs, { key: '', value: '' }])}>
                      <Plus className="mr-1 h-3 w-3" /> {t('pages.botEditor.test.addField')}
                    </Button>
                    {/* The rest of the event's measured fields, offered when typing a field name. */}
                    <datalist id="flow-test-fields">
                      {[...(fields?.main ?? []), ...(fields?.more ?? [])].map((f) => <option key={f} value={f} />)}
                    </datalist>
                    {type === 'event' && !fields && <p className="text-[11px] text-amber-400">{t('pages.botEditor.test.fieldsUnknown')}</p>}
                    {fields?.changes && <p className="text-[11px] text-muted-foreground">{t('pages.botEditor.test.fieldsChanges')}</p>}
                    {!!fields?.more.length && <p className="text-[11px] text-muted-foreground">{t('pages.botEditor.test.fieldsMore', { count: fields.more.length })}</p>}
                  </div>
                )}

                {type === 'webhook' && (
                  <div className="space-y-2">
                    <div>
                      <Label htmlFor="flow-test-method" className="text-[11px]">{t('pages.botEditor.test.method')}</Label>
                      <Select value={method} onValueChange={setMethod}>
                        <SelectTrigger id="flow-test-method" className="mt-1 h-7 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="flow-test-body" className="text-[11px]">{t('pages.botEditor.test.body')}</Label>
                      <Textarea id="flow-test-body" className="mt-1 min-h-20 font-mono-data text-[11px]" value={body} onChange={(e) => setBody(e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="flow-test-query" className="text-[11px]">{t('pages.botEditor.test.query')}</Label>
                      <Textarea id="flow-test-query" className="mt-1 min-h-12 font-mono-data text-[11px]" value={query} onChange={(e) => setQuery(e.target.value)} />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button type="submit" size="sm" className="h-8" disabled={run.isPending}>
                  <FlaskConical className="mr-1 h-4 w-4" /> {run.isPending ? t('pages.botEditor.test.running') : t('pages.botEditor.test.run')}
                </Button>
                {report && (
                  <Button type="button" variant="ghost" size="sm" className="h-8 text-[11px]" onClick={() => show(null)}>
                    {t('pages.botEditor.test.clear')}
                  </Button>
                )}
              </div>
              {Object.keys(forced).length > 0 && (
                <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-sky-300">
                  {t('pages.botEditor.test.forcedActive', { count: Object.keys(forced).length })}
                  <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => { setForced({}); run.mutate({}); }}>
                    {t('pages.botEditor.test.forcedReset')}
                  </Button>
                </p>
              )}
              {notice && <p role="status" className="text-[11px] text-muted-foreground">{notice}</p>}
            </form>
          )}

          {report && <TestReport report={report} writes={writes} empty={empty} onPick={onPick} forced={forced} onForce={force} busy={run.isPending} />}
        </div>
      </ScrollArea>
    </div>
  );
}

function TestReport({ report, writes, empty, onPick, forced, onForce, busy }: {
  report: FlowTestReport; writes: number; empty: number; onPick: (nodeId: string) => void;
  forced: Record<string, boolean>; onForce: (nodeId: string, value: boolean | undefined) => void; busy: boolean;
}) {
  const { t } = useTranslation();
  const mismatch = report.mismatch;
  return (
    <div className="space-y-3 border-t border-border pt-3" aria-live="polite">
      <div className={cn('flex items-start gap-1.5 rounded-md border px-2 py-1.5',
        report.status === 'completed' ? 'border-emerald-500/30 bg-emerald-500/10' : report.status === 'failed' ? 'border-destructive/40 bg-destructive/10' : 'border-border bg-muted/30')}>
        {report.status === 'completed' ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
          : report.status === 'failed' ? <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
            : <CircleSlash className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <div className="min-w-0 space-y-0.5">
          <p className="font-medium">{t(`pages.botEditor.test.status.${report.status}`, { error: report.error })}</p>
          {report.errorCode && <p className="text-[11px]">{t(`pages.botEditor.test.errorCode.${report.errorCode}`)}</p>}
          {mismatch && (
            <p className="text-[11px]">
              {typeof mismatch === 'string'
                ? t(`pages.botEditor.test.mismatch.${mismatch}`)
                : t('pages.botEditor.test.mismatch.filter', { key: mismatch.key, expected: mismatch.expected, actual: mismatch.actual ?? t('pages.botEditor.test.mismatch.missing') })}
            </p>
          )}
        </div>
      </div>

      {!!report.filters?.length && (
        <div className="space-y-0.5">
          <p className="font-display text-xs font-semibold tracking-wide">{t('pages.botEditor.test.filters')}</p>
          <ul className="space-y-0.5">
            {report.filters.map((f) => (
              <li key={f.key} className={cn('flex items-start gap-1.5 text-[11px]', f.ok ? 'text-emerald-400' : 'text-destructive')}>
                {f.ok ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> : <XCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />}
                <span className="break-all">
                  <span className="sr-only">{f.ok ? t('pages.botEditor.test.filterOk') : t('pages.botEditor.test.filterFail')}: </span>
                  <span className="font-mono-data">{f.key} = "{f.expected}"</span>
                  {!f.ok && ` · ${t('pages.botEditor.test.filterActual', { actual: f.actual ?? t('pages.botEditor.test.mismatch.missing') })}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.status !== 'notTriggered' && (
        <>
          <p className="text-[11px] text-muted-foreground">{t('pages.botEditor.test.summary', { steps: report.steps.length, writes, empty, reads: report.reads })}</p>

          <div className="space-y-1">
            <p className="font-display text-xs font-semibold tracking-wide">{t('pages.botEditor.test.steps')}</p>
            <ol className="space-y-1">
              {report.steps.map((s, i) => {
                const problem = stepProblem(s);
                return (
                  <li key={i} className={cn('rounded-md border', problem === 'error' ? 'border-destructive/50' : problem === 'warning' ? 'border-amber-500/50' : 'border-border')}>
                    <button
                      type="button"
                      onClick={() => onPick(s.nodeId)}
                      title={t('pages.botEditor.test.stepTitle', { label: s.label })}
                      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="font-mono-data text-[10px] text-muted-foreground">{i + 1}</span>
                      {problem === 'error' && <XCircle className="h-3 w-3 shrink-0 text-destructive" aria-hidden />}
                      {problem === 'warning' && <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" aria-hidden />}
                      <span className="min-w-0 flex-1 truncate font-medium">{s.label || s.nodeId}</span>
                      {s.iteration !== undefined && (
                        <span className={cn(badgeVariants({ variant: 'outline' }), 'px-1 py-0 text-[9px]')}>{t('pages.botEditor.test.iteration', { n: s.iteration + 1 })}</span>
                      )}
                      {s.branch && (
                        <span className={cn(badgeVariants({ variant: s.branch === 'true' ? 'success' : s.branch === 'false' ? 'secondary' : 'warning' }), 'px-1 py-0 text-[9px]')}>
                          {t(`pages.botEditor.test.branch.${s.branch}`)}
                        </span>
                      )}
                      {s.forced && <span className={cn(badgeVariants({ variant: 'outline' }), 'border-sky-500/50 px-1 py-0 text-[9px] text-sky-300')}>{t('pages.botEditor.test.forced')}</span>}
                    </button>
                    {(s.nodeType === 'condition' || s.error || s.placeholders.length > 0 || s.effects.length > 0 || s.logs.some((l) => s.nodeType === 'log' || l.level !== 'info')) && (
                      <div className="space-y-1 px-2 pb-1.5">
                        {s.conditionError && <p className="text-[11px] text-destructive">{t('pages.botEditor.test.conditionError', { error: s.conditionError })}</p>}
                        {s.nodeType === 'condition' && (
                          <div className="flex flex-wrap gap-1">
                            {/* A condition inside a loop runs several times; forcing it applies to every run. */}
                            {s.branch !== 'true' && (
                              <Button type="button" variant="outline" size="sm" className="h-6 px-1.5 text-[10px]" disabled={busy} onClick={() => onForce(s.nodeId, true)}>
                                {t('pages.botEditor.test.forceTrue')}
                              </Button>
                            )}
                            {s.branch !== 'false' && (
                              <Button type="button" variant="outline" size="sm" className="h-6 px-1.5 text-[10px]" disabled={busy} onClick={() => onForce(s.nodeId, false)}>
                                {t('pages.botEditor.test.forceFalse')}
                              </Button>
                            )}
                            {s.nodeId in forced && (
                              <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]" disabled={busy} onClick={() => onForce(s.nodeId, undefined)}>
                                {t('pages.botEditor.test.forceClear')}
                              </Button>
                            )}
                          </div>
                        )}
                        {s.error && <p className="break-words text-[11px] text-destructive">{t('pages.botEditor.test.actionError', { error: s.error })}</p>}
                        {s.placeholders.map((p, j) => (
                          <p key={j} className={cn('break-all font-mono-data text-[10px]', p.empty ? 'text-amber-400' : 'text-muted-foreground')}>
                            {p.empty ? t('pages.botEditor.test.emptyPlaceholder', { expression: `{{${p.expression}}}` }) : `{{${p.expression}}} = ${p.value}`}
                          </p>
                        ))}
                        {s.effects.length > 0 && (
                          <div className="space-y-1 text-[11px]">
                            {s.effects.map((e, j) => <EffectLine key={j} effect={e} t={t} />)}
                          </div>
                        )}
                        {s.logs.filter((l) => s.nodeType === 'log' || l.level !== 'info').map((l, j) => (
                          <p key={j} className={cn('break-words text-[11px]', l.level === 'error' ? 'text-destructive' : l.level === 'warn' ? 'text-amber-400' : '')}>{l.message}</p>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>

          {report.variables.length > 0 && (
            <div className="space-y-1">
              <p className="font-display text-xs font-semibold tracking-wide">{t('pages.botEditor.test.variables')}</p>
              <table className="w-full table-fixed text-[11px]">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="w-1/3 font-normal" scope="col">var</th>
                    <th className="font-normal" scope="col">{t('pages.botEditor.test.before')}</th>
                    <th className="font-normal" scope="col">{t('pages.botEditor.test.after')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.variables.map((v) => (
                    <tr key={v.name} className="align-top">
                      <td className="break-all font-mono-data">{v.name}</td>
                      <td className="break-all text-muted-foreground">{v.before}</td>
                      <td className="break-all">{v.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {report.temp.length > 0 && (
            <div className="space-y-1">
              <p className="font-display text-xs font-semibold tracking-wide">{t('pages.botEditor.test.temp')}</p>
              {report.temp.map((v) => (
                <p key={v.name} className="break-all font-mono-data text-[10px]">
                  <span className="text-muted-foreground">temp.{v.name}</span> = {v.value}
                  {v.simulated && <span className={cn(badgeVariants({ variant: 'warning' }), 'ml-1 px-1 py-0 text-[9px]')} title={t('pages.botEditor.test.simulatedHint')}>{t('pages.botEditor.test.simulated')}</span>}
                </p>
              ))}
            </div>
          )}
        </>
      )}

      {!!report.animations?.length && (
        <div className="space-y-2">
          <p className="font-display text-xs font-semibold tracking-wide">{t('pages.botEditor.test.animations')}</p>
          <p className="text-[11px] text-muted-foreground">{t('pages.botEditor.test.animationsHint')}</p>
          {report.animations.map((a) => (
            <div key={a.nodeId} className="space-y-1 rounded-md border border-border px-2 py-1.5">
              <button type="button" onClick={() => onPick(a.nodeId)} className="w-full truncate text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {a.label || a.nodeId}
              </button>
              <p className="text-[11px] text-muted-foreground">{t('pages.botEditor.test.animationMeta', { channel: a.channelId || '?', seconds: a.intervalSeconds, count: a.frames.length })}</p>
              <ol className="max-h-48 space-y-px overflow-y-auto rounded-sm bg-muted/30 px-1.5 py-1 font-mono-data text-[10px]">
                {a.frames.map((f, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="w-5 shrink-0 text-right text-muted-foreground">{i + 1}</span>
                    {f ? <span className="whitespace-pre">{f}</span> : <span className="italic text-muted-foreground">{t('pages.botEditor.test.frameSkipped')}</span>}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
