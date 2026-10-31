import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ESCALATING_PERMISSIONS, USER_PERMISSIONS, type UserPermission, type UserRole } from '@ts6/common';
import { rolesApi } from '@/api/bots.api';
import { useRoleSetup } from '@/hooks/use-roles';
import { roleLabel } from '@/lib/roles';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** What the editor dialog is open for: a fixed role, a custom role, or a new custom role (id undefined). */
type Editing =
  | { kind: 'fixed'; role: UserRole; permissions: UserPermission[] }
  | { kind: 'custom'; id?: number; name: string; permissions: UserPermission[] };

const k = 'pages.settings.roles';

const errorText = (err: any, fallback: string) => {
  const data = err?.response?.data;
  return data?.error ? (data.details ? `${data.error}: ${data.details}` : data.error) : fallback;
};

/** Settings > Roles: change what the fixed roles may do, and set up custom roles (admin only). */
export function RolesTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data } = useRoleSetup();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [resetRole, setResetRole] = useState<UserRole | null>(null);
  const [deleteRole, setDeleteRole] = useState<{ id: number; name: string } | null>(null);

  const done = (message: string) => {
    qc.invalidateQueries({ queryKey: ['roles'] });
    toast.success(message);
  };
  const save = useMutation({
    mutationFn: (e: Editing): Promise<unknown> => e.kind === 'fixed'
      ? rolesApi.setFixed(e.role, e.permissions)
      : e.id === undefined ? rolesApi.createCustom(e.name.trim(), e.permissions) : rolesApi.updateCustom(e.id, e.name.trim(), e.permissions),
    onSuccess: () => { done(t(`${k}.saved`)); setEditing(null); },
    onError: (err) => toast.error(errorText(err, t(`${k}.saveFailed`))),
  });
  const reset = useMutation({
    mutationFn: (role: UserRole) => rolesApi.resetFixed(role),
    onSuccess: () => done(t(`${k}.resetDone`)),
    onError: (err) => toast.error(errorText(err, t(`${k}.saveFailed`))),
  });
  const remove = useMutation({
    mutationFn: (id: number) => rolesApi.deleteCustom(id),
    onSuccess: () => done(t(`${k}.deleted`)),
    onError: (err: any) => {
      const data = err?.response?.data;
      toast.error(data?.code === 'ROLE_IN_USE' ? t(`${k}.inUse`, { users: data.details }) : errorText(err, t(`${k}.deleteFailed`)));
    },
  });

  if (!data) return <PageLoader />;

  const usersLine = (users: string[]) => users.length ? t(`${k}.usersCount`, { count: users.length }) : t(`${k}.noUsers`);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t(`${k}.description`)}</p>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">{t(`${k}.fixedTitle`)}</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
            <div>
              <p className="font-medium">{roleLabel(t, 'admin')}</p>
              <p className="text-xs text-muted-foreground">{t(`${k}.adminFixed`)}</p>
            </div>
          </div>
          {data.fixed.map((f) => (
            <div key={f.role} className="flex items-center justify-between gap-3 border-t border-border py-1.5 text-sm" data-testid={`fixed-role-${f.role}`}>
              <div className="min-w-0">
                <p className="font-medium flex items-center gap-1.5">
                  {roleLabel(t, f.role)}
                  {f.changed && <Badge variant="outline" className="text-[9px]">{t(`${k}.changed`)}</Badge>}
                </p>
                <p className="text-xs text-muted-foreground">{t(`${k}.permissionCount`, { count: f.permissions.length })} · {usersLine(f.users)}</p>
              </div>
              <div className="inline-flex shrink-0 items-center gap-0.5">
                <Button variant="ghost" size="icon" className="h-7 w-7" title={t('common.edit')} onClick={() => setEditing({ kind: 'fixed', role: f.role, permissions: [...f.permissions] })}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                {f.changed && (
                  <Button variant="ghost" size="icon" className="h-7 w-7" title={t(`${k}.reset`)} onClick={() => setResetRole(f.role)}>
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-sm">{t(`${k}.customTitle`)}</CardTitle>
          <Button size="sm" onClick={() => setEditing({ kind: 'custom', name: '', permissions: ['server.view'] })}>
            <Plus className="h-4 w-4 mr-1" /> {t(`${k}.add`)}
          </Button>
        </CardHeader>
        <CardContent className="space-y-1">
          {data.custom.length === 0 && <p className="text-xs text-muted-foreground py-1.5">{t(`${k}.noCustom`)}</p>}
          {data.custom.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 border-t border-border first:border-0 py-1.5 text-sm" data-testid={`custom-role-${c.id}`}>
              <div className="min-w-0">
                <p className="font-medium truncate">{c.name}</p>
                <p className="text-xs text-muted-foreground">{t(`${k}.permissionCount`, { count: c.permissions.length })} · {usersLine(c.users)}</p>
              </div>
              <div className="inline-flex shrink-0 items-center gap-0.5">
                <Button variant="ghost" size="icon" className="h-7 w-7" title={t('common.edit')} onClick={() => setEditing({ kind: 'custom', id: c.id, name: c.name, permissions: [...c.permissions] })}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" title={t('common.delete')} onClick={() => setDeleteRole({ id: c.id, name: c.name })}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {editing && <RoleEditor editing={editing} onChange={setEditing} onSave={() => save.mutate(editing)} saving={save.isPending} onClose={() => setEditing(null)} />}

      <ConfirmDialog
        open={resetRole !== null}
        onOpenChange={() => setResetRole(null)}
        title={t(`${k}.resetTitle`, { role: roleLabel(t, resetRole ?? undefined) })}
        description={t(`${k}.resetDescription`)}
        onConfirm={() => { if (resetRole) reset.mutate(resetRole); setResetRole(null); }}
      />
      <ConfirmDialog
        open={deleteRole !== null}
        onOpenChange={() => setDeleteRole(null)}
        title={t(`${k}.deleteTitle`, { role: deleteRole?.name })}
        description={t(`${k}.deleteDescription`)}
        onConfirm={() => { if (deleteRole) remove.mutate(deleteRole.id); setDeleteRole(null); }}
        destructive
      />
    </div>
  );
}

function RoleEditor({ editing, onChange, onSave, saving, onClose }: {
  editing: Editing;
  onChange: (update: (e: Editing | null) => Editing | null) => void;
  onSave: () => void;
  saving: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const custom = editing.kind === 'custom';
  // From the latest state, so ticks in quick succession all count.
  const toggle = (p: UserPermission, on: boolean) => onChange((e) => {
    if (!e) return e;
    const set = new Set(e.permissions);
    if (on) set.add(p); else set.delete(p);
    return { ...e, permissions: USER_PERMISSIONS.filter((x) => set.has(x)) };
  });
  const title = editing.kind === 'fixed'
    ? t(`${k}.editFixedTitle`, { role: roleLabel(t, editing.role) })
    : editing.id === undefined ? t(`${k}.addTitle`) : t(`${k}.editCustomTitle`, { role: editing.name });

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="text-sm">{title}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {editing.kind === 'custom' && (
            <div>
              <Label className="text-xs">{t(`${k}.name`)}</Label>
              <Input value={editing.name} maxLength={32} onChange={(ev) => { const name = ev.target.value; onChange((e) => (e?.kind === 'custom' ? { ...e, name } : e)); }} placeholder={t(`${k}.namePlaceholder`)} />
            </div>
          )}
          {custom && <p className="text-xs text-muted-foreground">{t(`${k}.customNoEscalating`)}</p>}
          <div className="space-y-1.5" data-testid="role-editor-permissions">
            {USER_PERMISSIONS.map((p) => {
              const escalating = ESCALATING_PERMISSIONS.includes(p);
              const blocked = custom && escalating;
              return (
                <label key={p} className={`flex items-start gap-2 text-xs ${blocked ? 'opacity-50' : 'cursor-pointer'}`}>
                  <Checkbox
                    checked={editing.permissions.includes(p)}
                    disabled={blocked}
                    onCheckedChange={(v) => toggle(p, v === true)}
                    aria-label={t(`pages.settings.users.permissions.labels.${p.replace('.', '_')}`)}
                    data-permission={p}
                  />
                  <span>
                    {t(`pages.settings.users.permissions.labels.${p.replace('.', '_')}`)}
                    {escalating && <span className="ml-1.5 text-amber-600 dark:text-amber-400">({t('pages.settings.users.permissions.escalating')})</span>}
                  </span>
                </label>
              );
            })}
          </div>
          {editing.kind === 'fixed' && <p className="text-xs text-muted-foreground">{t(`${k}.fixedAppliesNow`)}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={onSave} disabled={saving || (editing.kind === 'custom' && !editing.name.trim())}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
