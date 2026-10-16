import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { OnlineCountFilter, OnlineCountScope } from '@ts6/common';
import { dashboardApi } from '@/api/dashboard.api';
import { groupsApi } from '@/api/groups.api';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface Props {
  configId: number;
  sid: number;
  /** The dashboard (Online Users tile, Lounge sentence) or the public embed widgets - two separate filters. */
  scope: OnlineCountScope;
}

/**
 * Admin form for who the online-users number leaves out on one virtual server: any of its
 * regular server groups, and this manager's own music bots. Saves on its own button.
 */
export function OnlineCountFilterEditor({ configId, sid, scope }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: stored, isLoading } = useQuery({
    queryKey: ['online-filter', configId, sid, scope],
    queryFn: () => dashboardApi.getOnlineFilter(configId, sid, scope),
  });
  // Same key as useServerGroups, so an already loaded list is reused.
  const { data: groups = [] } = useQuery({
    queryKey: ['server-groups', configId, sid],
    queryFn: () => groupsApi.serverGroups(configId, sid),
  });
  const [draft, setDraft] = useState<OnlineCountFilter | null>(null);
  useEffect(() => { if (stored) setDraft(stored); }, [stored]);

  const save = useMutation({
    mutationFn: (filter: OnlineCountFilter) => dashboardApi.setOnlineFilter(configId, sid, scope, filter),
    onSuccess: (saved) => {
      qc.setQueryData(['online-filter', configId, sid, scope], saved);
      if (scope === 'dashboard') qc.invalidateQueries({ queryKey: ['dashboard', configId, sid] });
      toast.success(t('components.onlineCountFilter.saved'));
    },
    onError: () => toast.error(t('components.onlineCountFilter.saveFailed')),
  });

  if (isLoading || !draft) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;

  // Only regular groups can hold clients; templates and query groups would just be noise here.
  const regular = (groups as any[]).filter((g) => String(g.type) === '1');
  const toggle = (sgid: number) => setDraft({
    ...draft,
    excludedGroups: draft.excludedGroups.includes(sgid)
      ? draft.excludedGroups.filter((id) => id !== sgid)
      : [...draft.excludedGroups, sgid],
  });
  const changed = JSON.stringify(draft) !== JSON.stringify(stored);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium">{t(`components.onlineCountFilter.title.${scope}`)}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t(`components.onlineCountFilter.description.${scope}`)}</p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <Label htmlFor={`exclude-bots-${scope}`}>{t('components.onlineCountFilter.excludeMusicBots')}</Label>
        <Switch
          id={`exclude-bots-${scope}`}
          checked={draft.excludeMusicBots}
          onCheckedChange={(v) => setDraft({ ...draft, excludeMusicBots: v })}
        />
      </div>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">{t('components.onlineCountFilter.groupsLabel')}</p>
        {regular.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('components.onlineCountFilter.noGroups')}</p>
        ) : (
          <div className="grid max-h-60 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
            {regular.map((g) => {
              const sgid = Number(g.sgid);
              const id = `exclude-group-${scope}-${sgid}`;
              return (
                <div key={sgid} className="flex items-center gap-2">
                  <Checkbox id={id} checked={draft.excludedGroups.includes(sgid)} onCheckedChange={() => toggle(sgid)} />
                  <Label htmlFor={id} className="truncate font-normal">{g.name}</Label>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={() => save.mutate(draft)} disabled={!changed || save.isPending}>
          {save.isPending ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </div>
  );
}
