import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { findBanMatches, type BanIndex, type ClientDbProfile } from '@ts6/common';
import { Ban as BanIcon, Copy, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { useClientDbDetails } from '@/hooks/use-client-database';
import { tsErrorMessage } from '@/lib/ts-errors';
import { formatBytes } from '@/lib/utils';
import { formatDateTime } from './format';

interface ClientDbDetailDialogProps {
  /** The profile to show; the dialog is open while this is set. */
  cldbid: number | null;
  banIndex: BanIndex;
  channels: any[];
  channelGroups: any[];
  onClose: () => void;
  onBan: (profile: ClientDbProfile) => void;
  onDelete: (profile: ClientDbProfile) => void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm break-words">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

export function ClientDbDetailDialog({ cldbid, banIndex, channels, channelGroups, onClose, onBan, onDelete }: ClientDbDetailDialogProps) {
  const { t } = useTranslation();
  const { data, isLoading, isError, error } = useClientDbDetails(cldbid);

  const banMatches = useMemo(() => (data ? findBanMatches(banIndex, data.profile) : []), [data, banIndex]);
  const channelName = (cid: number) => channels.find((ch: any) => Number(ch.cid) === cid)?.channel_name ?? `#${cid}`;
  const groupName = (cgid: number) => channelGroups.find((g: any) => Number(g.cgid) === cgid)?.name ?? `#${cgid}`;
  const unavailable = <span className="text-sm text-muted-foreground">{t('pages.clientDatabase.detail.unavailable')}</span>;
  const none = <span className="text-sm text-muted-foreground">{t('common.none')}</span>;

  const copyUid = (uid: string) => {
    navigator.clipboard?.writeText(uid).then(
      () => toast.success(t('pages.clientDatabase.detail.uidCopied')),
      () => toast.error(t('pages.clientDatabase.detail.copyFailed')),
    );
  };

  const profile = data?.profile;

  return (
    <Dialog open={cldbid !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
            <span className="break-all">{profile?.nickname || t('pages.clientDatabase.detail.title')}</span>
            {data?.online && <Badge variant="success">{t('common.online')}</Badge>}
            {banMatches.length > 0 && <Badge variant="destructive">{t('pages.clientDatabase.detail.banned')}</Badge>}
          </DialogTitle>
          <DialogDescription>{t('pages.clientDatabase.detail.subtitle', { id: cldbid })}</DialogDescription>
        </DialogHeader>

        {isLoading && <LoadingSpinner className="py-8" />}
        {isError && (
          <p className="text-sm text-destructive">{tsErrorMessage(error, t('pages.clientDatabase.detail.loadFailed'), t)}</p>
        )}

        {data && profile && (
          <div className="space-y-5">
            <Section title={t('pages.clientDatabase.detail.identity')}>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                <Field label={t('pages.clientDatabase.columns.dbId')}><span className="font-mono-data">{profile.cldbid}</span></Field>
                <Field label={t('pages.clientDatabase.columns.uid')}>
                  <span className="inline-flex items-start gap-1">
                    <span className="font-mono-data text-xs break-all">{profile.uid || '-'}</span>
                    {profile.uid && (
                      <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => copyUid(profile.uid)} aria-label={t('common.copy')}>
                        <Copy className="h-3 w-3" />
                      </Button>
                    )}
                  </span>
                </Field>
                <Field label={t('pages.clientDatabase.detail.firstSeen')}>{formatDateTime(profile.created)}</Field>
                <Field label={t('pages.clientDatabase.columns.lastSeen')}>{formatDateTime(profile.lastConnected)}</Field>
                <Field label={t('pages.clientDatabase.columns.connections')}><span className="font-mono-data">{profile.totalConnections}</span></Field>
                <Field label={t('pages.clientDatabase.columns.lastIp')}><span className="font-mono-data">{profile.lastIp || '-'}</span></Field>
                <Field label={t('pages.clientDatabase.columns.description')}>{profile.description || '-'}</Field>
                <Field label={t('pages.clientDatabase.detail.avatar')}>{data.avatarHash ? t('common.yes') : t('common.no')}</Field>
              </dl>
              {data.online && (
                <p className="text-sm text-muted-foreground">
                  {t('pages.clientDatabase.detail.onlineIn', { clid: data.online.clid, channel: channelName(data.online.cid) })}
                </p>
              )}
            </Section>

            <Section title={t('pages.clientDatabase.detail.traffic')}>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
                <Field label={t('pages.clientDatabase.detail.monthUp')}><span className="font-mono-data">{formatBytes(data.traffic.monthUp)}</span></Field>
                <Field label={t('pages.clientDatabase.detail.monthDown')}><span className="font-mono-data">{formatBytes(data.traffic.monthDown)}</span></Field>
                <Field label={t('pages.clientDatabase.detail.totalUp')}><span className="font-mono-data">{formatBytes(data.traffic.totalUp)}</span></Field>
                <Field label={t('pages.clientDatabase.detail.totalDown')}><span className="font-mono-data">{formatBytes(data.traffic.totalDown)}</span></Field>
              </dl>
            </Section>

            <Section title={t('pages.clientDatabase.detail.serverGroups')}>
              {data.unavailable.includes('serverGroups') ? unavailable : data.serverGroups.length === 0 ? none : (
                <div className="flex flex-wrap gap-1.5">
                  {data.serverGroups.map((g) => <Badge key={g.sgid} variant="secondary">{g.name}</Badge>)}
                </div>
              )}
            </Section>

            <Section title={t('pages.clientDatabase.detail.channelGroups')}>
              {data.unavailable.includes('channelGroups') ? unavailable : data.channelGroups.length === 0 ? none : (
                <ul className="space-y-1 text-sm">
                  {data.channelGroups.map((g) => (
                    <li key={`${g.cid}-${g.cgid}`} className="flex items-center gap-2">
                      <span>{channelName(g.cid)}</span>
                      <span className="text-muted-foreground">&rarr;</span>
                      <Badge variant="secondary">{groupName(g.cgid)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={t('pages.clientDatabase.detail.customInfo')}>
              {data.unavailable.includes('custom') ? unavailable : data.custom.length === 0 ? none : (
                <ul className="space-y-1 text-sm font-mono-data">
                  {data.custom.map((entry, i) => (
                    <li key={`${entry.ident}-${i}`} className="break-all"><span className="text-muted-foreground">{entry.ident}</span> = {entry.value}</li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title={t('pages.clientDatabase.detail.bans')}>
              {banMatches.length === 0 ? (
                <span className="text-sm text-muted-foreground">{t('pages.clientDatabase.detail.noBans')}</span>
              ) : (
                <ul className="space-y-2">
                  {banMatches.map((rule) => (
                    <li key={rule.banid} className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs space-y-0.5">
                      <div className="font-medium">
                        {t('pages.clientDatabase.detail.banRule', { id: rule.banid })}
                        {' - '}
                        {rule.duration === 0
                          ? t('common.duration.permanent')
                          : t('pages.clientDatabase.detail.banUntil', { date: formatDateTime(rule.created + rule.duration) })}
                      </div>
                      {rule.uid && <div className="font-mono-data break-all">UID: {rule.uid}</div>}
                      {rule.ip && <div className="font-mono-data break-all">IP: {rule.ip}</div>}
                      {rule.name && <div className="font-mono-data break-all">{t('pages.clientDatabase.detail.banName')}: {rule.name}</div>}
                      {rule.reason && <div className="text-muted-foreground">{t('pages.bans.reason')}: {rule.reason}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {profile && (
            <>
              <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => onBan(profile)}>
                <BanIcon className="h-4 w-4 mr-1" /> {t('pages.clientDatabase.actions.ban')}
              </Button>
              <Button variant="outline" className="text-destructive hover:text-destructive" disabled={!!data?.online} onClick={() => onDelete(profile)}>
                <Trash2 className="h-4 w-4 mr-1" /> {t('pages.clientDatabase.actions.delete')}
              </Button>
            </>
          )}
          <Button variant="outline" onClick={onClose}>{t('common.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
