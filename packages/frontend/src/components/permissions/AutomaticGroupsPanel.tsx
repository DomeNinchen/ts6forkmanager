import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Search, AlertTriangle, X } from 'lucide-react';
import { permissionsApi } from '@/api/permissions.api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { cn } from '@/lib/utils';

// The i_group_auto_update_type values TeamSpeak's servergroupauto* commands accept.
const SG_TYPES = [10, 15, 20, 25, 30, 35, 40, 45, 50] as const;
const PREVIEW_LIMIT = 8;

type AutoAction = 'add' | 'remove';

interface Entry {
  value: string;
  negated: boolean;
  skip: boolean;
}

interface Props {
  configId: number;
  sid: number;
  perms: { permsid: string; permdesc: string }[];
}

export function AutomaticGroupsPanel({ configId, sid, perms }: Props) {
  const { t } = useTranslation();
  const [action, setAction] = useState<AutoAction>('add');
  const [sgtype, setSgtype] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Map<string, Entry>>(new Map());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? perms.filter((p) => p.permsid.toLowerCase().includes(q) || p.permdesc.toLowerCase().includes(q))
      : perms;
    return list.slice(0, 300);
  }, [perms, search]);

  const descOf = useMemo(() => new Map(perms.map((p) => [p.permsid, p.permdesc])), [perms]);

  const toggle = (permsid: string) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(permsid)) next.delete(permsid);
      // Booleans default to granted; integers start empty so a value is never sent by accident.
      else next.set(permsid, { value: permsid.startsWith('b_') ? '1' : '', negated: false, skip: false });
      return next;
    });
  };

  const patch = (permsid: string, change: Partial<Entry>) => {
    setSelected((prev) => {
      const cur = prev.get(permsid);
      if (!cur) return prev;
      return new Map(prev).set(permsid, { ...cur, ...change });
    });
  };

  const entries = [...selected.entries()];
  const valuesValid = action === 'remove' || entries.every(([, e]) => /^-?\d+$/.test(e.value.trim()));
  const canApply = sgtype !== '' && entries.length > 0 && valuesValid;

  const apply = useMutation({
    mutationFn: () => {
      const type = Number(sgtype);
      if (action === 'add') {
        return permissionsApi.automaticGroupsAdd(configId, sid, type, entries.map(([permsid, e]) => ({
          permsid,
          permvalue: parseInt(e.value, 10),
          permnegated: e.negated ? 1 : 0,
          permskip: e.skip ? 1 : 0,
        })));
      }
      return permissionsApi.automaticGroupsRemove(configId, sid, type, entries.map(([permsid]) => permsid));
    },
    onSuccess: () => {
      toast.success(t(`pages.permissions.automatic.${action === 'add' ? 'addedToast' : 'removedToast'}`, {
        count: entries.length,
        type: t(`pages.permissions.automatic.types.${sgtype}`),
      }));
      setConfirmOpen(false);
      setSelected(new Map());
    },
    onError: (err: any) => {
      setConfirmOpen(false);
      const detail = err?.response?.data?.details;
      toast.error(detail ? `${t('pages.permissions.automatic.failed')}: ${detail}` : t('pages.permissions.automatic.failed'));
    },
  });

  const names = entries.map(([permsid]) => permsid);
  const preview = names.slice(0, PREVIEW_LIMIT).join(', ')
    + (names.length > PREVIEW_LIMIT ? t('pages.permissions.automatic.andMore', { count: names.length - PREVIEW_LIMIT }) : '');
  const typeLabel = sgtype ? t(`pages.permissions.automatic.types.${sgtype}`) : '';

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* Permission picker */}
      <Card className="card-hero col-span-5">
        <CardHeader className="pb-2 space-y-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t('pages.permissions.automatic.pickerTitle')}
          </CardTitle>
          <div className="relative">
            <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('pages.permissions.searchPermissionsPlaceholder')}
              className="h-7 pl-7 text-xs"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[500px]">
            <div className="p-2 space-y-0.5">
              {visible.map((p) => {
                const on = selected.has(p.permsid);
                return (
                  <div
                    key={p.permsid}
                    onClick={() => toggle(p.permsid)}
                    title={p.permdesc || p.permsid}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs cursor-pointer transition-colors',
                      on ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50',
                    )}
                  >
                    <Checkbox checked={on} onCheckedChange={() => toggle(p.permsid)} onClick={(e) => e.stopPropagation()} />
                    <span className="truncate font-mono-data">{p.permsid}</span>
                  </div>
                );
              })}
              {visible.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">{t('pages.permissions.noPermissionsMatchSearch')}</p>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Action, type and values */}
      <Card className="card-hero col-span-7">
        <CardHeader className="pb-2 space-y-3">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t('pages.permissions.automatic.title')}
          </CardTitle>
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
            <span>{t('pages.permissions.automatic.explanation')}</span>
          </div>
          <div className="flex items-end gap-3">
            <div className="flex gap-1 p-1 bg-muted/30 rounded-lg">
              {(['add', 'remove'] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => setAction(a)}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                    action === a ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(`pages.permissions.automatic.${a}`)}
                </button>
              ))}
            </div>
            <div className="space-y-1 flex-1 max-w-xs">
              <Label className="text-[11px] text-muted-foreground">{t('pages.permissions.automatic.groupType')}</Label>
              <Select value={sgtype} onValueChange={setSgtype}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder={t('pages.permissions.automatic.groupTypePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {SG_TYPES.map((n) => (
                    <SelectItem key={n} value={String(n)}>{t(`pages.permissions.automatic.types.${n}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[330px]">
            {entries.length === 0 ? (
              <div className="flex items-center justify-center h-[300px]">
                <p className="text-sm text-muted-foreground">{t('pages.permissions.automatic.nothingSelected')}</p>
              </div>
            ) : (
              <div className="p-2 space-y-0.5">
                {action === 'add' && (
                  <div className="grid grid-cols-12 gap-2 px-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <div className="col-span-6">{t('pages.permissions.automatic.colPermission')}</div>
                    <div className="col-span-3 text-center">{t('pages.permissions.automatic.colValue')}</div>
                    <div className="col-span-1 text-center">{t('pages.permissions.colSkip')}</div>
                    <div className="col-span-1 text-center">{t('pages.permissions.colNegate')}</div>
                    <div className="col-span-1" />
                  </div>
                )}
                {entries.map(([permsid, e]) => {
                  const isBoolean = permsid.startsWith('b_');
                  return (
                    <div key={permsid} className="grid grid-cols-12 gap-2 px-2 py-1 rounded-sm text-xs items-center" title={descOf.get(permsid) || permsid}>
                      <div className={cn('truncate font-mono-data text-[11px]', action === 'add' ? 'col-span-6' : 'col-span-11')}>{permsid}</div>
                      {action === 'add' && (
                        <>
                          <div className="col-span-3 flex justify-center">
                            {isBoolean ? (
                              <Checkbox
                                checked={e.value === '1'}
                                onCheckedChange={(v) => patch(permsid, { value: v ? '1' : '0' })}
                              />
                            ) : (
                              <Input
                                type="number"
                                value={e.value}
                                onChange={(ev) => patch(permsid, { value: ev.target.value })}
                                placeholder="—"
                                className="h-6 w-24 text-xs text-center font-mono-data px-1"
                              />
                            )}
                          </div>
                          <div className="col-span-1 flex justify-center">
                            <Checkbox checked={e.skip} onCheckedChange={(v) => patch(permsid, { skip: !!v })} />
                          </div>
                          <div className="col-span-1 flex justify-center">
                            <Checkbox checked={e.negated} onCheckedChange={(v) => patch(permsid, { negated: !!v })} />
                          </div>
                        </>
                      )}
                      <div className="col-span-1 flex justify-end">
                        <button onClick={() => toggle(permsid)} className="text-muted-foreground hover:text-foreground">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
          <div className="flex items-center justify-between border-t border-border/50 p-3">
            <span className="text-[11px] text-muted-foreground">
              {t('pages.permissions.automatic.selectedCount', { count: entries.length })}
            </span>
            <Button
              size="sm"
              variant="destructive"
              disabled={!canApply || apply.isPending}
              onClick={() => setConfirmOpen(true)}
            >
              {t(`pages.permissions.automatic.${action === 'add' ? 'applyAdd' : 'applyRemove'}`)}
            </Button>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        destructive
        loading={apply.isPending}
        title={t(`pages.permissions.automatic.${action === 'add' ? 'confirmAddTitle' : 'confirmRemoveTitle'}`)}
        description={t(`pages.permissions.automatic.${action === 'add' ? 'confirmAddBody' : 'confirmRemoveBody'}`, {
          type: typeLabel,
          count: entries.length,
          permissions: preview,
        })}
        confirmLabel={t('pages.permissions.automatic.confirmButton')}
        onConfirm={() => apply.mutate()}
      />
    </div>
  );
}
