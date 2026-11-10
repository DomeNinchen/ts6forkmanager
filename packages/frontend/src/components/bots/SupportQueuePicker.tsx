import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { supportQueueApi } from '@/api/support-queue.api';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const ANY = 'any';

/**
 * Picks one support queue of the flow's virtual server (its id as a string). With `allowAny`, "every queue"
 * is offered too and stored as ''. A stored id that no longer exists stays visible as "#id".
 */
export function SupportQueuePicker({ id, configId, sid, value, allowAny, onChange }: {
  id: string; configId?: number; sid?: number; value: string; allowAny?: boolean; onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['support-queue', configId, sid], queryFn: () => supportQueueApi.queues(configId!, sid!), enabled: !!configId && !!sid });
  const queues = q.data ?? [];
  const known = queues.some((x) => String(x.config.id) === value);
  return (
    <div>
      <Label htmlFor={id} className="text-[10px] text-muted-foreground">{t('pages.botEditor.config.support.queueLabel')}</Label>
      <Select value={value || (allowAny ? ANY : '')} onValueChange={(v) => onChange(v === ANY ? '' : v)}>
        <SelectTrigger id={id} className="h-7 text-xs mt-1"><SelectValue placeholder={t('pages.botEditor.config.support.chooseQueue')} /></SelectTrigger>
        <SelectContent>
          {allowAny && <SelectItem value={ANY}>{t('pages.botEditor.config.support.anyQueue')}</SelectItem>}
          {queues.map((x) => (
            <SelectItem key={x.config.id} value={String(x.config.id)}>
              {x.config.settings.name}{x.config.enabled ? '' : ` (${t('pages.support.off')})`}
            </SelectItem>
          ))}
          {value && !known && <SelectItem value={value}>#{value}</SelectItem>}
        </SelectContent>
      </Select>
      {q.isSuccess && queues.length === 0 && <p className="mt-1 text-[10px] text-amber-400">{t('pages.botEditor.config.support.noQueue')}</p>}
    </div>
  );
}
