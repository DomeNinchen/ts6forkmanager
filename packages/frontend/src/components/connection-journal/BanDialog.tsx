import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Ban as BanIcon } from 'lucide-react';
import { BAN_DURATION_DEFAULT, BAN_REASON_MAX_LENGTH, type JournalBanState } from '@ts6/common';
import { connectionJournalApi } from '@/api/connection-journal.api';
import { serversApi } from '@/api/servers.api';
import { serverCapabilities, useServers } from '@/hooks/use-servers';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** What a ban is set for: an address, and - when it came from a TeamSpeak row - where that client was and who it was. */
export interface BanTarget {
  ip: string;
  ts?: { configId: number; virtualServerId: number | null; nickname: string | null };
  webBan: JournalBanState['web'];
}

const DURATIONS: Array<{ seconds: number; key: string }> = [
  { seconds: 3600, key: 'pages.bans.oneHour' },
  { seconds: 86400, key: 'pages.bans.oneDay' },
  { seconds: 604800, key: 'pages.bans.oneWeek' },
  { seconds: 2592000, key: 'pages.bans.thirtyDays' },
  { seconds: 0, key: 'common.duration.permanent' },
];

/** The answer's own words when the backend gave a code, the plain message otherwise. */
function banErrorMessage(err: any, fallback: string, t: (key: string) => string): string {
  const code = err?.response?.data?.code as string | undefined;
  if (code && code.startsWith('ban')) return t(`pages.connectionJournal.ban.errors.${code}`);
  return err?.response?.data?.details || err?.response?.data?.error || fallback;
}

/**
 * Ban an address from the journal: on the web interface (every request from it is answered 403), on a TeamSpeak
 * server (a ban rule for exactly that address, kept in TeamSpeak's own ban list), or both. Mounted only while
 * it is open, so every opening starts from the defaults.
 */
export function BanDialog({ target, onClose }: { target: BanTarget; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: servers } = useServers();
  const connections: Array<{ id: number; name: string }> = (Array.isArray(servers) ? servers : []).filter((s: any) => serverCapabilities(s).hasWebQuery);

  const fromTs = !!target.ts && target.ts.virtualServerId !== null && connections.some((c) => c.id === target.ts!.configId);
  const [web, setWeb] = useState(true);
  const [tsOn, setTsOn] = useState(fromTs);
  const [configId, setConfigId] = useState<number | null>(target.ts?.configId ?? null);
  const [scope, setScope] = useState<string>(target.ts?.virtualServerId != null ? String(target.ts.virtualServerId) : 'all');
  const [duration, setDuration] = useState(String(BAN_DURATION_DEFAULT));
  const [reason, setReason] = useState('');
  const [confirmAdmin, setConfirmAdmin] = useState(false);

  const effectiveConfigId = configId ?? connections[0]?.id ?? null;
  const { data: check, isLoading: checking } = useQuery({
    queryKey: ['connection-journal', 'ban-check', target.ip],
    queryFn: () => connectionJournalApi.banCheck(target.ip),
    staleTime: 0,
  });
  const { data: virtualServers } = useQuery({
    queryKey: ['virtual-servers', effectiveConfigId],
    queryFn: () => serversApi.listVirtual(effectiveConfigId!),
    enabled: tsOn && effectiveConfigId !== null,
  });
  const virtualList: Array<{ id: number; name: string }> = (Array.isArray(virtualServers) ? virtualServers : [])
    .map((v: any) => ({ id: Number(v.virtualserver_id), name: String(v.virtualserver_name ?? '') }))
    .filter((v: { id: number }) => Number.isInteger(v.id) && v.id > 0);

  const refused = check?.protection ?? null;
  const needsConfirm = !!check && check.adminAccounts.length > 0;
  const webPossible = !!check && !check.disabled;
  const doWeb = web && webPossible;
  const doTs = tsOn && effectiveConfigId !== null;

  const submit = useMutation({
    mutationFn: async () => {
      const seconds = Number(duration);
      const trimmed = reason.trim() || undefined;
      const outcome: { web: boolean; ts: { created: number; total: number; message?: string } | null } = { web: false, ts: null };
      if (doWeb) {
        await connectionJournalApi.createWebBan({ ip: target.ip, duration: seconds, reason: trimmed, confirmAdmin });
        outcome.web = true;
      }
      if (doTs) {
        const result = await connectionJournalApi.createTsBan({
          ip: target.ip,
          configId: effectiveConfigId!,
          virtualServerId: scope === 'all' ? 'all' : Number(scope),
          duration: seconds,
          reason: trimmed,
          nickname: target.ts?.nickname ?? undefined,
          confirmAdmin,
        });
        const created = result.outcomes.filter((o) => o.status === 'created').length;
        outcome.ts = { created, total: result.outcomes.length, message: result.outcomes.find((o) => o.status === 'failed')?.message };
      }
      return outcome;
    },
    onSuccess: (outcome) => {
      if (outcome.web) toast.success(t('pages.connectionJournal.ban.webDone', { ip: target.ip }));
      if (outcome.ts) {
        if (outcome.ts.created === outcome.ts.total) toast.success(t('pages.connectionJournal.ban.tsDone', { count: outcome.ts.created }));
        else if (outcome.ts.created === 0) toast.error(t('pages.connectionJournal.ban.tsFailed', { message: outcome.ts.message ?? '' }));
        else toast.warning(t('pages.connectionJournal.ban.tsPartial', { created: outcome.ts.created, total: outcome.ts.total, message: outcome.ts.message ?? '' }));
      }
      void qc.invalidateQueries({ queryKey: ['connection-journal'] });
      onClose();
    },
    onError: (err) => {
      toast.error(banErrorMessage(err, t('pages.connectionJournal.ban.failed'), t as (key: string) => string));
      // A web ban that went through while the TeamSpeak half failed shows in the lists at once.
      void qc.invalidateQueries({ queryKey: ['connection-journal'] });
    },
  });

  const canSubmit = !!check && !refused && (doWeb || doTs) && (!needsConfirm || confirmAdmin) && !submit.isPending;

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !submit.isPending) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('pages.connectionJournal.ban.title', { ip: target.ip })}</DialogTitle>
          <DialogDescription>{t('pages.connectionJournal.ban.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4" data-testid="ban-dialog">
          {checking && <p className="text-xs text-muted-foreground">{t('common.loading')}</p>}

          {refused && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="ban-refused">
              {t(`pages.connectionJournal.ban.protected.${refused}`)}
            </p>
          )}
          {check?.disabled && (
            <p className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-400" data-testid="ban-disabled">
              {t('pages.connectionJournal.ban.disabled')}
            </p>
          )}
          {check?.webBan && (
            <p className="text-xs text-muted-foreground" data-testid="ban-already">
              {check.webBan.expiresAt
                ? t('pages.connectionJournal.ban.alreadyUntil', { date: new Date(check.webBan.expiresAt).toLocaleString() })
                : t('pages.connectionJournal.ban.alreadyForever')}
            </p>
          )}

          <div className="space-y-2">
            <label className={`flex items-start gap-2.5 rounded-md border border-border px-3 py-2 ${webPossible && !refused ? 'cursor-pointer' : 'opacity-60'}`}>
              <Checkbox className="mt-0.5" checked={doWeb} disabled={!webPossible || !!refused} onCheckedChange={(v) => setWeb(!!v)} data-testid="ban-web" />
              <span className="space-y-0.5">
                <span className="block text-sm font-medium">{t('pages.connectionJournal.ban.web.label')}</span>
                <span className="block text-xs text-muted-foreground">{t('pages.connectionJournal.ban.web.hint')}</span>
              </span>
            </label>

            <div className={`rounded-md border border-border px-3 py-2 space-y-3 ${connections.length === 0 || refused ? 'opacity-60' : ''}`}>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <Checkbox className="mt-0.5" checked={doTs} disabled={connections.length === 0 || !!refused} onCheckedChange={(v) => setTsOn(!!v)} data-testid="ban-ts" />
                <span className="space-y-0.5">
                  <span className="block text-sm font-medium">{t('pages.connectionJournal.ban.ts.label')}</span>
                  <span className="block text-xs text-muted-foreground">{t('pages.connectionJournal.ban.ts.hint')}</span>
                </span>
              </label>
              {doTs && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">{t('pages.connectionJournal.ban.ts.connection')}</Label>
                    <Select value={String(effectiveConfigId)} onValueChange={(v) => { setConfigId(Number(v)); setScope('all'); }}>
                      <SelectTrigger className="mt-1" data-testid="ban-connection"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {connections.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">{t('pages.connectionJournal.ban.ts.virtualServer')}</Label>
                    <Select value={scope} onValueChange={setScope}>
                      <SelectTrigger className="mt-1" data-testid="ban-scope"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('pages.connectionJournal.ban.ts.allServers')}</SelectItem>
                        {virtualList.map((v) => <SelectItem key={v.id} value={String(v.id)}>{`${v.id} · ${v.name}`}</SelectItem>)}
                        {scope !== 'all' && !virtualList.some((v) => String(v.id) === scope) && <SelectItem value={scope}>{scope}</SelectItem>}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t('pages.bans.duration')}</Label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger className="mt-1" data-testid="ban-duration"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DURATIONS.map((d) => <SelectItem key={d.seconds} value={String(d.seconds)}>{t(d.key)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t('pages.bans.reason')} ({t('common.optional')})</Label>
              <Input className="mt-1" value={reason} maxLength={BAN_REASON_MAX_LENGTH} onChange={(e) => setReason(e.target.value)} placeholder={t('pages.bans.reasonPlaceholder')} data-testid="ban-reason" />
            </div>
          </div>

          {needsConfirm && !refused && (
            <label className="flex items-start gap-2.5 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 cursor-pointer" data-testid="ban-confirm-admin">
              <Checkbox className="mt-0.5" checked={confirmAdmin} onCheckedChange={(v) => setConfirmAdmin(!!v)} data-testid="ban-confirm-admin-box" />
              <span className="text-xs text-amber-400">
                {t('pages.connectionJournal.ban.adminWarning', { names: check!.adminAccounts.join(', ') })}
              </span>
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submit.isPending}>{t('common.cancel')}</Button>
          <Button variant="destructive" onClick={() => submit.mutate()} disabled={!canSubmit} data-testid="ban-submit">
            <BanIcon className="h-4 w-4 mr-1" /> {submit.isPending ? t('components.confirmDialog.processing') : t('pages.connectionJournal.ban.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
