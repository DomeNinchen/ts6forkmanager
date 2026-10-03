import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Eraser, History, SquareTerminal } from 'lucide-react';
import {
  formatQueryLine,
  getDangerReason,
  isSecretKey,
  parseQueryLine,
  type ConsoleErrorBody,
  type ConsoleExecuteResponse,
  type DangerReason,
} from '@ts6/common';
import { consoleApi } from '@/api/console.api';
import { serversApi } from '@/api/servers.api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/shared/EmptyState';
import { AuditLogPanel } from '@/components/console/AuditLogPanel';
import { CommandHelp } from '@/components/console/CommandHelp';
import { ConsoleInput } from '@/components/console/ConsoleInput';
import { ConsoleSettingsCard } from '@/components/console/ConsoleSettingsCard';
import { DangerConfirmDialog } from '@/components/console/DangerConfirmDialog';
import { HelpEntry } from '@/components/console/HelpEntry';
import { ResultView } from '@/components/console/ResultView';
import { useServers, useVirtualServers } from '@/hooks/use-servers';
import { getCommand } from '@/lib/console/catalog';
import type { Completion } from '@/lib/console/completion';
import { useEntityList } from '@/lib/console/entities';
import { clearHistory, loadHistory, rememberCommand } from '@/lib/console/history';
import { buildMessageLine, maskedEcho, type ConsoleMode } from '@/lib/console/messages';
import { useAuthStore } from '@/stores/auth.store';
import { useServerStore } from '@/stores/server.store';
import { cn } from '@/lib/utils';

/** The transcript keeps this many entries; older ones scroll out of memory, not just out of sight. */
const MAX_ENTRIES = 200;

interface Entry {
  id: number;
  kind: 'command' | 'help' | 'notice';
  /** command: what was sent, secret values hidden. */
  line?: string;
  /** command: the virtual server it ran on (0 = the instance). */
  sid?: number;
  running?: boolean;
  result?: ConsoleExecuteResponse;
  error?: string;
  /** help: the command asked about, or null for the overview. */
  topic?: string | null;
  /** notice: plain text, with `tone` for an error. */
  text?: string;
  tone?: 'info' | 'error';
}

interface PendingDanger {
  line: string;
  command: string;
  reason: DangerReason | null;
}

export default function Console() {
  const { t } = useTranslation();
  const { selectedConfigId: configId, selectedSid } = useServerStore();
  const userId = useAuthStore((s) => s.user?.id ?? 0);
  const queryClient = useQueryClient();
  const { data: servers } = useServers();
  const { data: virtualServers } = useVirtualServers();

  // The virtual server commands run on. 0 is the instance itself, where `serverlist`, `instanceinfo` and the like live.
  // The server store keeps the sid the way the header's select hands it over - as text - so it is made a number here.
  const [sid, setSid] = useState<number>(Number(selectedSid ?? 0) || 0);
  const [mode, setMode] = useState<ConsoleMode>('command');
  const [privateTarget, setPrivateTarget] = useState<string>('');
  const [line, setLine] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingDanger | null>(null);
  const [history, setHistory] = useState<string[]>(() => loadHistory(userId));
  const [completion, setCompletion] = useState<Completion | null>(null);

  const nextId = useRef(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const serverName = servers?.find((server: { id: number; name: string }) => server.id === configId)?.name ?? '';

  // A different server connection is a different place: start over.
  useEffect(() => {
    setSid(Number(useServerStore.getState().selectedSid ?? 0) || 0);
    setEntries([]);
    setPending(null);
    setMode('command');
  }, [configId]);

  useEffect(() => {
    setHistory(loadHistory(userId));
  }, [userId]);

  useEffect(() => {
    const element = transcriptRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [entries]);

  // Chat messages need a virtual server to speak on.
  useEffect(() => {
    if (sid === 0 && mode !== 'command') setMode('command');
  }, [sid, mode]);

  const clients = useEntityList('client', configId, sid, mode === 'private');
  const voiceClients = (clients.data ?? []).filter((client) => client.detail !== 'query');
  const identity = useQuery({
    queryKey: ['console-identity', configId, sid],
    queryFn: () => serversApi.getIdentity(configId!, sid),
    enabled: !!configId && mode === 'channel' && sid > 0,
  });

  const virtualServerName = (id: number): string =>
    id === 0
      ? t('pages.console.instance')
      : (virtualServers?.find((vs: { virtualserver_id: string }) => Number(vs.virtualserver_id) === id)?.virtualserver_name ?? `#${id}`);

  const push = useCallback((entry: Omit<Entry, 'id'>): number => {
    const id = nextId.current++;
    setEntries((current) => [...current, { ...entry, id }].slice(-MAX_ENTRIES));
    return id;
  }, []);

  const patch = useCallback((id: number, changes: Partial<Entry>) => {
    setEntries((current) => current.map((entry) => (entry.id === id ? { ...entry, ...changes } : entry)));
  }, []);

  const notice = useCallback((text: string, tone: 'info' | 'error' = 'info') => push({ kind: 'notice', text, tone }), [push]);

  const describeError = (error: unknown): string => {
    const data = (error as { response?: { data?: Partial<ConsoleErrorBody> & { error?: string } } })?.response?.data;
    switch (data?.code) {
      case 'RATE_LIMITED':
        return t('pages.console.errors.rateLimited', { seconds: Math.max(1, Math.ceil((data.retryAfterMs ?? 1000) / 1000)) });
      case 'NO_CONNECTION':
        return t('pages.console.errors.noConnection');
      case 'PARSE_ERROR':
        return t(`pages.console.parse.${data.parseError?.code ?? 'invalid_command'}`, { detail: data.parseError?.detail ?? '' });
      default:
        return data?.error || (error as Error)?.message || t('pages.console.errors.generic');
    }
  };

  /** Sends a command line; `confirm` is the typed-out command name for a dangerous one. */
  const send = async (commandLine: string, confirm?: string): Promise<ConsoleExecuteResponse | null> => {
    if (!configId) return null;
    const id = push({ kind: 'command', line: maskedEcho(commandLine), sid, running: true });
    setBusy(true);
    try {
      const result = await consoleApi.execute(configId, { sid, line: commandLine, confirm });
      patch(id, { running: false, result });
      setHistory((current) => rememberCommand(userId, current, commandLine));
      return result;
    } catch (error) {
      const data = (error as { response?: { data?: Partial<ConsoleErrorBody> } })?.response?.data;
      if (data?.code === 'CONFIRMATION_REQUIRED') {
        // The backend asks even though the form did not: take the entry back and ask properly.
        setEntries((current) => current.filter((entry) => entry.id !== id));
        setPending({ line: commandLine, command: data.command ?? '', reason: data.reason ?? null });
      } else {
        patch(id, { running: false, error: describeError(error) });
      }
      return null;
    } finally {
      setBusy(false);
      // The audit tab lists this command now; do not let it show a cached page without it.
      void queryClient.invalidateQueries({ queryKey: ['console-log'] });
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const switchTo = (target: number) => {
    setSid(target);
    notice(t('pages.console.notice.using', { name: virtualServerName(target) }));
  };

  /** `use` is not something WebQuery has: it is the console's own, and only changes where the next commands run. */
  const handleUse = async (text: string, parsed: ReturnType<typeof parseQueryLine>): Promise<boolean> => {
    // `use 2` is ServerQuery's short form; the bare number is not a valid parameter, so it never parses.
    const bare = /^use\s+(\d+)\s*$/i.exec(text);
    if (!bare && !(parsed.ok && parsed.value.command === 'use')) return false;
    const block = parsed.ok ? parsed.value.blocks[0] : {};

    let target: number | null = null;
    if (bare) target = Number(bare[1]);
    else if (block.sid !== undefined) target = /^\d+$/.test(block.sid) ? Number(block.sid) : NaN;
    else if (block.port !== undefined && configId) {
      const answer = await consoleApi
        .execute(configId, { sid: 0, line: `serveridgetbyport virtualserver_port=${block.port.replace(/\D/g, '')}` })
        .catch(() => null);
      const found = answer?.records[0];
      target = Number(found?.server_id ?? found?.sid ?? found?.virtualserver_id ?? NaN);
    }

    if (target === null || !Number.isInteger(target)) {
      notice(t('pages.console.notice.useUsage'), 'error');
    } else if (target !== 0 && virtualServers && !virtualServers.some((vs: { virtualserver_id: string }) => Number(vs.virtualserver_id) === target)) {
      notice(t('pages.console.notice.unknownVirtualServer', { sid: target }), 'error');
    } else {
      switchTo(target);
    }
    return true;
  };

  const submit = async () => {
    const text = line.trim();
    if (!text || busy || !configId) return;

    if (mode !== 'command') {
      let target: string | null = null;
      if (mode === 'private') target = privateTarget || null;
      if (mode === 'channel') target = identity.data?.client_channel_id ?? null;
      if ((mode === 'private' || mode === 'channel') && !target) {
        notice(t(mode === 'private' ? 'pages.console.notice.pickClient' : 'pages.console.notice.noChannel'), 'error');
        return;
      }
      const result = await send(buildMessageLine(mode, text, target));
      if (result?.ok) setLine('');
      return;
    }

    const parsed = parseQueryLine(text);
    if (await handleUse(text, parsed)) {
      setLine('');
      return;
    }
    if (!parsed.ok) {
      push({ kind: 'command', line: text, sid, error: t(`pages.console.parse.${parsed.error.code}`, { detail: parsed.error.detail }) });
      return;
    }

    const command = parsed.value.command;
    if (command === 'help') {
      const topic = Object.keys(parsed.value.blocks[0])[0] ?? null;
      push({ kind: 'help', line: text, sid, topic });
      setLine('');
      return;
    }

    const reason = getDangerReason(command);
    if (reason) {
      setPending({ line: text, command, reason });
      return;
    }

    setLine('');
    await send(text);
  };

  const confirmPending = async () => {
    if (!pending) return;
    const { line: commandLine, command } = pending;
    setPending(null);
    setLine('');
    await send(commandLine, command);
  };

  if (!configId) {
    return <EmptyState icon={SquareTerminal} title={t('pages.noServerSelected')} description={t('pages.serverStats.selectServerFirst')} />;
  }

  const firstWord = line.trimStart().split(/[\s|]/)[0] ?? '';
  const helpCommand = mode === 'command' ? getCommand(firstWord) : undefined;
  const pendingParsed = pending ? parseQueryLine(pending.line) : null;
  const pendingDisplay =
    pending && pendingParsed?.ok ? formatQueryLine(pendingParsed.value, { maskKey: isSecretKey, maxValueLength: 300 }) : (pending?.line ?? '');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{t('nav.items.queryConsole')}</h1>
        {serverName && <Badge variant="secondary">{serverName}</Badge>}
      </div>

      <Tabs defaultValue="console">
        <TabsList>
          <TabsTrigger value="console">{t('pages.console.tabs.console')}</TabsTrigger>
          <TabsTrigger value="log">{t('pages.console.tabs.log')}</TabsTrigger>
          <TabsTrigger value="settings">{t('pages.console.tabs.settings')}</TabsTrigger>
        </TabsList>

        <TabsContent value="console" className="mt-4 space-y-3">
          <Card className="card-hero">
            <CardContent className="space-y-3 pt-5">
              <div className="flex flex-wrap items-center gap-2">
                <Select value={String(sid)} onValueChange={(value) => switchTo(Number(value))}>
                  <SelectTrigger className="h-8 w-60 text-xs" aria-label={t('pages.console.virtualServer')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">{t('pages.console.instance')}</SelectItem>
                    {(virtualServers ?? []).map((vs: { virtualserver_id: string; virtualserver_name: string }) => (
                      <SelectItem key={vs.virtualserver_id} value={vs.virtualserver_id}>
                        #{vs.virtualserver_id} {vs.virtualserver_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={mode} onValueChange={(value) => setMode(value as ConsoleMode)}>
                  <SelectTrigger className="h-8 w-48 text-xs" aria-label={t('pages.console.mode.label')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="command">{t('pages.console.mode.command')}</SelectItem>
                    <SelectItem value="server" disabled={sid === 0}>{t('pages.console.mode.server')}</SelectItem>
                    <SelectItem value="channel" disabled={sid === 0}>{t('pages.console.mode.channel')}</SelectItem>
                    <SelectItem value="private" disabled={sid === 0}>{t('pages.console.mode.private')}</SelectItem>
                  </SelectContent>
                </Select>

                {mode === 'private' && (
                  <Select value={privateTarget} onValueChange={setPrivateTarget}>
                    <SelectTrigger className="h-8 w-56 text-xs" aria-label={t('pages.console.mode.client')}>
                      <SelectValue placeholder={t('pages.console.mode.pickClient')} />
                    </SelectTrigger>
                    <SelectContent>
                      {/* A query client can not receive a private message (TeamSpeak answers "invalid client type"). */}
                      {voiceClients.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                          #{client.id} {client.name}
                        </SelectItem>
                      ))}
                      {voiceClients.length === 0 && (
                        <div className="px-3 py-2 text-xs text-muted-foreground">{t('pages.console.mode.noClients')}</div>
                      )}
                    </SelectContent>
                  </Select>
                )}
                {mode === 'channel' && identity.data && (
                  <span className="text-xs text-muted-foreground">
                    {t('pages.console.mode.channelHint', { cid: identity.data.client_channel_id })}
                  </span>
                )}

                <div className="ml-auto flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEntries([])} disabled={entries.length === 0}>
                    <Eraser className="h-3.5 w-3.5" /> {t('pages.console.clearScreen')}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <History className="h-3.5 w-3.5" /> {t('pages.console.history.menu', { count: history.length })}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        disabled={history.length === 0}
                        onClick={() => {
                          clearHistory(userId);
                          setHistory([]);
                          toast.success(t('pages.console.history.cleared'));
                        }}
                      >
                        {t('pages.console.history.clear')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <div
                ref={transcriptRef}
                className="h-[min(55vh,34rem)] overflow-y-auto rounded-md border border-border bg-background/60 p-3 font-mono text-sm"
                aria-live="polite"
              >
                {entries.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('pages.console.empty')}</p>
                ) : (
                  <div className="space-y-4">
                    {entries.map((entry) => (
                      <div key={entry.id}>
                        {entry.kind === 'notice' && (
                          <p className={cn('text-xs', entry.tone === 'error' ? 'text-destructive' : 'text-muted-foreground')}>{entry.text}</p>
                        )}
                        {entry.kind !== 'notice' && (
                          <div className="mb-1.5 break-all">
                            <span className="text-muted-foreground">{virtualServerName(entry.sid ?? sid)}</span>{' '}
                            <span className="text-primary">{'›'}</span> <span>{entry.line}</span>
                          </div>
                        )}
                        {entry.kind === 'command' && entry.running && <p className="text-xs text-muted-foreground">{t('common.loading')}</p>}
                        {entry.kind === 'command' && entry.error && <p className="text-xs text-destructive">{entry.error}</p>}
                        {entry.kind === 'command' && entry.result && <ResultView result={entry.result} configId={configId} />}
                        {entry.kind === 'help' && (
                          <HelpEntry
                            topic={entry.topic ?? null}
                            onPick={(name) => {
                              setLine(`${name} `);
                              inputRef.current?.focus();
                            }}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <ConsoleInput
                value={line}
                onChange={setLine}
                onSubmit={submit}
                onAnalysis={setCompletion}
                history={mode === 'command' ? history : []}
                configId={configId}
                sid={sid}
                disabled={busy}
                completionEnabled={mode === 'command'}
                inputRef={inputRef}
                placeholder={mode === 'command' ? t('pages.console.input.placeholder') : t('pages.console.input.messagePlaceholder')}
              />
              <p className="text-[11px] text-muted-foreground">{t('pages.console.input.shortcuts')}</p>
            </CardContent>
          </Card>

          {helpCommand && (
            <Card className="card-hero">
              <CardContent className="pt-5">
                <CommandHelp command={helpCommand} activeParam={completion?.param?.key} detailed />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="log" className="mt-4">
          <AuditLogPanel configId={configId} />
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <ConsoleSettingsCard />
        </TabsContent>
      </Tabs>

      <DangerConfirmDialog
        open={pending !== null}
        command={pending?.command ?? ''}
        reason={pending?.reason ?? null}
        displayLine={pendingDisplay}
        target={`${serverName} · ${virtualServerName(sid)}`}
        loading={busy}
        onConfirm={confirmPending}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
