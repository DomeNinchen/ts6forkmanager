import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '@/api/bots.api';
import { authApi } from '@/api/auth.api';
import { serversApi } from '@/api/servers.api';
import { settingsApi, RECOMMENDED_ACCENT, type ScheduledRestartConfig, type OidcSettings, type OidcSettingsInput, type MusicCacheSettings, type StreamDefaults, type StreamPreset, type AccentPreset, type BaseTheme } from '@/api/settings.api';
import { ACCENT_PRESETS, DARK_THEME_PRESETS, LIGHT_THEME_PRESETS, accentLabel, baseThemeLabel } from '@/lib/themes';
import { useAuthStore } from '@/stores/auth.store';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Settings as SettingsIcon, Users, Server, Plus, Trash2, Pencil, TestTube, Check, X, Lock, KeyRound, Film, Upload, FileText, Bug, AlertTriangle, Timer, RefreshCw, ShieldCheck, Search, Monitor, Bot, Palette, Video } from 'lucide-react';
import { toast } from 'sonner';
import { compareVersions } from '@ts6/common';
import { useUpdateCheck, useRecheckUpdate } from '@/hooks/use-update-check';
import { useYtCookieCheck, useRecheckYtCookies } from '@/hooks/use-yt-cookie-check';
import { useSetWebguiTheme, useSetWebguiBaseTheme } from '@/hooks/use-webgui-theme';
import { useUiStore } from '@/stores/ui.store';
import { useLanguagePreference } from '@/hooks/use-language';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

export default function Settings() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">{t('pages.settings.title')}</h1>

      <Tabs defaultValue="account">
        <TabsList>
          {isAdmin && <TabsTrigger value="connections"><Server className="h-3.5 w-3.5 mr-1" /> {t('pages.settings.tabs.connections')}</TabsTrigger>}
          <TabsTrigger value="account"><Lock className="h-3.5 w-3.5 mr-1" /> {t('pages.settings.tabs.account')}</TabsTrigger>
          <TabsTrigger value="webgui"><Palette className="h-3.5 w-3.5 mr-1" /> {t('pages.settings.tabs.webgui')}</TabsTrigger>
          {isAdmin && <TabsTrigger value="users"><Users className="h-3.5 w-3.5 mr-1" /> {t('pages.settings.tabs.users')}</TabsTrigger>}
          {isAdmin && <TabsTrigger value="youtube"><Film className="h-3.5 w-3.5 mr-1" /> {t('pages.settings.tabs.youtube')}</TabsTrigger>}
          {isAdmin && <TabsTrigger value="streaming"><Video className="h-3.5 w-3.5 mr-1" /> {t('pages.settings.tabs.streaming')}</TabsTrigger>}
          {isAdmin && <TabsTrigger value="debug"><Bug className="h-3.5 w-3.5 mr-1" /> {t('pages.settings.tabs.debug')}</TabsTrigger>}
          {isAdmin && <TabsTrigger value="restart"><Timer className="h-3.5 w-3.5 mr-1" /> {t('pages.settings.tabs.restart')}</TabsTrigger>}
          {isAdmin && <TabsTrigger value="sso"><ShieldCheck className="h-3.5 w-3.5 mr-1" /> {t('pages.settings.tabs.sso')}</TabsTrigger>}
          {isAdmin && <TabsTrigger value="update-status"><RefreshCw className="h-3.5 w-3.5 mr-1" /> {t('pages.settings.tabs.updateStatus')}</TabsTrigger>}
        </TabsList>

        {isAdmin && (
          <TabsContent value="connections" className="mt-4">
            <ConnectionsTab />
          </TabsContent>
        )}

        <TabsContent value="account" className="mt-4">
          <AccountTab />
        </TabsContent>

        <TabsContent value="webgui" className="mt-4">
          <WebGuiTab isAdmin={isAdmin} />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="users" className="mt-4">
            <UsersTab />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="youtube" className="mt-4">
            <YouTubeTab />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="streaming" className="mt-4">
            <StreamingTab />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="debug" className="mt-4">
            <DebugTab />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="restart" className="mt-4">
            <RestartTab />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="sso" className="mt-4">
            <SsoTab />
          </TabsContent>
        )}

        <TabsContent value="update-status" className="mt-4">
          <UpdateStatusTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AccountTab() {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const changePassword = useMutation({
    mutationFn: () => authApi.changePassword(currentPassword, newPassword),
  });

  const handleSubmit = () => {
    if (newPassword.length < 6) {
      toast.error(t('pages.settings.account.passwordMinLength'));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t('pages.settings.account.passwordMismatch'));
      return;
    }
    changePassword.mutate(undefined, {
      onSuccess: () => {
        toast.success(t('pages.settings.account.passwordChangedSuccess'));
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      },
      onError: (err: any) => {
        const msg = err?.response?.data?.error || t('pages.settings.account.passwordChangeFailed');
        toast.error(msg);
      },
    });
  };

  return (
    <div className="max-w-md">
      <Card className="card-hero">
        <CardHeader>
          <CardTitle className="text-sm font-medium">{t('pages.settings.account.changePasswordTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">{t('pages.settings.account.currentPasswordLabel')}</Label>
            <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder={t('pages.settings.account.currentPasswordPlaceholder')} />
          </div>
          <div>
            <Label className="text-xs">{t('pages.settings.account.newPasswordLabel')}</Label>
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={t('pages.settings.account.newPasswordPlaceholder')} />
          </div>
          <div>
            <Label className="text-xs">{t('pages.settings.account.confirmNewPasswordLabel')}</Label>
            <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder={t('pages.settings.account.confirmNewPasswordPlaceholder')} />
          </div>
          <Button
            onClick={handleSubmit}
            disabled={!currentPassword || !newPassword || !confirmPassword || changePassword.isPending}
            className="w-full mt-1"
          >
            {changePassword.isPending ? t('pages.settings.account.changing') : t('pages.settings.account.changePasswordTitle')}
          </Button>
        </CardContent>
      </Card>

      <TwoFactorCard />
    </div>
  );
}

function TwoFactorCard() {
  const { t } = useTranslation();
  const { user, updateUser } = useAuthStore();
  const [step, setStep] = useState<'idle' | 'setup' | 'codes'>('idle');
  const [qrData, setQrData] = useState<{ secret: string; qrCodeDataUrl: string } | null>(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [showDisable, setShowDisable] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');

  const setup = useMutation({
    mutationFn: authApi.totpSetup,
    onSuccess: (data) => { setQrData(data); setStep('setup'); },
    onError: () => toast.error(t('pages.settings.twoFactor.setupFailed')),
  });

  const verifySetup = useMutation({
    mutationFn: () => authApi.totpVerifySetup(confirmCode),
    onSuccess: (data) => {
      updateUser({ totpEnabled: true });
      setRecoveryCodes(data.recoveryCodes);
      setStep('codes');
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || t('pages.settings.twoFactor.invalidCode')),
  });

  const disable = useMutation({
    mutationFn: () => authApi.totpDisable(disablePassword),
    onSuccess: () => {
      updateUser({ totpEnabled: false });
      toast.success(t('pages.settings.twoFactor.twoFaDisabledToast'));
      setShowDisable(false);
      setDisablePassword('');
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || t('pages.settings.twoFactor.disableFailed')),
  });

  const closeSetup = () => {
    setStep('idle');
    setQrData(null);
    setConfirmCode('');
    setRecoveryCodes(null);
  };

  return (
    <>
      <Card className="card-hero mt-4">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm font-medium">{t('pages.settings.twoFactor.title')}</CardTitle>
          <Badge variant={user?.totpEnabled ? 'default' : 'secondary'} className="text-[10px]">
            {user?.totpEnabled ? t('common.enabled') : t('common.disabled')}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {t('pages.settings.twoFactor.description')}
          </p>
          {user?.totpEnabled ? (
            <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setShowDisable(true)}>
              {t('pages.settings.twoFactor.disable2fa')}
            </Button>
          ) : (
            <Button onClick={() => setup.mutate()} disabled={setup.isPending}>
              {setup.isPending ? t('pages.settings.twoFactor.starting') : t('pages.settings.twoFactor.enable2fa')}
            </Button>
          )}
        </CardContent>
      </Card>

      <Dialog open={step !== 'idle'} onOpenChange={(v) => { if (!v) closeSetup(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle className="text-sm">{t('pages.settings.twoFactor.setupTitle')}</DialogTitle></DialogHeader>

          {step === 'setup' && qrData && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {t('pages.settings.twoFactor.scanInstructions')}
              </p>
              <img src={qrData.qrCodeDataUrl} alt={t('pages.settings.twoFactor.qrAlt')} className="mx-auto rounded-md border border-border bg-white p-2" />
              <p className="text-[11px] text-muted-foreground text-center break-all">
                {t('pages.settings.twoFactor.manualEntryLabel')} <span className="font-mono-data">{qrData.secret}</span>
              </p>
              <div>
                <Label className="text-xs">{t('pages.settings.twoFactor.confirmationCodeLabel')}</Label>
                <Input value={confirmCode} onChange={(e) => setConfirmCode(e.target.value)} placeholder="123456" autoFocus />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeSetup}>{t('common.cancel')}</Button>
                <Button onClick={() => verifySetup.mutate()} disabled={!confirmCode || verifySetup.isPending}>
                  {verifySetup.isPending ? t('pages.settings.twoFactor.verifying') : t('pages.settings.twoFactor.verifyAndEnable')}
                </Button>
              </DialogFooter>
            </div>
          )}

          {step === 'codes' && recoveryCodes && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {t('pages.settings.twoFactor.recoveryCodesHint')}
              </p>
              <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/30 p-3 font-mono-data text-xs">
                {recoveryCodes.map((c) => <span key={c}>{c}</span>)}
              </div>
              <DialogFooter>
                <Button onClick={() => { toast.success(t('pages.settings.twoFactor.twoFaEnabledToast')); closeSetup(); }}>{t('pages.settings.twoFactor.savedCodesConfirm')}</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showDisable} onOpenChange={setShowDisable}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-sm">{t('pages.settings.twoFactor.disableTitle')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{t('pages.settings.twoFactor.disableConfirmHint')}</p>
            <Input type="password" value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} placeholder={t('pages.settings.twoFactor.disablePasswordPlaceholder')} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDisable(false)}>{t('common.cancel')}</Button>
            <Button variant="destructive" onClick={() => disable.mutate()} disabled={!disablePassword || disable.isPending}>
              {disable.isPending ? t('pages.settings.twoFactor.disabling') : t('pages.settings.twoFactor.disableAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AccentSwatchPicker({ value, onChange, disabled }: { value: AccentPreset | null; onChange: (preset: AccentPreset) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {ACCENT_PRESETS.map((p) => (
        <button
          key={p.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(p.value)}
          className={cn(
            'flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition-colors',
            value === p.value ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
            disabled && 'opacity-50 cursor-not-allowed',
          )}
        >
          <span className="h-3 w-3 rounded-full border border-border/50" style={{ background: p.swatch }} />
          {p.label}
        </button>
      ))}
    </div>
  );
}

function BaseThemeSwatchPicker({ value, onChange, disabled }: { value: BaseTheme | null; onChange: (theme: BaseTheme) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  const groups = [
    { title: t('pages.settings.webgui.darkGroup'), items: DARK_THEME_PRESETS },
    { title: t('pages.settings.webgui.lightGroup'), items: LIGHT_THEME_PRESETS },
  ];
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.title} className="space-y-1.5">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{group.title}</p>
          <div className="flex flex-wrap gap-2">
            {group.items.map((t) => (
              <button
                key={t.value}
                type="button"
                disabled={disabled}
                onClick={() => onChange(t.value)}
                title={t.description}
                className={cn(
                  'flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition-colors',
                  value === t.value ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
                  disabled && 'opacity-50 cursor-not-allowed',
                )}
              >
                <span className="h-3 w-3 rounded-full border border-border/50" style={{ background: t.preview }} />
                {t.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function WebGuiTab({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useTranslation();
  const { language, setLanguage, isSaving: isSavingLanguage } = useLanguagePreference();
  const { data: installTheme, isLoading } = useQuery({
    queryKey: ['webgui-theme'],
    queryFn: settingsApi.getWebguiTheme,
  });
  const { data: installBaseTheme, isLoading: isLoadingBaseTheme } = useQuery({
    queryKey: ['webgui-base-theme'],
    queryFn: settingsApi.getWebguiBaseTheme,
  });
  const setInstallTheme = useSetWebguiTheme();
  const setInstallBaseTheme = useSetWebguiBaseTheme();
  const accentOverride = useUiStore((s) => s.accentOverride);
  const setAccentOverride = useUiStore((s) => s.setAccentOverride);
  const baseThemeOverride = useUiStore((s) => s.baseThemeOverride);
  const setBaseThemeOverride = useUiStore((s) => s.setBaseThemeOverride);

  if (isLoading || isLoadingBaseTheme) return <PageLoader />;

  // Picking a preset that already matches the installation default clears the personal
  // override instead of pinning the same value, so a later admin change still reaches this browser.
  const pickAccent = (preset: AccentPreset) => setAccentOverride(preset === installTheme?.preset ? null : preset);

  const pickBaseTheme = (theme: BaseTheme) => {
    setBaseThemeOverride(theme === installBaseTheme?.theme ? null : theme);
    const recommended = RECOMMENDED_ACCENT[theme];
    if (recommended !== (accentOverride ?? installTheme?.preset ?? 'violet')) {
      toast(t('pages.settings.webgui.pairingHint', { theme: baseThemeLabel(theme), accent: accentLabel(recommended) }), {
        action: { label: t('common.apply'), onClick: () => pickAccent(recommended) },
      });
    }
  };

  return (
    <div className="max-w-lg space-y-4">
      <Card className="card-hero">
        <CardHeader>
          <CardTitle className="text-sm font-medium">{t('pages.settings.webgui.language.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {t('pages.settings.webgui.language.description')}
          </p>
          <Select value={language} onValueChange={(v) => setLanguage(v as 'en' | 'de')} disabled={isSavingLanguage}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="de">Deutsch</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className="card-hero">
        <CardHeader>
          <CardTitle className="text-sm font-medium">{t('pages.settings.webgui.myBaseTheme')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {t('pages.settings.webgui.baseThemeDescription')}
          </p>
          <BaseThemeSwatchPicker
            value={baseThemeOverride ?? installBaseTheme?.theme ?? 'command-deck'}
            onChange={pickBaseTheme}
          />
          {baseThemeOverride && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setBaseThemeOverride(null)}>
              {t('pages.settings.webgui.resetToInstallDefault')}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="card-hero">
        <CardHeader>
          <CardTitle className="text-sm font-medium">{t('pages.settings.webgui.myAccent')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {t('pages.settings.webgui.accentDescription')}
          </p>
          <AccentSwatchPicker
            value={accentOverride ?? installTheme?.preset ?? 'violet'}
            onChange={pickAccent}
          />
          {accentOverride && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setAccentOverride(null)}>
              {t('pages.settings.webgui.resetToInstallDefault')}
            </Button>
          )}
        </CardContent>
      </Card>

      {isAdmin && (
        <Card className="card-hero">
          <CardHeader>
            <CardTitle className="text-sm font-medium">{t('pages.settings.webgui.installDefaultBaseTheme')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {t('pages.settings.webgui.installDefaultBaseThemeDescription')}
            </p>
            <BaseThemeSwatchPicker
              value={installBaseTheme?.theme ?? 'command-deck'}
              onChange={(theme) => setInstallBaseTheme.mutate(theme, {
                onSuccess: () => toast.success(t('pages.settings.webgui.baseThemeSetToast', { theme: baseThemeLabel(theme) })),
                onError: () => toast.error(t('pages.settings.webgui.baseThemeSetFailed')),
              })}
              disabled={setInstallBaseTheme.isPending}
            />
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <Card className="card-hero">
          <CardHeader>
            <CardTitle className="text-sm font-medium">{t('pages.settings.webgui.installDefaultAccent')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {t('pages.settings.webgui.installDefaultAccentDescription')}
            </p>
            <AccentSwatchPicker
              value={installTheme?.preset ?? 'violet'}
              onChange={(preset) => setInstallTheme.mutate(preset, {
                onSuccess: () => toast.success(t('pages.settings.webgui.accentSetToast', { accent: accentLabel(preset) })),
                onError: () => toast.error(t('pages.settings.webgui.accentSetFailed')),
              })}
              disabled={setInstallTheme.isPending}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ConnectionsTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: servers, isLoading } = useQuery({ queryKey: ['servers'], queryFn: serversApi.list });
  const createServer = useMutation({ mutationFn: (data: any) => serversApi.create(data), onSuccess: () => qc.invalidateQueries({ queryKey: ['servers'] }) });
  const updateServer = useMutation({ mutationFn: ({ id, data }: any) => serversApi.update(id, data), onSuccess: () => qc.invalidateQueries({ queryKey: ['servers'] }) });
  const deleteServer = useMutation({ mutationFn: (id: number) => serversApi.delete(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['servers'] }) });
  const testServer = useMutation({ mutationFn: (id: number) => serversApi.test(id) });

  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [botIdentityServerId, setBotIdentityServerId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', host: '', webqueryPort: '10080', apiKey: '', useHttps: false, sshPort: '10022', sshUsername: '', sshPassword: '', pingHost: '' });

  const serverList = useMemo(() => (Array.isArray(servers) ? servers : []), [servers]);
  const editingServer = editId ? serverList.find((s: any) => s.id === editId) : null;

  if (isLoading) return <PageLoader />;

  const resetForm = () => setForm({ name: '', host: '', webqueryPort: '10080', apiKey: '', useHttps: false, sshPort: '10022', sshUsername: '', sshPassword: '', pingHost: '' });

  const handleSave = () => {
    const payload = { ...form, webqueryPort: parseInt(form.webqueryPort), sshPort: parseInt(form.sshPort) };
    if (editId) {
      updateServer.mutate({ id: editId, data: payload }, {
        onSuccess: () => { toast.success(t('pages.settings.connections.connectionUpdated')); setEditId(null); setShowAdd(false); resetForm(); },
        onError: () => toast.error(t('pages.settings.connections.updateFailed')),
      });
    } else {
      createServer.mutate(payload, {
        onSuccess: () => { toast.success(t('pages.settings.connections.connectionAdded')); setShowAdd(false); resetForm(); },
        onError: () => toast.error(t('pages.settings.connections.createFailed')),
      });
    }
  };

  const openEdit = (server: any) => {
    setForm({
      name: server.name || '',
      host: server.host || '',
      webqueryPort: String(server.webqueryPort || 10080),
      apiKey: server.apiKey || '',
      useHttps: server.useHttps || false,
      sshPort: String(server.sshPort || 10022),
      sshUsername: server.sshUsername || '',
      sshPassword: server.sshPassword || '',
      pingHost: server.pingHost || '',
    });
    setEditId(server.id);
    setShowAdd(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t('pages.settings.connections.manageDescription')}</p>
        <Button size="sm" onClick={() => { resetForm(); setEditId(null); setShowAdd(true); }}><Plus className="h-4 w-4 mr-1" /> {t('pages.settings.connections.addConnection')}</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {serverList.map((server: any) => (
          <Card key={server.id} className="card-hero">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">{server.name}</CardTitle>
                <Badge variant={server.enabled ? 'default' : 'secondary'} className="text-[10px]">
                  {server.enabled ? t('common.enabled') : t('common.disabled')}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <span className="text-muted-foreground">{t('pages.settings.connections.host')}</span>
                <span className="font-mono-data">{server.host}:{server.webqueryPort}</span>
                <span className="text-muted-foreground">{t('pages.settings.connections.protocol')}</span>
                <span>{server.useHttps ? 'HTTPS' : 'HTTP'}</span>
                <span className="text-muted-foreground">{t('pages.settings.connections.ssh')}</span>
                <span className="font-mono-data">{server.sshPort || '-'}</span>
              </div>
              <div className="flex items-center gap-1 pt-2">
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => testServer.mutate(server.id, {
                  onSuccess: (data: any) => data?.success ? toast.success(t('pages.settings.connections.connectionSuccessful')) : toast.error(data?.error ? t('pages.settings.connections.connectionFailedWithError', { error: data.error }) : t('pages.settings.connections.connectionFailed')),
                  onError: () => toast.error(t('pages.settings.connections.connectionFailed')),
                })}>
                  <TestTube className="h-3 w-3 mr-1" /> {t('pages.settings.connections.test')}
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openEdit(server)}>
                  <Pencil className="h-3 w-3 mr-1" /> {t('common.edit')}
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setBotIdentityServerId(server.id)}>
                  <Bot className="h-3 w-3 mr-1" /> {server.hasBotIdentity ? server.botQueryName : t('pages.settings.connections.botIdentityFallback')}
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(server.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={showAdd} onOpenChange={(v) => { if (!v) { setShowAdd(false); setEditId(null); resetForm(); } else setShowAdd(true); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editId ? t('pages.settings.connections.editConnectionTitle') : t('pages.settings.connections.addConnection')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">{t('common.name')}</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('pages.settings.connections.namePlaceholder')} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">{t('pages.settings.connections.host')}</Label><Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder={t('pages.settings.connections.hostPlaceholder')} /></div>
              <div><Label className="text-xs">{t('pages.settings.connections.webqueryPortLabel')}</Label><Input type="number" value={form.webqueryPort} onChange={(e) => setForm({ ...form, webqueryPort: e.target.value })} /></div>
            </div>
            <div>
              <Label className="text-xs">{t('pages.settings.connections.apiKeyLabel')}</Label>
              <Input value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder={editId ? t('pages.settings.connections.apiKeyUnchangedPlaceholder') : t('pages.settings.connections.apiKeyPlaceholder')} type="password" />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.useHttps} onCheckedChange={(v) => setForm({ ...form, useHttps: v })} />
              <Label className="text-xs">{t('pages.settings.connections.useHttps')}</Label>
            </div>
            <div>
              <Label className="text-xs">{t('pages.settings.connections.pingTargetLabel')}</Label>
              <Input value={form.pingHost} onChange={(e) => setForm({ ...form, pingHost: e.target.value })} placeholder={t('pages.settings.connections.pingTargetPlaceholder', { host: form.host || '...' })} />
              <p className="text-[11px] text-muted-foreground mt-1">
                {t('pages.settings.connections.pingTargetHint')}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label className="text-xs">{t('pages.settings.connections.sshPortLabel')}</Label><Input type="number" value={form.sshPort} onChange={(e) => setForm({ ...form, sshPort: e.target.value })} /></div>
              <div><Label className="text-xs">{t('pages.settings.connections.sshUserLabel')}</Label><Input value={form.sshUsername} onChange={(e) => setForm({ ...form, sshUsername: e.target.value })} placeholder={editingServer?.hasSshCredentials ? t('pages.settings.connections.unchanged') : t('pages.settings.connections.sshUserPlaceholder')} /></div>
              <div><Label className="text-xs">{t('pages.settings.connections.sshPasswordLabel')}</Label><Input type="password" value={form.sshPassword} onChange={(e) => setForm({ ...form, sshPassword: e.target.value })} placeholder={editingServer?.hasSshCredentials ? t('pages.settings.connections.unchanged') : ''} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAdd(false); setEditId(null); resetForm(); }}>{t('common.cancel')}</Button>
            <Button onClick={handleSave} disabled={!form.name || !form.host || (!editId && !form.apiKey)}>{editId ? t('pages.settings.connections.update') : t('common.add')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={() => setDeleteId(null)}
        title={t('pages.settings.connections.deleteConnectionTitle')}
        description={t('pages.settings.connections.deleteConnectionDescription')}
        onConfirm={() => { if (deleteId) deleteServer.mutate(deleteId, { onSuccess: () => { toast.success(t('pages.settings.connections.connectionDeleted')); setDeleteId(null); } }); }}
        destructive
      />

      {botIdentityServerId !== null && (
        <BotIdentityDialog
          server={serverList.find((s: any) => s.id === botIdentityServerId)}
          onClose={() => setBotIdentityServerId(null)}
        />
      )}
    </div>
  );
}

function BotIdentityDialog({ server, onClose }: { server: any; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState(server?.botQueryName || '');

  const create = useMutation({
    mutationFn: () => serversApi.createBotIdentity(server.id, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['servers'] });
      toast.success(server?.hasBotIdentity ? t('pages.settings.botIdentity.apiKeyReissued') : t('pages.settings.botIdentity.createdToast'));
      onClose();
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || t('pages.settings.botIdentity.createFailed')),
  });

  const rename = useMutation({
    mutationFn: () => serversApi.update(server.id, { botQueryName: name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['servers'] });
      toast.success(t('pages.settings.botIdentity.renamedToast'));
      onClose();
    },
    onError: () => toast.error(t('pages.settings.botIdentity.renameFailed')),
  });

  const pending = create.isPending || rename.isPending;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle className="text-sm">{t('pages.settings.botIdentity.dialogTitle', { name: server?.name })}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {server?.hasBotIdentity
              ? t('pages.settings.botIdentity.hasIdentityDescription')
              : t('pages.settings.botIdentity.noIdentityDescription')}
          </p>
          {server?.hasBotIdentity && (
            <p className="text-xs text-muted-foreground">
              {t('pages.settings.botIdentity.scopeFixHint')}
            </p>
          )}
          <div>
            <Label className="text-xs">{t('pages.settings.botIdentity.displayNameLabel')}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Hausmeister" autoFocus />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          {server?.hasBotIdentity ? (
            <>
              <Button variant="outline" onClick={() => create.mutate()} disabled={!name || pending}>
                {create.isPending ? t('pages.settings.botIdentity.fixing') : t('pages.settings.botIdentity.fixPermissions')}
              </Button>
              <Button onClick={() => rename.mutate()} disabled={!name || pending}>
                {rename.isPending ? t('common.saving') : t('common.save')}
              </Button>
            </>
          ) : (
            <Button onClick={() => create.mutate()} disabled={!name || pending}>
              {pending ? t('common.creating') : t('pages.settings.botIdentity.createBotIdentityButton')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UsersTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const { data: users, isLoading } = useQuery({ queryKey: ['users'], queryFn: usersApi.list });
  const createUser = useMutation({ mutationFn: (data: any) => usersApi.create(data), onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }) });
  const updateUser = useMutation({ mutationFn: ({ id, data }: { id: number; data: any }) => usersApi.update(id, data), onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }) });
  const deleteUser = useMutation({ mutationFn: (id: number) => usersApi.delete(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }) });

  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [resetPwUserId, setResetPwUserId] = useState<number | null>(null);
  const [resetPwValue, setResetPwValue] = useState('');
  const [accessUserId, setAccessUserId] = useState<number | null>(null);
  const [sessionsUserId, setSessionsUserId] = useState<number | null>(null);
  const [editUser, setEditUser] = useState<{ id: number; username: string; displayName: string } | null>(null);
  const [form, setForm] = useState({ username: '', password: '', displayName: '', role: 'viewer' });

  const userList = useMemo(() => (Array.isArray(users) ? users : []), [users]);
  const filteredList = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return userList;
    return userList.filter((u: any) => u.username.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q));
  }, [userList, search]);
  const { data: servers } = useQuery({ queryKey: ['servers'], queryFn: serversApi.list });
  const serverList = useMemo(() => (Array.isArray(servers) ? servers : []), [servers]);

  if (isLoading) return <PageLoader />;

  const apiErrorMessage = (err: any, fallback: string) => err?.response?.data?.error || fallback;

  const handleCreate = () => {
    createUser.mutate(form, {
      onSuccess: () => { toast.success(t('pages.settings.users.userCreated')); setShowAdd(false); setForm({ username: '', password: '', displayName: '', role: 'viewer' }); },
      onError: (err) => toast.error(apiErrorMessage(err, t('pages.settings.users.createUserFailed'))),
    });
  };

  const handleRoleChange = (userId: number, role: string) => {
    updateUser.mutate({ id: userId, data: { role } }, {
      onSuccess: () => toast.success(t('pages.settings.users.roleUpdated')),
      onError: (err) => toast.error(apiErrorMessage(err, t('pages.settings.users.roleUpdateFailed'))),
    });
  };

  const handleToggleEnabled = (userId: number, enabled: boolean) => {
    updateUser.mutate({ id: userId, data: { enabled } }, {
      onSuccess: () => toast.success(enabled ? t('pages.settings.users.userEnabledToast') : t('pages.settings.users.userDisabledToast')),
      onError: (err) => toast.error(apiErrorMessage(err, t('pages.settings.users.statusUpdateFailed'))),
    });
  };

  const handleResetPassword = () => {
    if (!resetPwUserId || resetPwValue.length < 6) {
      toast.error(t('pages.settings.users.resetPasswordMinLength'));
      return;
    }
    updateUser.mutate({ id: resetPwUserId, data: { password: resetPwValue } }, {
      onSuccess: () => { toast.success(t('pages.settings.users.passwordResetSuccess')); setResetPwUserId(null); setResetPwValue(''); },
      onError: (err) => toast.error(apiErrorMessage(err, t('pages.settings.users.resetPasswordFailed'))),
    });
  };

  const handleSaveEdit = () => {
    if (!editUser) return;
    updateUser.mutate({ id: editUser.id, data: { username: editUser.username, displayName: editUser.displayName } }, {
      onSuccess: () => { toast.success(t('pages.settings.users.userUpdated')); setEditUser(null); },
      onError: (err) => toast.error(apiErrorMessage(err, t('pages.settings.users.updateUserFailed'))),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground shrink-0">{t('pages.settings.users.manageDescription')}</p>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('pages.settings.users.searchPlaceholder')} className="h-8 w-48 pl-7 text-xs" />
          </div>
          <Button size="sm" onClick={() => setShowAdd(true)}><Plus className="h-4 w-4 mr-1" /> {t('pages.settings.users.addUser')}</Button>
        </div>
      </div>

      <div className="card-hero rounded-md border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="h-10 px-3 text-left font-medium text-muted-foreground">{t('pages.settings.users.colUsername')}</th>
              <th className="h-10 px-3 text-left font-medium text-muted-foreground">{t('pages.settings.users.colDisplayName')}</th>
              <th className="h-10 px-3 text-left font-medium text-muted-foreground">{t('common.role')}</th>
              <th className="h-10 px-3 text-left font-medium text-muted-foreground">{t('common.status')}</th>
              <th className="h-10 px-3 text-left font-medium text-muted-foreground">{t('pages.settings.users.colLastLogin')}</th>
              <th className="h-10 px-3 text-right font-medium text-muted-foreground">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {filteredList.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-muted-foreground">{t('pages.settings.users.noUsersMatch', { search })}</td></tr>
            )}
            {filteredList.map((u: any) => {
              const isSelf = u.id === currentUser?.id;
              return (
                <tr key={u.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-2.5 font-mono-data text-xs">
                    <div className="flex items-center gap-1.5">
                      {u.username}
                      {u.authProvider === 'oidc' && <Badge variant="outline" className="text-[9px]">{t('pages.settings.users.ssoBadge')}</Badge>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">{u.displayName}</td>
                  <td className="px-3 py-2.5">
                    <Select value={u.role} onValueChange={(v) => handleRoleChange(u.id, v)} disabled={isSelf}>
                      <SelectTrigger className="h-7 w-[130px] text-xs" title={isSelf ? t('pages.settings.users.cantChangeOwnRole') : undefined}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">{t('common.roles.admin')}</SelectItem>
                        <SelectItem value="viewer">{t('common.roles.viewer')}</SelectItem>
                        <SelectItem value="bot-operator">{t('common.roles.botOperator')}</SelectItem>
                        <SelectItem value="music-operator">{t('common.roles.musicOperator')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-3 py-2.5">
                    <Switch
                      checked={u.enabled}
                      onCheckedChange={(v) => handleToggleEnabled(u.id, v)}
                      disabled={isSelf}
                      title={isSelf ? t('pages.settings.users.cantDisableOwnAccount') : undefined}
                    />
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : t('pages.settings.users.never')}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="inline-flex items-center gap-0.5">
                      <Button variant="ghost" size="icon" className="h-7 w-7" title={t('common.edit')} onClick={() => setEditUser({ id: u.id, username: u.username, displayName: u.displayName })}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {u.role !== 'admin' && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" title={t('pages.settings.users.serverAccessTitle')} onClick={() => setAccessUserId(u.id)}>
                          <Server className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-7 w-7" title={t('pages.settings.users.sessionsTitle')} onClick={() => setSessionsUserId(u.id)}>
                        <Monitor className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" title={t('pages.settings.users.resetPasswordTitle')} onClick={() => { setResetPwUserId(u.id); setResetPwValue(''); }}>
                        <KeyRound className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(u.id)} disabled={isSelf} title={isSelf ? t('pages.settings.users.cantDeleteOwnAccount') : undefined}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add User Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('pages.settings.users.addUser')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">{t('common.username')}</Label><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder={t('pages.settings.users.usernamePlaceholder')} /></div>
            <div><Label className="text-xs">{t('pages.settings.users.colDisplayName')}</Label><Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder={t('pages.settings.users.displayNamePlaceholder')} /></div>
            <div><Label className="text-xs">{t('common.password')}</Label><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={t('pages.settings.users.passwordPlaceholder')} /></div>
            <div>
              <Label className="text-xs">{t('common.role')}</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">{t('common.roles.admin')}</SelectItem>
                  <SelectItem value="viewer">{t('common.roles.viewer')}</SelectItem>
                  <SelectItem value="bot-operator">{t('common.roles.botOperator')}</SelectItem>
                  <SelectItem value="music-operator">{t('common.roles.musicOperator')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleCreate} disabled={!form.username || !form.password}>{t('common.create')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={resetPwUserId !== null} onOpenChange={(v) => { if (!v) { setResetPwUserId(null); setResetPwValue(''); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">{t('pages.settings.users.resetPasswordTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {t('pages.settings.users.setNewPasswordFor', { username: userList.find((u: any) => u.id === resetPwUserId)?.username })}
            </p>
            <div>
              <Label className="text-xs">{t('pages.settings.account.newPasswordLabel')}</Label>
              <Input type="password" value={resetPwValue} onChange={(e) => setResetPwValue(e.target.value)} placeholder={t('pages.settings.account.newPasswordPlaceholder')} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setResetPwUserId(null); setResetPwValue(''); }}>{t('common.cancel')}</Button>
            <Button onClick={handleResetPassword} disabled={resetPwValue.length < 6 || updateUser.isPending}>
              {updateUser.isPending ? t('pages.settings.users.resetting') : t('pages.settings.users.resetPasswordTitle')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={() => setDeleteId(null)}
        title={t('pages.settings.users.deleteUserTitle')}
        description={t('pages.settings.users.deleteUserDescription')}
        onConfirm={() => {
          if (!deleteId) return;
          deleteUser.mutate(deleteId, {
            onSuccess: () => { toast.success(t('pages.settings.users.userDeleted')); setDeleteId(null); },
            onError: (err) => { toast.error(apiErrorMessage(err, t('pages.settings.users.deleteUserFailed'))); setDeleteId(null); },
          });
        }}
        destructive
      />

      {/* Edit User Dialog */}
      <Dialog open={editUser !== null} onOpenChange={(v) => { if (!v) setEditUser(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-sm">{t('pages.settings.users.editUserTitle')}</DialogTitle></DialogHeader>
          {editUser && (
            <div className="space-y-3">
              <div><Label className="text-xs">{t('common.username')}</Label><Input value={editUser.username} onChange={(e) => setEditUser({ ...editUser, username: e.target.value })} /></div>
              <div><Label className="text-xs">{t('pages.settings.users.colDisplayName')}</Label><Input value={editUser.displayName} onChange={(e) => setEditUser({ ...editUser, displayName: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>{t('common.cancel')}</Button>
            <Button onClick={handleSaveEdit} disabled={!editUser?.username || !editUser?.displayName || updateUser.isPending}>
              {updateUser.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {accessUserId !== null && (
        <ServerAccessDialog
          userId={accessUserId}
          username={userList.find((u: any) => u.id === accessUserId)?.username ?? ''}
          servers={serverList}
          onClose={() => setAccessUserId(null)}
        />
      )}

      {sessionsUserId !== null && (
        <SessionsDialog
          userId={sessionsUserId}
          username={userList.find((u: any) => u.id === sessionsUserId)?.username ?? ''}
          isSelf={sessionsUserId === currentUser?.id}
          onClose={() => setSessionsUserId(null)}
        />
      )}
    </div>
  );
}

function ServerAccessDialog({ userId, username, servers, onClose }: { userId: number; username: string; servers: any[]; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['user-server-access', userId], queryFn: () => usersApi.getServerAccess(userId) });
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const save = useMutation({
    mutationFn: (serverConfigIds: number[]) => usersApi.setServerAccess(userId, serverConfigIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-server-access', userId] });
      toast.success(t('pages.settings.serverAccess.updated'));
      onClose();
    },
    onError: () => toast.error(t('pages.settings.serverAccess.updateFailed')),
  });

  const active = selected ?? new Set(data?.serverConfigIds ?? []);
  const toggle = (id: number) => {
    const next = new Set(active);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('pages.settings.serverAccess.title', { username })}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <PageLoader />
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {servers.length === 0 && <p className="text-xs text-muted-foreground">{t('pages.settings.serverAccess.noConnections')}</p>}
            {servers.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-4 py-1.5">
                <div>
                  <p className="text-xs font-medium">{s.name}</p>
                  <p className="text-[11px] text-muted-foreground font-mono-data">{s.host}</p>
                </div>
                <Switch checked={active.has(s.id)} onCheckedChange={() => toggle(s.id)} />
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate(Array.from(active))}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SessionsDialog({ userId, username, isSelf, onClose }: { userId: number; username: string; isSelf: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['user-sessions', userId], queryFn: () => usersApi.getSessions(userId) });
  const sessions = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  const revokeOne = useMutation({
    mutationFn: (sessionId: number) => usersApi.revokeSession(userId, sessionId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['user-sessions', userId] }); toast.success(t('pages.settings.sessions.revoked')); },
    onError: () => toast.error(t('pages.settings.sessions.revokeFailed')),
  });

  const revokeAll = useMutation({
    mutationFn: () => usersApi.revokeAllSessions(userId),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['user-sessions', userId] });
      toast.success(t('pages.settings.sessions.revokedAllToast', { count: result.revoked }));
    },
    onError: () => toast.error(t('pages.settings.sessions.revokeAllFailed')),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('pages.settings.sessions.title', { username })}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">
          {t('pages.settings.sessions.description')}
          {isSelf && t('pages.settings.sessions.selfWarning')}
        </p>
        {isLoading ? (
          <PageLoader />
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {sessions.length === 0 && <p className="text-xs text-muted-foreground">{t('pages.settings.sessions.noActiveSessions')}</p>}
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-4 py-1.5 border-b border-border last:border-0">
                <div>
                  <p className="text-xs">{t('pages.settings.sessions.signedIn', { date: new Date(s.createdAt).toLocaleString() })}</p>
                  <p className="text-[11px] text-muted-foreground">{t('pages.settings.sessions.expires', { date: new Date(s.expiresAt).toLocaleString() })}</p>
                </div>
                <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" disabled={revokeOne.isPending} onClick={() => revokeOne.mutate(s.id)}>
                  {t('pages.settings.sessions.revoke')}
                </Button>
              </div>
            ))}
          </div>
        )}
        <DialogFooter className="sm:justify-between">
          <Button
            variant="outline"
            className="text-destructive hover:text-destructive"
            disabled={sessions.length === 0 || revokeAll.isPending}
            onClick={() => revokeAll.mutate()}
          >
            {revokeAll.isPending ? t('pages.settings.sessions.revoking') : t('pages.settings.sessions.revokeAll')}
          </Button>
          <Button onClick={onClose}>{t('common.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function YouTubeTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [pasteMode, setPasteMode] = useState(false);
  const [cookieText, setCookieText] = useState('');

  const { data: status, isLoading } = useQuery({
    queryKey: ['yt-cookie-status'],
    queryFn: settingsApi.getYtCookieStatus,
  });

  const { data: cookieCheck } = useYtCookieCheck();
  const recheckCookies = useRecheckYtCookies();

  const { data: cacheSettings, isLoading: cacheLoading } = useQuery({
    queryKey: ['music-cache-settings'],
    queryFn: settingsApi.getMusicCacheSettings,
  });

  const setCacheSettings = useMutation({
    mutationFn: (config: MusicCacheSettings) => settingsApi.setMusicCacheSettings(config),
    onSuccess: (saved) => {
      qc.setQueryData(['music-cache-settings'], saved);
      toast.success(t('pages.settings.youtube.settingSaved'));
    },
    onError: () => toast.error(t('pages.settings.youtube.settingSaveFailed')),
  });

  const uploadFile = useMutation({
    mutationFn: (file: File) => settingsApi.uploadYtCookieFile(file),
    onSuccess: (result) => {
      toast[result.valid === false ? 'error' : 'success'](
        result.valid === false ? t('pages.settings.youtube.uploadedButRejected') : t('pages.settings.youtube.cookieFileUploaded'),
      );
      qc.invalidateQueries({ queryKey: ['yt-cookie-status'] });
      qc.invalidateQueries({ queryKey: ['yt-cookie-check'] });
    },
    onError: () => toast.error(t('pages.settings.youtube.uploadFailed')),
  });

  const uploadText = useMutation({
    mutationFn: (text: string) => settingsApi.uploadYtCookieText(text),
    onSuccess: (result) => {
      toast[result.valid === false ? 'error' : 'success'](
        result.valid === false ? t('pages.settings.youtube.savedButRejected') : t('pages.settings.youtube.cookiesSaved'),
      );
      setCookieText('');
      setPasteMode(false);
      qc.invalidateQueries({ queryKey: ['yt-cookie-status'] });
      qc.invalidateQueries({ queryKey: ['yt-cookie-check'] });
    },
    onError: () => toast.error(t('pages.settings.youtube.saveCookiesFailed')),
  });

  const deleteCookies = useMutation({
    mutationFn: () => settingsApi.deleteYtCookies(),
    onSuccess: () => {
      toast.success(t('pages.settings.youtube.cookieFileRemoved'));
      qc.invalidateQueries({ queryKey: ['yt-cookie-status'] });
      qc.invalidateQueries({ queryKey: ['yt-cookie-check'] });
    },
    onError: () => toast.error(t('pages.settings.youtube.removeCookiesFailed')),
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile.mutate(file);
    e.target.value = '';
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  return (
    <div className="max-w-lg space-y-4">
      <Card className="card-hero">
        <CardHeader>
          <CardTitle className="text-sm font-medium">{t('pages.settings.youtube.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {t('pages.settings.youtube.description')}
            {' '}<span className="font-medium">{t('pages.settings.youtube.extensionName')}</span>{t('pages.settings.youtube.extensionSuffix')}
          </p>

          {/* Status */}
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                !status?.active ? 'bg-zinc-500' : cookieCheck?.valid === false ? 'bg-destructive' : cookieCheck?.valid === true ? 'bg-green-500' : 'bg-zinc-500'
              }`}
            />
            <span className="text-sm">
              {isLoading ? t('common.loading') : !status?.active
                ? t('pages.settings.youtube.noCookiesConfigured')
                : cookieCheck?.valid === false
                  ? t('pages.settings.youtube.cookiesRejected', { size: formatSize(status.size) })
                  : cookieCheck?.valid === true
                    ? t('pages.settings.youtube.cookiesWorking', { size: formatSize(status.size) })
                    : t('pages.settings.youtube.cookiesNotChecked', { size: formatSize(status.size) })}
            </span>
            {status?.active && (
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => recheckCookies.mutate()} disabled={recheckCookies.isPending}>
                {recheckCookies.isPending ? t('pages.settings.youtube.checking') : t('pages.settings.youtube.recheck')}
              </Button>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <input
              type="file"
              accept=".txt,.cookies"
              className="hidden"
              id="cookie-file-input"
              onChange={handleFileSelect}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => document.getElementById('cookie-file-input')?.click()}
              disabled={uploadFile.isPending}
            >
              <Upload className="h-3.5 w-3.5 mr-1" />
              {uploadFile.isPending ? t('pages.settings.youtube.uploading') : t('pages.settings.youtube.uploadCookiesFile')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPasteMode(!pasteMode)}
            >
              <FileText className="h-3.5 w-3.5 mr-1" />
              {t('pages.settings.youtube.pasteCookies')}
            </Button>
            {status?.active && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => deleteCookies.mutate()}
                disabled={deleteCookies.isPending}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                {t('common.remove')}
              </Button>
            )}
          </div>

          {/* Paste mode */}
          {pasteMode && (
            <div className="space-y-2">
              <textarea
                className="w-full h-32 rounded-md border border-border bg-background px-3 py-2 text-xs font-mono resize-none focus:outline-hidden focus:ring-1 focus:ring-ring"
                placeholder="# Netscape HTTP Cookie File&#10;.youtube.com&#9;TRUE&#9;/&#9;TRUE&#9;0&#9;COOKIE_NAME&#9;COOKIE_VALUE"
                value={cookieText}
                onChange={(e) => setCookieText(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => uploadText.mutate(cookieText)}
                  disabled={!cookieText.trim() || uploadText.isPending}
                >
                  {uploadText.isPending ? t('common.saving') : t('common.save')}
                </Button>
                <Button variant="outline" size="sm" onClick={() => { setPasteMode(false); setCookieText(''); }}>
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="card-hero">
        <CardHeader>
          <CardTitle className="text-sm font-medium">{t('pages.settings.youtube.playedSongStorageTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {t('pages.settings.youtube.playedSongStorageDescriptionPart1')}<code>!play</code>/<code>!queue</code>/<code>!stream</code>{t('pages.settings.youtube.playedSongStorageDescriptionPart2')}
          </p>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-xs">{t('pages.settings.youtube.keepPlayedSongsLabel')}</Label>
              <p className="text-[11px] text-muted-foreground">
                {cacheSettings?.keepPlayedSongs !== false
                  ? t('pages.settings.youtube.keepOnDescription')
                  : t('pages.settings.youtube.keepOffDescription')}
              </p>
            </div>
            <Switch
              checked={cacheSettings?.keepPlayedSongs ?? true}
              disabled={cacheLoading || setCacheSettings.isPending}
              onCheckedChange={(v) => setCacheSettings.mutate({ keepPlayedSongs: v })}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StreamingTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['stream-defaults'],
    queryFn: settingsApi.getStreamDefaults,
  });

  const [draft, setDraft] = useState<StreamDefaults | null>(null);
  const active: StreamDefaults | null =
    draft ?? (data ? { preset: data.preset, framerate: data.framerate, bitrate: data.bitrate, volume: data.volume } : null);

  const save = useMutation({
    mutationFn: (cfg: StreamDefaults) => settingsApi.setStreamDefaults(cfg),
    onSuccess: (saved) => {
      qc.setQueryData(['stream-defaults'], saved);
      setDraft(null);
      toast.success(t('pages.settings.streaming.streamDefaultsSaved'));
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || t('pages.settings.streaming.streamDefaultsSaveFailed')),
  });

  if (isLoading || !data || !active) return <PageLoader />;

  // Picking a preset carries its frame rate and bitrate along, because the
  // three belong together - a 1080p picture at a 480p bitrate is nobody's
  // intention. Both fields stay editable afterwards.
  const pickPreset = (p: StreamPreset) =>
    setDraft({ ...active, preset: p.name, framerate: p.framerate, bitrate: p.bitrate });

  const selected = data.presets.find((p) => p.name === active.preset);
  const matchesBuiltIn =
    active.preset === data.builtIn.preset &&
    active.framerate === data.builtIn.framerate &&
    active.bitrate === data.builtIn.bitrate &&
    active.volume === data.builtIn.volume;

  return (
    <div className="max-w-lg space-y-4">
      <Card className="card-hero">
        <CardHeader>
          <CardTitle className="text-sm font-medium">{t('pages.settings.streaming.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            What <code className="text-[11px]">!stream &lt;url&gt;</code> {t('pages.settings.streaming.descriptionUsage', { names: data.presets.map((p) => p.name).join(', ') })}
          </p>

          <div className="space-y-2">
            <Label className="text-xs">{t('pages.settings.streaming.resolutionLabel')}</Label>
            <div className="flex gap-2">
              {data.presets.map((p) => (
                <Button
                  key={p.name}
                  variant={active.preset === p.name ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => pickPreset(p)}
                >
                  {p.name}
                </Button>
              ))}
            </div>
            {selected && (
              <p className="text-[11px] text-muted-foreground">
                {t('pages.settings.streaming.pixelsSuffix', { width: selected.width, height: selected.height })}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs" htmlFor="stream-framerate">{t('pages.settings.streaming.frameRateLabel')}</Label>
              <Input
                id="stream-framerate"
                type="number"
                min={1}
                max={120}
                value={active.framerate}
                onChange={(e) => setDraft({ ...active, framerate: Number(e.target.value) })}
              />
              <p className="text-[11px] text-muted-foreground">{t('pages.settings.streaming.frameRateHint')}</p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs" htmlFor="stream-bitrate">{t('pages.settings.streaming.bitrateLabel')}</Label>
              <Input
                id="stream-bitrate"
                value={active.bitrate}
                onChange={(e) => setDraft({ ...active, bitrate: e.target.value })}
                placeholder={data.builtIn.bitrate}
              />
              <p className="text-[11px] text-muted-foreground">
                {t('pages.settings.streaming.bitrateHintPrefix')} <code className="text-[11px]">6000k</code>.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs" htmlFor="stream-volume">{t('pages.settings.streaming.volumeLabel')}</Label>
            <Input
              id="stream-volume"
              type="number"
              min={0}
              max={100}
              className="max-w-[8rem]"
              value={active.volume}
              onChange={(e) => setDraft({ ...active, volume: Number(e.target.value) })}
            />
            <p className="text-[11px] text-muted-foreground">
              {t('pages.settings.streaming.volumeHint')}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => save.mutate(active)} disabled={save.isPending || !draft}>
              {t('common.save')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDraft({ ...data.builtIn })}
              disabled={matchesBuiltIn}
            >
              {t('pages.settings.streaming.restoreShippedValues')}
            </Button>
            {draft && <span className="text-[11px] text-muted-foreground">{t('pages.settings.streaming.unsavedChanges')}</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DebugTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [confirmReset, setConfirmReset] = useState<'radio' | 'bots' | null>(null);

  const { data: flags, isLoading } = useQuery({
    queryKey: ['debug-flags'],
    queryFn: settingsApi.getDebugFlags,
  });

  const setFlag = useMutation({
    mutationFn: ({ name, enabled }: { name: 'voice' | 'rankCheck' | 'query'; enabled: boolean }) =>
      settingsApi.setDebugFlag(name, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['debug-flags'] }),
    onError: () => toast.error(t('pages.settings.debug.debugFlagUpdateFailed')),
  });

  const resetRadioIds = useMutation({
    mutationFn: settingsApi.resetRadioStationIds,
    onSuccess: ({ deletedCount }) => {
      qc.invalidateQueries({ queryKey: ['radio-stations'] });
      toast.success(t('pages.settings.debug.radioIdsResetToast', { count: deletedCount }));
      setConfirmReset(null);
    },
    onError: () => toast.error(t('pages.settings.debug.radioIdsResetFailed')),
  });

  const resetBotIds = useMutation({
    mutationFn: settingsApi.resetMusicBotIds,
    onSuccess: ({ deletedCount }) => {
      qc.invalidateQueries({ queryKey: ['music-bots'] });
      toast.success(t('pages.settings.debug.botIdsResetToast', { count: deletedCount }));
      setConfirmReset(null);
    },
    onError: () => toast.error(t('pages.settings.debug.botIdsResetFailed')),
  });

  if (isLoading) return <PageLoader />;

  return (
    <div className="max-w-lg space-y-4">
      <Card className="card-hero">
        <CardHeader>
          <CardTitle className="text-sm font-medium">{t('pages.settings.debug.loggingTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {t('pages.settings.debug.loggingDescription')}
          </p>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-xs">{t('pages.settings.debug.voiceBotDebugLabel')}</Label>
              <p className="text-[11px] text-muted-foreground">{t('pages.settings.debug.voiceBotDebugHint')}</p>
            </div>
            <Switch
              checked={!!flags?.voice}
              onCheckedChange={(v) => setFlag.mutate({ name: 'voice', enabled: v })}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-xs">{t('pages.settings.debug.rankCheckDebugLabel')}</Label>
              <p className="text-[11px] text-muted-foreground">{t('pages.settings.debug.rankCheckDebugHint')}</p>
            </div>
            <Switch
              checked={!!flags?.rankCheck}
              onCheckedChange={(v) => setFlag.mutate({ name: 'rankCheck', enabled: v })}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-xs">{t('pages.settings.debug.serverQueryDebugLabel')}</Label>
              <p className="text-[11px] text-muted-foreground">{t('pages.settings.debug.serverQueryDebugHint')}</p>
            </div>
            <Switch
              checked={!!flags?.query}
              onCheckedChange={(v) => setFlag.mutate({ name: 'query', enabled: v })}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="card-hero border-destructive/50">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-destructive flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4" /> {t('pages.settings.debug.dangerZone')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {t('pages.settings.debug.idResetHint')}
          </p>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-xs">{t('pages.settings.debug.resetRadioIdsLabel')}</Label>
              <p className="text-[11px] text-muted-foreground">{t('pages.settings.debug.resetRadioIdsHint')}</p>
            </div>
            <Button variant="destructive" size="sm" onClick={() => setConfirmReset('radio')}>
              {t('pages.settings.debug.reset')}
            </Button>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-xs">{t('pages.settings.debug.resetBotIdsLabel')}</Label>
              <p className="text-[11px] text-muted-foreground">{t('pages.settings.debug.resetBotIdsHint')}</p>
            </div>
            <Button variant="destructive" size="sm" onClick={() => setConfirmReset('bots')}>
              {t('pages.settings.debug.reset')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmReset !== null}
        onOpenChange={(open) => !open && setConfirmReset(null)}
        title={confirmReset === 'radio' ? t('pages.settings.debug.resetRadioTitle') : t('pages.settings.debug.resetBotsTitle')}
        description={
          confirmReset === 'radio'
            ? t('pages.settings.debug.resetRadioDescription')
            : t('pages.settings.debug.resetBotsDescription')
        }
        onConfirm={() => {
          if (confirmReset === 'radio') resetRadioIds.mutate();
          else if (confirmReset === 'bots') resetBotIds.mutate();
        }}
        destructive
      />
    </div>
  );
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function RestartTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: config, isLoading } = useQuery({
    queryKey: ['scheduled-restart'],
    queryFn: settingsApi.getScheduledRestart,
  });

  const [draft, setDraft] = useState<ScheduledRestartConfig | null>(null);
  const active = draft ?? config ?? null;

  const save = useMutation({
    mutationFn: (cfg: ScheduledRestartConfig) => settingsApi.setScheduledRestart(cfg),
    onSuccess: (saved) => {
      qc.setQueryData(['scheduled-restart'], saved);
      setDraft(null);
      toast.success(t('pages.settings.restart.restartScheduleSaved'));
    },
    onError: () => toast.error(t('pages.settings.restart.restartScheduleSaveFailed')),
  });

  if (isLoading || !active) return <PageLoader />;

  const update = (patch: Partial<ScheduledRestartConfig>) => setDraft({ ...active, ...patch });
  const toggleDay = (day: number) => {
    const days = active.days.includes(day)
      ? active.days.filter((d) => d !== day)
      : [...active.days, day].sort((a, b) => a - b);
    update({ days });
  };

  return (
    <div className="max-w-lg space-y-4">
      <Card className="card-hero">
        <CardHeader>
          <CardTitle className="text-sm font-medium">{t('pages.settings.restart.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {t('pages.settings.restart.descriptionPart1')} <strong>{t('pages.settings.restart.notEmphasis')}</strong> {t('pages.settings.restart.descriptionPart2')}
          </p>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-xs">{t('pages.settings.restart.restartBackendLabel')}</Label>
              <p className="text-[11px] text-muted-foreground">{t('pages.settings.restart.restartBackendHint')}</p>
            </div>
            <Switch checked={active.backendEnabled} onCheckedChange={(v) => update({ backendEnabled: v })} />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-xs">{t('pages.settings.restart.restartSidecarLabel')}</Label>
              <p className="text-[11px] text-muted-foreground">{t('pages.settings.restart.restartSidecarHint')}</p>
            </div>
            <Switch checked={active.sidecarEnabled} onCheckedChange={(v) => update({ sidecarEnabled: v })} />
          </div>

          <div>
            <Label className="text-xs">{t('pages.settings.restart.timeLabel')}</Label>
            <Input
              type="time"
              className="h-8 mt-1 w-32 font-mono-data text-xs"
              value={active.time}
              onChange={(e) => update({ time: e.target.value })}
            />
          </div>

          <div>
            <Label className="text-xs">{t('pages.settings.restart.daysLabel')}</Label>
            <div className="flex gap-1 mt-1">
              {DAY_KEYS.map((key, i) => (
                <Button
                  key={i}
                  type="button"
                  variant={active.days.includes(i) ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 w-11 px-0 text-xs"
                  onClick={() => toggleDay(i)}
                >
                  {t(`pages.settings.restart.days.${key}`)}
                </Button>
              ))}
            </div>
          </div>

          <Button
            size="sm"
            disabled={!draft || save.isPending}
            onClick={() => draft && save.mutate(draft)}
          >
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function SsoTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: oidc, isLoading } = useQuery({ queryKey: ['oidc-settings'], queryFn: settingsApi.getOidc });
  const [draft, setDraft] = useState<OidcSettingsInput | null>(null);

  const save = useMutation({
    mutationFn: (cfg: OidcSettingsInput) => settingsApi.setOidc(cfg),
    onSuccess: (saved) => {
      qc.setQueryData(['oidc-settings'], saved);
      setDraft(null);
      toast.success(t('pages.settings.sso.ssoSettingsSaved'));
    },
    onError: () => toast.error(t('pages.settings.sso.ssoSettingsSaveFailed')),
  });

  if (isLoading || !oidc) return <PageLoader />;

  const active: OidcSettingsInput = draft ?? { ...oidc, clientSecret: '' };
  const update = (patch: Partial<OidcSettingsInput>) => setDraft({ ...active, ...patch });

  return (
    <div className="max-w-lg space-y-4">
      <Card className="card-hero">
        <CardHeader>
          <CardTitle className="text-sm font-medium">{t('pages.settings.sso.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {t('pages.settings.sso.descriptionPart1')} <strong>{t('pages.settings.sso.viewerEmphasis')}</strong> {t('pages.settings.sso.descriptionPart2')}
          </p>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-xs">{t('common.enabled')}</Label>
              <p className="text-[11px] text-muted-foreground">{t('pages.settings.sso.enabledHint')}</p>
            </div>
            <Switch checked={active.enabled} onCheckedChange={(v) => update({ enabled: v })} />
          </div>

          <div>
            <Label className="text-xs">{t('pages.settings.sso.issuerUrlLabel')}</Label>
            <Input
              className="h-8 mt-1 font-mono-data text-xs"
              placeholder="https://auth.example.com/application/o/ts6-manager/"
              value={active.issuer}
              onChange={(e) => update({ issuer: e.target.value })}
            />
            <p className="text-[11px] text-muted-foreground mt-1">{t('pages.settings.sso.issuerUrlHint')} <code>{'{issuer}'}/.well-known/openid-configuration</code>.</p>
          </div>

          <div>
            <Label className="text-xs">{t('pages.settings.sso.clientIdLabel')}</Label>
            <Input className="h-8 mt-1 font-mono-data text-xs" value={active.clientId} onChange={(e) => update({ clientId: e.target.value })} />
          </div>

          <div>
            <Label className="text-xs">{t('pages.settings.sso.clientSecretLabel')}</Label>
            <Input
              type="password"
              className="h-8 mt-1 font-mono-data text-xs"
              placeholder={oidc.hasClientSecret ? t('pages.settings.sso.clientSecretPlaceholderExisting') : t('pages.settings.sso.clientSecretPlaceholder')}
              value={active.clientSecret}
              onChange={(e) => update({ clientSecret: e.target.value })}
            />
          </div>

          <div>
            <Label className="text-xs">{t('pages.settings.sso.buttonLabelLabel')}</Label>
            <Input className="h-8 mt-1 text-xs" value={active.buttonLabel} onChange={(e) => update({ buttonLabel: e.target.value })} />
          </div>

          <div className="rounded-md border border-border bg-muted/30 p-2.5">
            <p className="text-[11px] text-muted-foreground">{t('pages.settings.sso.redirectUriHint')}</p>
            <p className="text-[11px] font-mono-data mt-0.5 break-all">{window.location.origin}/api/auth/oidc/callback</p>
          </div>

          <Button size="sm" disabled={!draft || save.isPending} onClick={() => draft && save.mutate(draft)}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function UpdateStatusTab() {
  const { t } = useTranslation();
  const { data, isLoading } = useUpdateCheck();
  const recheck = useRecheckUpdate();

  const qc = useQueryClient();
  const { data: githubToken } = useQuery({ queryKey: ['github-token'], queryFn: settingsApi.getGithubToken });
  const [tokenDraft, setTokenDraft] = useState('');

  const saveToken = useMutation({
    mutationFn: (token: string) => settingsApi.setGithubToken(token),
    onSuccess: (saved) => {
      qc.setQueryData(['github-token'], saved);
      setTokenDraft('');
      toast.success(t('pages.settings.updateStatus.tokenSaved'));
    },
    onError: () => toast.error(t('pages.settings.updateStatus.tokenSaveFailed')),
  });

  const removeToken = useMutation({
    mutationFn: () => settingsApi.deleteGithubToken(),
    onSuccess: (saved) => {
      qc.setQueryData(['github-token'], saved);
      toast.success(t('pages.settings.updateStatus.tokenRemoved'));
    },
    onError: () => toast.error(t('pages.settings.updateStatus.tokenRemoveFailed')),
  });

  if (isLoading || !data) return <PageLoader />;

  const frontendUpdateAvailable = !!(data.frontendLatest && compareVersions(data.frontendLatest, __APP_VERSION__) > 0);

  const rows = [
    { label: t('pages.settings.updateStatus.backend'), current: data.backend.current, latest: data.backend.latest, updateAvailable: data.backend.updateAvailable },
    { label: t('pages.settings.updateStatus.sidecar'), current: data.sidecar.current, latest: data.sidecar.latest, updateAvailable: data.sidecar.updateAvailable },
    { label: t('pages.settings.updateStatus.frontend'), current: __APP_VERSION__ as string | null, latest: data.frontendLatest, updateAvailable: frontendUpdateAvailable },
  ];

  return (
    <div className="max-w-lg space-y-4">
      <Card className="card-hero">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm font-medium">{t('pages.settings.updateStatus.title')}</CardTitle>
          <Button
            size="sm"
            variant="outline"
            disabled={recheck.isPending}
            onClick={() => {
              toast.promise(recheck.mutateAsync(), {
                loading: t('pages.settings.updateStatus.checkingForUpdates'),
                success: (result) => {
                  const frontendBehind = !!(result.frontendLatest && compareVersions(result.frontendLatest, __APP_VERSION__) > 0);
                  return result.backend.updateAvailable || result.sidecar.updateAvailable || frontendBehind
                    ? t('pages.settings.updateStatus.updateAvailable')
                    : t('pages.settings.updateStatus.allUpToDate');
                },
                error: t('pages.settings.updateStatus.checkFailed'),
              });
            }}
          >
            <RefreshCw className={cn('h-3.5 w-3.5 mr-1', recheck.isPending && 'animate-spin')} />
            {t('pages.settings.updateStatus.recheckNow')}
          </Button>
        </CardHeader>
        <CardContent className="space-y-1">
          <p className="text-xs text-muted-foreground mb-3">
            {t('pages.settings.updateStatus.comparisonHintPrefix')} <code className="font-mono-data">main</code> {t('pages.settings.updateStatus.comparisonHintSuffix')}
          </p>

          {rows.map((row) => {
            const known = row.current !== null && row.latest !== null;
            return (
              <div key={row.label} className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-0">
                <span className="text-xs font-medium w-16 shrink-0">{row.label}</span>
                <div className="flex items-center gap-4 flex-1">
                  <div>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{t('pages.settings.updateStatus.installed')}</p>
                    <p className="font-mono-data text-xs">{row.current ?? t('pages.settings.updateStatus.unreachable')}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{t('pages.settings.updateStatus.latestMain')}</p>
                    <p className={cn('font-mono-data text-xs', row.updateAvailable && 'text-primary')}>{row.latest ?? t('pages.settings.updateStatus.unknown')}</p>
                  </div>
                </div>
                <Badge
                  variant={!known ? 'secondary' : row.updateAvailable ? 'default' : 'outline'}
                  className="text-[10px] shrink-0"
                >
                  {!known ? t('pages.settings.updateStatus.unknown') : row.updateAvailable ? t('pages.settings.updateStatus.updateAvailableBadge') : t('pages.settings.updateStatus.upToDate')}
                </Badge>
              </div>
            );
          })}

          <p className="text-[11px] text-muted-foreground pt-3">
            {data.checkedAt ? t('pages.settings.updateStatus.lastChecked', { date: new Date(data.checkedAt).toLocaleString() }) : t('pages.settings.updateStatus.notCheckedYet')}
          </p>
        </CardContent>
      </Card>

      <Card className="card-hero">
        <CardHeader>
          <CardTitle className="text-sm font-medium">{t('pages.settings.updateStatus.githubTokenTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {t('pages.settings.updateStatus.githubTokenDescriptionPrefix')} <a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noreferrer" className="underline">{t('pages.settings.updateStatus.githubTokenLinkText')}</a> {t('pages.settings.updateStatus.githubTokenDescriptionSuffix')}
          </p>

          <div>
            <Label className="text-xs">{t('pages.settings.updateStatus.tokenLabel')}</Label>
            <Input
              type="password"
              className="h-8 mt-1 font-mono-data text-xs"
              placeholder={githubToken?.hasToken ? t('pages.settings.updateStatus.tokenConfiguredPlaceholder') : t('pages.settings.updateStatus.tokenPlaceholder')}
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={!tokenDraft.trim() || saveToken.isPending}
              onClick={() => saveToken.mutate(tokenDraft.trim())}
            >
              {saveToken.isPending ? t('common.saving') : t('common.save')}
            </Button>
            {githubToken?.hasToken && (
              <Button
                size="sm"
                variant="outline"
                disabled={removeToken.isPending}
                onClick={() => removeToken.mutate()}
              >
                {removeToken.isPending ? t('pages.settings.updateStatus.removing') : t('common.remove')}
              </Button>
            )}
            <span className="text-[11px] text-muted-foreground">
              {githubToken?.hasToken ? t('pages.settings.updateStatus.tokenConfiguredHint') : t('pages.settings.updateStatus.noTokenConfiguredHint')}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
