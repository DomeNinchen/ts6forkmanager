import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { banRuleValue, clientDbBanToBulk, type BulkOutcome, type ClientDbBanTarget, type ClientDbProfile } from '@ts6/common';
import { BulkPreview, reportBulk, useBulkPreview } from '@/components/shared/BulkResultDialog';
import { clientDatabaseApi } from '@/api/client-database.api';
import { useServerStore } from '@/stores/server.store';
import { Ban as BanIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBanProfiles } from '@/hooks/use-client-database';
import { tsErrorMessage } from '@/lib/ts-errors';
import { summarizeNames } from './format';

const TARGETS: ClientDbBanTarget[] = ['uid', 'name', 'ip'];

interface ClientDbBanDialogProps {
  /** Mounted only while the dialog is open, so every opening starts from the defaults. */
  profiles: ClientDbProfile[];
  onClose: () => void;
  /** The ban went through (fully or in part); the page clears its row selection. */
  onDone: () => void;
}

export function ClientDbBanDialog({ profiles, onClose, onDone }: ClientDbBanDialogProps) {
  const { t } = useTranslation();
  const ban = useBanProfiles();
  const { selectedConfigId, selectedSid } = useServerStore();
  const [picked, setPicked] = useState<Record<ClientDbBanTarget, boolean>>({ uid: true, name: false, ip: false });
  const [duration, setDuration] = useState('3600');
  const [reason, setReason] = useState('');

  // A target is offered when at least one selected profile has something to ban for it (no IP on record = no IP rule).
  const offered = (target: ClientDbBanTarget) => profiles.some((p) => banRuleValue(target, p) !== '');
  const withoutValue = (target: ClientDbBanTarget) => profiles.filter((p) => banRuleValue(target, p) === '').length;
  const chosen = TARGETS.filter((target) => picked[target] && offered(target));

  // Several profiles: the first press shows what would happen (R9), the second bans.
  const preview = useBulkPreview();
  const needsPreview = profiles.length > 1 && !preview.outcomes;
  const nameOf = (o: BulkOutcome) => o.name.replace(/^#\d+ /, `${profiles.find((p) => p.cldbid === o.id)?.nickname || `#${o.id}`} `);

  const submit = () => {
    const request = { cldbids: profiles.map((p) => p.cldbid), targets: chosen, time: Number(duration), reason: reason.trim() || undefined };
    if (needsPreview) {
      preview.ask(() => clientDatabaseApi.banPreview(selectedConfigId!, selectedSid!, request),
        (err) => toast.error(tsErrorMessage(err, t('pages.clientDatabase.ban.failed'), t)), nameOf);
      return;
    }
    ban.mutate(
      request,
      {
        onSuccess: (result) => {
          const created = result.outcomes.filter((o) => o.status === 'created').length;
          // One line per profile and ban target (a profile banned by IP and by identity has two).
          reportBulk(t('pages.clientDatabase.ban.title', { count: profiles.length }), t('pages.clientDatabase.ban.done', { count: created }),
            clientDbBanToBulk(result.outcomes));
          onDone();
          onClose();
        },
        onError: (err) => toast.error(tsErrorMessage(err, t('pages.clientDatabase.ban.failed'), t)),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !ban.isPending) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('pages.clientDatabase.ban.title', { count: profiles.length })}</DialogTitle>
          <DialogDescription className="break-words">{summarizeNames(profiles, 5, t)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs">{t('pages.clientDatabase.ban.banBy')}</Label>
            {TARGETS.map((target) => {
              const isOffered = offered(target);
              const missing = withoutValue(target);
              return (
                <label key={target} className={`flex items-start gap-2.5 rounded-md border border-border px-3 py-2 ${isOffered ? 'cursor-pointer' : 'opacity-60'}`}>
                  <Checkbox
                    className="mt-0.5"
                    checked={picked[target] && isOffered}
                    disabled={!isOffered}
                    onCheckedChange={(v) => { setPicked((prev) => ({ ...prev, [target]: !!v })); preview.reset(); }}
                  />
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium">{t(`pages.clientDatabase.ban.targets.${target}.label`)}</span>
                    <span className="block text-xs text-muted-foreground">{t(`pages.clientDatabase.ban.targets.${target}.hint`)}</span>
                    {!isOffered ? (
                      <span className="block text-xs text-amber-400">{t('pages.clientDatabase.ban.nothingToBan')}</span>
                    ) : missing > 0 && picked[target] ? (
                      <span className="block text-xs text-amber-400">{t('pages.clientDatabase.ban.someMissing', { count: missing })}</span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </div>

          {profiles.length === 1 && chosen.length > 0 && (
            <div className="rounded-md bg-muted/40 px-3 py-2 text-xs font-mono-data space-y-0.5 break-all">
              {chosen.map((target) => (
                <div key={target}><span className="text-muted-foreground">{t(`pages.clientDatabase.ban.targets.${target}.short`)}:</span> {banRuleValue(target, profiles[0])}</div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t('pages.bans.duration')}</Label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="3600">{t('pages.bans.oneHour')}</SelectItem>
                  <SelectItem value="86400">{t('pages.bans.oneDay')}</SelectItem>
                  <SelectItem value="604800">{t('pages.bans.oneWeek')}</SelectItem>
                  <SelectItem value="2592000">{t('pages.bans.thirtyDays')}</SelectItem>
                  <SelectItem value="0">{t('common.duration.permanent')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t('pages.bans.reason')} ({t('common.optional')})</Label>
              <Input className="mt-1" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder={t('pages.bans.reasonPlaceholder')} />
            </div>
          </div>
          {preview.outcomes && <BulkPreview outcomes={preview.outcomes} />}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={ban.isPending}>{t('common.cancel')}</Button>
          <Button variant="destructive" onClick={submit} disabled={chosen.length === 0 || ban.isPending || preview.loading || preview.empty}>
            <BanIcon className="h-4 w-4 mr-1" />
            {ban.isPending || preview.loading ? t('components.confirmDialog.processing')
              : needsPreview ? t('components.bulkResult.preview.check') : t('pages.clientDatabase.actions.ban')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
