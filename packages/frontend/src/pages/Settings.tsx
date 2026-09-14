import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '@/api/bots.api';
import { authApi } from '@/api/auth.api';
import { serversApi } from '@/api/servers.api';
import { settingsApi, type ScheduledRestartConfig, type OidcSettings, type OidcSettingsInput, type MusicCacheSettings } from '@/api/settings.api';
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
import { Settings as SettingsIcon, Users, Server, Plus, Trash2, Pencil, TestTube, Check, X, Lock, KeyRound, Film, Upload, FileText, Bug, AlertTriangle, Timer, RefreshCw, ShieldCheck, Search, Monitor } from 'lucide-react';
import { toast } from 'sonner';
import { compareVersions } from '@ts6/common';
import { useUpdateCheck, useRecheckUpdate } from '@/hooks/use-update-check';
import { useYtCookieCheck, useRecheckYtCookies } from '@/hooks/use-yt-cookie-check';
import { cn } from '@/lib/utils';

export default function Settings() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Settings</h1>

      <Tabs defaultValue="account">
        <TabsList>
          {isAdmin && <TabsTrigger value="connections"><Server className="h-3.5 w-3.5 mr-1" /> Connections</TabsTrigger>}
          <TabsTrigger value="account"><Lock className="h-3.5 w-3.5 mr-1" /> Account</TabsTrigger>
          {isAdmin && <TabsTrigger value="users"><Users className="h-3.5 w-3.5 mr-1" /> Users</TabsTrigger>}
          {isAdmin && <TabsTrigger value="youtube"><Film className="h-3.5 w-3.5 mr-1" /> YouTube</TabsTrigger>}
          {isAdmin && <TabsTrigger value="debug"><Bug className="h-3.5 w-3.5 mr-1" /> Debug</TabsTrigger>}
          {isAdmin && <TabsTrigger value="restart"><Timer className="h-3.5 w-3.5 mr-1" /> Restart</TabsTrigger>}
          {isAdmin && <TabsTrigger value="sso"><ShieldCheck className="h-3.5 w-3.5 mr-1" /> SSO</TabsTrigger>}
          {isAdmin && <TabsTrigger value="update-status"><RefreshCw className="h-3.5 w-3.5 mr-1" /> Update Status</TabsTrigger>}
        </TabsList>

        {isAdmin && (
          <TabsContent value="connections" className="mt-4">
            <ConnectionsTab />
          </TabsContent>
        )}

        <TabsContent value="account" className="mt-4">
          <AccountTab />
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
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const changePassword = useMutation({
    mutationFn: () => authApi.changePassword(currentPassword, newPassword),
  });

  const handleSubmit = () => {
    if (newPassword.length < 6) {
      toast.error('New password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    changePassword.mutate(undefined, {
      onSuccess: () => {
        toast.success('Password changed successfully');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      },
      onError: (err: any) => {
        const msg = err?.response?.data?.error || 'Failed to change password';
        toast.error(msg);
      },
    });
  };

  return (
    <div className="max-w-md">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Change Password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">Current Password</Label>
            <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Enter current password" />
          </div>
          <div>
            <Label className="text-xs">New Password</Label>
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Min. 6 characters" />
          </div>
          <div>
            <Label className="text-xs">Confirm New Password</Label>
            <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Repeat new password" />
          </div>
          <Button
            onClick={handleSubmit}
            disabled={!currentPassword || !newPassword || !confirmPassword || changePassword.isPending}
            className="w-full mt-1"
          >
            {changePassword.isPending ? 'Changing...' : 'Change Password'}
          </Button>
        </CardContent>
      </Card>

      <TwoFactorCard />
    </div>
  );
}

function TwoFactorCard() {
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
    onError: () => toast.error('Failed to start 2FA setup'),
  });

  const verifySetup = useMutation({
    mutationFn: () => authApi.totpVerifySetup(confirmCode),
    onSuccess: (data) => {
      updateUser({ totpEnabled: true });
      setRecoveryCodes(data.recoveryCodes);
      setStep('codes');
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Invalid code'),
  });

  const disable = useMutation({
    mutationFn: () => authApi.totpDisable(disablePassword),
    onSuccess: () => {
      updateUser({ totpEnabled: false });
      toast.success('2FA disabled');
      setShowDisable(false);
      setDisablePassword('');
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Failed to disable 2FA'),
  });

  const closeSetup = () => {
    setStep('idle');
    setQrData(null);
    setConfirmCode('');
    setRecoveryCodes(null);
  };

  return (
    <>
      <Card className="mt-4">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm font-medium">Two-Factor Authentication</CardTitle>
          <Badge variant={user?.totpEnabled ? 'default' : 'secondary'} className="text-[10px]">
            {user?.totpEnabled ? 'Enabled' : 'Disabled'}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Adds a one-time code from an authenticator app (Google Authenticator, Authy, ...) on top of your password.
          </p>
          {user?.totpEnabled ? (
            <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setShowDisable(true)}>
              Disable 2FA
            </Button>
          ) : (
            <Button onClick={() => setup.mutate()} disabled={setup.isPending}>
              {setup.isPending ? 'Starting...' : 'Enable 2FA'}
            </Button>
          )}
        </CardContent>
      </Card>

      <Dialog open={step !== 'idle'} onOpenChange={(v) => { if (!v) closeSetup(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle className="text-sm">Set Up Two-Factor Authentication</DialogTitle></DialogHeader>

          {step === 'setup' && qrData && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Scan this with your authenticator app, then enter the 6-digit code it shows to confirm.
              </p>
              <img src={qrData.qrCodeDataUrl} alt="2FA QR code" className="mx-auto rounded-md border border-border bg-white p-2" />
              <p className="text-[11px] text-muted-foreground text-center break-all">
                Can't scan? Enter manually: <span className="font-mono-data">{qrData.secret}</span>
              </p>
              <div>
                <Label className="text-xs">Confirmation Code</Label>
                <Input value={confirmCode} onChange={(e) => setConfirmCode(e.target.value)} placeholder="123456" autoFocus />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeSetup}>Cancel</Button>
                <Button onClick={() => verifySetup.mutate()} disabled={!confirmCode || verifySetup.isPending}>
                  {verifySetup.isPending ? 'Verifying...' : 'Verify & Enable'}
                </Button>
              </DialogFooter>
            </div>
          )}

          {step === 'codes' && recoveryCodes && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Save these recovery codes somewhere safe. Each one can be used once to log in if you lose access to your authenticator app - they won't be shown again.
              </p>
              <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/30 p-3 font-mono-data text-xs">
                {recoveryCodes.map((c) => <span key={c}>{c}</span>)}
              </div>
              <DialogFooter>
                <Button onClick={() => { toast.success('2FA enabled'); closeSetup(); }}>I've saved these codes</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showDisable} onOpenChange={setShowDisable}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-sm">Disable Two-Factor Authentication</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Enter your current password to confirm.</p>
            <Input type="password" value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} placeholder="Current password" autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDisable(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => disable.mutate()} disabled={!disablePassword || disable.isPending}>
              {disable.isPending ? 'Disabling...' : 'Disable'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ConnectionsTab() {
  const qc = useQueryClient();
  const { data: servers, isLoading } = useQuery({ queryKey: ['servers'], queryFn: serversApi.list });
  const createServer = useMutation({ mutationFn: (data: any) => serversApi.create(data), onSuccess: () => qc.invalidateQueries({ queryKey: ['servers'] }) });
  const updateServer = useMutation({ mutationFn: ({ id, data }: any) => serversApi.update(id, data), onSuccess: () => qc.invalidateQueries({ queryKey: ['servers'] }) });
  const deleteServer = useMutation({ mutationFn: (id: number) => serversApi.delete(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['servers'] }) });
  const testServer = useMutation({ mutationFn: (id: number) => serversApi.test(id) });

  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: '', host: '', webqueryPort: '10080', apiKey: '', useHttps: false, sshPort: '10022', sshUsername: '', sshPassword: '' });

  const serverList = useMemo(() => (Array.isArray(servers) ? servers : []), [servers]);

  if (isLoading) return <PageLoader />;

  const resetForm = () => setForm({ name: '', host: '', webqueryPort: '10080', apiKey: '', useHttps: false, sshPort: '10022', sshUsername: '', sshPassword: '' });

  const handleSave = () => {
    const payload = { ...form, webqueryPort: parseInt(form.webqueryPort), sshPort: parseInt(form.sshPort) };
    if (editId) {
      updateServer.mutate({ id: editId, data: payload }, {
        onSuccess: () => { toast.success('Connection updated'); setEditId(null); setShowAdd(false); resetForm(); },
        onError: () => toast.error('Failed to update'),
      });
    } else {
      createServer.mutate(payload, {
        onSuccess: () => { toast.success('Connection added'); setShowAdd(false); resetForm(); },
        onError: () => toast.error('Failed to create'),
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
    });
    setEditId(server.id);
    setShowAdd(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Manage TeamSpeak server connections</p>
        <Button size="sm" onClick={() => { resetForm(); setEditId(null); setShowAdd(true); }}><Plus className="h-4 w-4 mr-1" /> Add Connection</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {serverList.map((server: any) => (
          <Card key={server.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">{server.name}</CardTitle>
                <Badge variant={server.enabled ? 'default' : 'secondary'} className="text-[10px]">
                  {server.enabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <span className="text-muted-foreground">Host</span>
                <span className="font-mono-data">{server.host}:{server.webqueryPort}</span>
                <span className="text-muted-foreground">Protocol</span>
                <span>{server.useHttps ? 'HTTPS' : 'HTTP'}</span>
                <span className="text-muted-foreground">SSH</span>
                <span className="font-mono-data">{server.sshPort || '-'}</span>
              </div>
              <div className="flex items-center gap-1 pt-2">
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => testServer.mutate(server.id, {
                  onSuccess: (data: any) => data?.success ? toast.success('Connection successful') : toast.error(data?.error ? `Connection failed: ${data.error}` : 'Connection failed'),
                  onError: () => toast.error('Connection failed'),
                })}>
                  <TestTube className="h-3 w-3 mr-1" /> Test
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openEdit(server)}>
                  <Pencil className="h-3 w-3 mr-1" /> Edit
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
          <DialogHeader><DialogTitle>{editId ? 'Edit Connection' : 'Add Connection'}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="My TS Server" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Host</Label><Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="127.0.0.1" /></div>
              <div><Label className="text-xs">WebQuery Port</Label><Input type="number" value={form.webqueryPort} onChange={(e) => setForm({ ...form, webqueryPort: e.target.value })} /></div>
            </div>
            <div>
              <Label className="text-xs">API Key</Label>
              <Input value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder={editId ? '(unchanged — enter new key to update)' : 'WebQuery API Key'} type="password" />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.useHttps} onCheckedChange={(v) => setForm({ ...form, useHttps: v })} />
              <Label className="text-xs">Use HTTPS</Label>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label className="text-xs">SSH Port</Label><Input type="number" value={form.sshPort} onChange={(e) => setForm({ ...form, sshPort: e.target.value })} /></div>
              <div><Label className="text-xs">SSH User</Label><Input value={form.sshUsername} onChange={(e) => setForm({ ...form, sshUsername: e.target.value })} placeholder="serveradmin" /></div>
              <div><Label className="text-xs">SSH Password</Label><Input type="password" value={form.sshPassword} onChange={(e) => setForm({ ...form, sshPassword: e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAdd(false); setEditId(null); resetForm(); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.name || !form.host || (!editId && !form.apiKey)}>{editId ? 'Update' : 'Add'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={() => setDeleteId(null)}
        title="Delete Connection?"
        description="This will remove the server connection. Bots linked to this server will stop working."
        onConfirm={() => { if (deleteId) deleteServer.mutate(deleteId, { onSuccess: () => { toast.success('Connection deleted'); setDeleteId(null); } }); }}
        destructive
      />
    </div>
  );
}

function UsersTab() {
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
      onSuccess: () => { toast.success('User created'); setShowAdd(false); setForm({ username: '', password: '', displayName: '', role: 'viewer' }); },
      onError: (err) => toast.error(apiErrorMessage(err, 'Failed to create user')),
    });
  };

  const handleRoleChange = (userId: number, role: string) => {
    updateUser.mutate({ id: userId, data: { role } }, {
      onSuccess: () => toast.success('Role updated'),
      onError: (err) => toast.error(apiErrorMessage(err, 'Failed to update role')),
    });
  };

  const handleToggleEnabled = (userId: number, enabled: boolean) => {
    updateUser.mutate({ id: userId, data: { enabled } }, {
      onSuccess: () => toast.success(enabled ? 'User enabled' : 'User disabled'),
      onError: (err) => toast.error(apiErrorMessage(err, 'Failed to update status')),
    });
  };

  const handleResetPassword = () => {
    if (!resetPwUserId || resetPwValue.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    updateUser.mutate({ id: resetPwUserId, data: { password: resetPwValue } }, {
      onSuccess: () => { toast.success('Password reset successfully'); setResetPwUserId(null); setResetPwValue(''); },
      onError: (err) => toast.error(apiErrorMessage(err, 'Failed to reset password')),
    });
  };

  const handleSaveEdit = () => {
    if (!editUser) return;
    updateUser.mutate({ id: editUser.id, data: { username: editUser.username, displayName: editUser.displayName } }, {
      onSuccess: () => { toast.success('User updated'); setEditUser(null); },
      onError: (err) => toast.error(apiErrorMessage(err, 'Failed to update user')),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground shrink-0">Manage webapp users and roles</p>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users..." className="h-8 w-48 pl-7 text-xs" />
          </div>
          <Button size="sm" onClick={() => setShowAdd(true)}><Plus className="h-4 w-4 mr-1" /> Add User</Button>
        </div>
      </div>

      <div className="rounded-md border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="h-10 px-3 text-left font-medium text-muted-foreground">Username</th>
              <th className="h-10 px-3 text-left font-medium text-muted-foreground">Display Name</th>
              <th className="h-10 px-3 text-left font-medium text-muted-foreground">Role</th>
              <th className="h-10 px-3 text-left font-medium text-muted-foreground">Status</th>
              <th className="h-10 px-3 text-left font-medium text-muted-foreground">Last Login</th>
              <th className="h-10 px-3 text-right font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredList.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-muted-foreground">No users match "{search}"</td></tr>
            )}
            {filteredList.map((u: any) => {
              const isSelf = u.id === currentUser?.id;
              return (
                <tr key={u.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-2.5 font-mono-data text-xs">
                    <div className="flex items-center gap-1.5">
                      {u.username}
                      {u.authProvider === 'oidc' && <Badge variant="outline" className="text-[9px]">SSO</Badge>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">{u.displayName}</td>
                  <td className="px-3 py-2.5">
                    <Select value={u.role} onValueChange={(v) => handleRoleChange(u.id, v)} disabled={isSelf}>
                      <SelectTrigger className="h-7 w-[130px] text-xs" title={isSelf ? "You can't change your own role" : undefined}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                        <SelectItem value="bot-operator">Bot Operator</SelectItem>
                        <SelectItem value="music-operator">Music Operator</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-3 py-2.5">
                    <Switch
                      checked={u.enabled}
                      onCheckedChange={(v) => handleToggleEnabled(u.id, v)}
                      disabled={isSelf}
                      title={isSelf ? "You can't disable your own account" : undefined}
                    />
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="inline-flex items-center gap-0.5">
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit" onClick={() => setEditUser({ id: u.id, username: u.username, displayName: u.displayName })}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {u.role !== 'admin' && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Server Access" onClick={() => setAccessUserId(u.id)}>
                          <Server className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Sessions" onClick={() => setSessionsUserId(u.id)}>
                        <Monitor className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Reset Password" onClick={() => { setResetPwUserId(u.id); setResetPwValue(''); }}>
                        <KeyRound className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => setDeleteId(u.id)} disabled={isSelf} title={isSelf ? "You can't delete your own account" : undefined}>
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
          <DialogHeader><DialogTitle>Add User</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Username</Label><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="johndoe" /></div>
            <div><Label className="text-xs">Display Name</Label><Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="John Doe" /></div>
            <div><Label className="text-xs">Password</Label><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="********" /></div>
            <div>
              <Label className="text-xs">Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                  <SelectItem value="bot-operator">Bot Operator</SelectItem>
                  <SelectItem value="music-operator">Music Operator</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!form.username || !form.password}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={resetPwUserId !== null} onOpenChange={(v) => { if (!v) { setResetPwUserId(null); setResetPwValue(''); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Reset Password</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Set a new password for <span className="font-medium text-foreground">{userList.find((u: any) => u.id === resetPwUserId)?.username}</span>
            </p>
            <div>
              <Label className="text-xs">New Password</Label>
              <Input type="password" value={resetPwValue} onChange={(e) => setResetPwValue(e.target.value)} placeholder="Min. 6 characters" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setResetPwUserId(null); setResetPwValue(''); }}>Cancel</Button>
            <Button onClick={handleResetPassword} disabled={resetPwValue.length < 6 || updateUser.isPending}>
              {updateUser.isPending ? 'Resetting...' : 'Reset Password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={() => setDeleteId(null)}
        title="Delete User?"
        description="This user will be permanently deleted."
        onConfirm={() => {
          if (!deleteId) return;
          deleteUser.mutate(deleteId, {
            onSuccess: () => { toast.success('User deleted'); setDeleteId(null); },
            onError: (err) => { toast.error(apiErrorMessage(err, 'Failed to delete user')); setDeleteId(null); },
          });
        }}
        destructive
      />

      {/* Edit User Dialog */}
      <Dialog open={editUser !== null} onOpenChange={(v) => { if (!v) setEditUser(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle className="text-sm">Edit User</DialogTitle></DialogHeader>
          {editUser && (
            <div className="space-y-3">
              <div><Label className="text-xs">Username</Label><Input value={editUser.username} onChange={(e) => setEditUser({ ...editUser, username: e.target.value })} /></div>
              <div><Label className="text-xs">Display Name</Label><Input value={editUser.displayName} onChange={(e) => setEditUser({ ...editUser, displayName: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={!editUser?.username || !editUser?.displayName || updateUser.isPending}>
              {updateUser.isPending ? 'Saving...' : 'Save'}
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
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['user-server-access', userId], queryFn: () => usersApi.getServerAccess(userId) });
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const save = useMutation({
    mutationFn: (serverConfigIds: number[]) => usersApi.setServerAccess(userId, serverConfigIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-server-access', userId] });
      toast.success('Server access updated');
      onClose();
    },
    onError: () => toast.error('Failed to update server access'),
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
          <DialogTitle>Server Access — {username}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <PageLoader />
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {servers.length === 0 && <p className="text-xs text-muted-foreground">No server connections configured yet.</p>}
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
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate(Array.from(active))}>
            {save.isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SessionsDialog({ userId, username, isSelf, onClose }: { userId: number; username: string; isSelf: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['user-sessions', userId], queryFn: () => usersApi.getSessions(userId) });
  const sessions = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  const revokeOne = useMutation({
    mutationFn: (sessionId: number) => usersApi.revokeSession(userId, sessionId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['user-sessions', userId] }); toast.success('Session revoked'); },
    onError: () => toast.error('Failed to revoke session'),
  });

  const revokeAll = useMutation({
    mutationFn: () => usersApi.revokeAllSessions(userId),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['user-sessions', userId] });
      toast.success(`Revoked ${result.revoked} session(s)`);
    },
    onError: () => toast.error('Failed to revoke sessions'),
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sessions — {username}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">
          One entry per logged-in device/browser. Revoking a session forces that device to log in again.
          {isSelf && ' Revoking your own current session will log you out too.'}
        </p>
        {isLoading ? (
          <PageLoader />
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {sessions.length === 0 && <p className="text-xs text-muted-foreground">No active sessions.</p>}
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-4 py-1.5 border-b border-border last:border-0">
                <div>
                  <p className="text-xs">Signed in {new Date(s.createdAt).toLocaleString()}</p>
                  <p className="text-[11px] text-muted-foreground">Expires {new Date(s.expiresAt).toLocaleString()}</p>
                </div>
                <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" disabled={revokeOne.isPending} onClick={() => revokeOne.mutate(s.id)}>
                  Revoke
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
            {revokeAll.isPending ? 'Revoking...' : 'Revoke All'}
          </Button>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function YouTubeTab() {
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
      toast.success('Setting saved');
    },
    onError: () => toast.error('Failed to save setting'),
  });

  const uploadFile = useMutation({
    mutationFn: (file: File) => settingsApi.uploadYtCookieFile(file),
    onSuccess: (result) => {
      toast[result.valid === false ? 'error' : 'success'](
        result.valid === false ? 'Uploaded, but YouTube rejected these cookies' : 'Cookie file uploaded',
      );
      qc.invalidateQueries({ queryKey: ['yt-cookie-status'] });
      qc.invalidateQueries({ queryKey: ['yt-cookie-check'] });
    },
    onError: () => toast.error('Failed to upload cookie file'),
  });

  const uploadText = useMutation({
    mutationFn: (text: string) => settingsApi.uploadYtCookieText(text),
    onSuccess: (result) => {
      toast[result.valid === false ? 'error' : 'success'](
        result.valid === false ? 'Saved, but YouTube rejected these cookies' : 'Cookies saved',
      );
      setCookieText('');
      setPasteMode(false);
      qc.invalidateQueries({ queryKey: ['yt-cookie-status'] });
      qc.invalidateQueries({ queryKey: ['yt-cookie-check'] });
    },
    onError: () => toast.error('Failed to save cookies'),
  });

  const deleteCookies = useMutation({
    mutationFn: () => settingsApi.deleteYtCookies(),
    onSuccess: () => {
      toast.success('Cookie file removed');
      qc.invalidateQueries({ queryKey: ['yt-cookie-status'] });
      qc.invalidateQueries({ queryKey: ['yt-cookie-check'] });
    },
    onError: () => toast.error('Failed to remove cookies'),
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
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">YouTube Cookies</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Upload a cookies.txt file to access age-restricted or member-only YouTube content.
            You can export cookies from your browser using extensions like
            {' '}<span className="font-medium">Get cookies.txt LOCALLY</span> (Chrome/Firefox).
          </p>

          {/* Status */}
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                !status?.active ? 'bg-zinc-500' : cookieCheck?.valid === false ? 'bg-destructive' : cookieCheck?.valid === true ? 'bg-green-500' : 'bg-zinc-500'
              }`}
            />
            <span className="text-sm">
              {isLoading ? 'Loading...' : !status?.active
                ? 'No cookies configured'
                : cookieCheck?.valid === false
                  ? `YouTube rejected these cookies (${formatSize(status.size)}) — re-export and re-upload`
                  : cookieCheck?.valid === true
                    ? `Cookies active and working (${formatSize(status.size)})`
                    : `Cookies active (${formatSize(status.size)}) — not yet checked`}
            </span>
            {status?.active && (
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => recheckCookies.mutate()} disabled={recheckCookies.isPending}>
                {recheckCookies.isPending ? 'Checking...' : 'Recheck'}
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
              {uploadFile.isPending ? 'Uploading...' : 'Upload cookies.txt'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPasteMode(!pasteMode)}
            >
              <FileText className="h-3.5 w-3.5 mr-1" />
              Paste cookies
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
                Remove
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
                  {uploadText.isPending ? 'Saving...' : 'Save'}
                </Button>
                <Button variant="outline" size="sm" onClick={() => { setPasteMode(false); setCookieText(''); }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Played Song Storage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Controls what happens to songs downloaded via chat commands (<code>!play</code>/<code>!queue</code>/<code>!stream</code>).
            This does not affect songs added deliberately through the Library tab (upload or "download by URL") — those are always kept.
          </p>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-xs">Keep played songs</Label>
              <p className="text-[11px] text-muted-foreground">
                {cacheSettings?.keepPlayedSongs !== false
                  ? 'On: chat-played songs can be picked up into the library by "Scan for New Files" and kept indefinitely (default).'
                  : 'Off: chat-played songs are never added to the library and are deleted automatically about an hour after playing, to save disk space.'}
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

function DebugTab() {
  const qc = useQueryClient();
  const [confirmReset, setConfirmReset] = useState<'radio' | 'bots' | null>(null);

  const { data: flags, isLoading } = useQuery({
    queryKey: ['debug-flags'],
    queryFn: settingsApi.getDebugFlags,
  });

  const setFlag = useMutation({
    mutationFn: ({ name, enabled }: { name: 'voice' | 'rankCheck'; enabled: boolean }) =>
      settingsApi.setDebugFlag(name, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['debug-flags'] }),
    onError: () => toast.error('Failed to update debug flag'),
  });

  const resetRadioIds = useMutation({
    mutationFn: settingsApi.resetRadioStationIds,
    onSuccess: ({ deletedCount }) => {
      qc.invalidateQueries({ queryKey: ['radio-stations'] });
      toast.success(`Deleted ${deletedCount} radio station(s), IDs reset`);
      setConfirmReset(null);
    },
    onError: () => toast.error('Failed to reset radio station IDs'),
  });

  const resetBotIds = useMutation({
    mutationFn: settingsApi.resetMusicBotIds,
    onSuccess: ({ deletedCount }) => {
      qc.invalidateQueries({ queryKey: ['music-bots'] });
      toast.success(`Deleted ${deletedCount} music bot(s), IDs reset`);
      setConfirmReset(null);
    },
    onError: () => toast.error('Failed to reset music bot IDs'),
  });

  if (isLoading) return <PageLoader />;

  return (
    <div className="max-w-lg space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Debug Logging</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Extra verbose logging for diagnosing issues. Leave these off during normal
            operation — they can produce a lot of log output. Changes take effect immediately.
          </p>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-xs">Voice Bot Debug</Label>
              <p className="text-[11px] text-muted-foreground">Per-second audio streaming stats (jitter, frame timing) for music/stream bots.</p>
            </div>
            <Switch
              checked={!!flags?.voice}
              onCheckedChange={(v) => setFlag.mutate({ name: 'voice', enabled: v })}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-xs">Rank Check Debug</Label>
              <p className="text-[11px] text-muted-foreground">Per-client detail (computed hours, group membership) for the Rank Check bot-flow action.</p>
            </div>
            <Switch
              checked={!!flags?.rankCheck}
              onCheckedChange={(v) => setFlag.mutate({ name: 'rankCheck', enabled: v })}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-destructive flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4" /> Danger Zone
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            SQLite's id counters never go back down on their own, even after deleting everything -
            these wipe a table entirely (across every server, not just the one selected above) so its
            next entry starts back at #1.
          </p>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-xs">Reset Radio Station IDs</Label>
              <p className="text-[11px] text-muted-foreground">Deletes every radio station on every server.</p>
            </div>
            <Button variant="destructive" size="sm" onClick={() => setConfirmReset('radio')}>
              Reset
            </Button>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-xs">Reset Music Bot IDs</Label>
              <p className="text-[11px] text-muted-foreground">Stops and deletes every music bot on every server.</p>
            </div>
            <Button variant="destructive" size="sm" onClick={() => setConfirmReset('bots')}>
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmReset !== null}
        onOpenChange={(open) => !open && setConfirmReset(null)}
        title={confirmReset === 'radio' ? 'Reset Radio Station IDs?' : 'Reset Music Bot IDs?'}
        description={
          confirmReset === 'radio'
            ? 'This permanently deletes every radio station on every server. They will need to be re-added.'
            : 'This stops and permanently deletes every music bot on every server. They will need to be re-created.'
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

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function RestartTab() {
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
      toast.success('Restart schedule saved');
    },
    onError: () => toast.error('Failed to save restart schedule'),
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
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Scheduled Restart</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Periodically restart ts6-manager's own containers to clear memory and ensure a clean
            runtime state. This does <strong>not</strong> restart your TeamSpeak server — only
            ts6-manager itself. Pick at least one container below to enable it.
          </p>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-xs">Restart Backend</Label>
              <p className="text-[11px] text-muted-foreground">Bot connections, EventBridge, WebSocket state.</p>
            </div>
            <Switch checked={active.backendEnabled} onCheckedChange={(v) => update({ backendEnabled: v })} />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-xs">Restart Sidecar</Label>
              <p className="text-[11px] text-muted-foreground">The video-streaming (WebRTC/RTP) process.</p>
            </div>
            <Switch checked={active.sidecarEnabled} onCheckedChange={(v) => update({ sidecarEnabled: v })} />
          </div>

          <div>
            <Label className="text-xs">Time (24h, server-local)</Label>
            <Input
              type="time"
              className="h-8 mt-1 w-32 font-mono-data text-xs"
              value={active.time}
              onChange={(e) => update({ time: e.target.value })}
            />
          </div>

          <div>
            <Label className="text-xs">Days</Label>
            <div className="flex gap-1 mt-1">
              {DAY_LABELS.map((label, i) => (
                <Button
                  key={i}
                  type="button"
                  variant={active.days.includes(i) ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 w-11 px-0 text-xs"
                  onClick={() => toggleDay(i)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          <Button
            size="sm"
            disabled={!draft || save.isPending}
            onClick={() => draft && save.mutate(draft)}
          >
            {save.isPending ? 'Saving...' : 'Save'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function SsoTab() {
  const qc = useQueryClient();
  const { data: oidc, isLoading } = useQuery({ queryKey: ['oidc-settings'], queryFn: settingsApi.getOidc });
  const [draft, setDraft] = useState<OidcSettingsInput | null>(null);

  const save = useMutation({
    mutationFn: (cfg: OidcSettingsInput) => settingsApi.setOidc(cfg),
    onSuccess: (saved) => {
      qc.setQueryData(['oidc-settings'], saved);
      setDraft(null);
      toast.success('SSO settings saved');
    },
    onError: () => toast.error('Failed to save SSO settings'),
  });

  if (isLoading || !oidc) return <PageLoader />;

  const active: OidcSettingsInput = draft ?? { ...oidc, clientSecret: '' };
  const update = (patch: Partial<OidcSettingsInput>) => setDraft({ ...active, ...patch });

  return (
    <div className="max-w-lg space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Single Sign-On (OIDC)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Let users log in via an external OpenID Connect provider (Authentik, Keycloak, Authelia, Zitadel, ...). A brand-new user is created as a <strong>viewer</strong> on their first SSO login — promote them to admin afterward from the Users tab if needed. Local username/password login stays available alongside this.
          </p>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-xs">Enabled</Label>
              <p className="text-[11px] text-muted-foreground">Shows a "Sign in with SSO" button on the login page.</p>
            </div>
            <Switch checked={active.enabled} onCheckedChange={(v) => update({ enabled: v })} />
          </div>

          <div>
            <Label className="text-xs">Issuer URL</Label>
            <Input
              className="h-8 mt-1 font-mono-data text-xs"
              placeholder="https://auth.example.com/application/o/ts6-manager/"
              value={active.issuer}
              onChange={(e) => update({ issuer: e.target.value })}
            />
            <p className="text-[11px] text-muted-foreground mt-1">The provider's OIDC discovery document must be reachable at <code>{'{issuer}'}/.well-known/openid-configuration</code>.</p>
          </div>

          <div>
            <Label className="text-xs">Client ID</Label>
            <Input className="h-8 mt-1 font-mono-data text-xs" value={active.clientId} onChange={(e) => update({ clientId: e.target.value })} />
          </div>

          <div>
            <Label className="text-xs">Client Secret</Label>
            <Input
              type="password"
              className="h-8 mt-1 font-mono-data text-xs"
              placeholder={oidc.hasClientSecret ? 'Leave blank to keep the existing secret' : 'Client secret'}
              value={active.clientSecret}
              onChange={(e) => update({ clientSecret: e.target.value })}
            />
          </div>

          <div>
            <Label className="text-xs">Button Label</Label>
            <Input className="h-8 mt-1 text-xs" value={active.buttonLabel} onChange={(e) => update({ buttonLabel: e.target.value })} />
          </div>

          <div className="rounded-md border border-border bg-muted/30 p-2.5">
            <p className="text-[11px] text-muted-foreground">Redirect URI to register at your provider:</p>
            <p className="text-[11px] font-mono-data mt-0.5 break-all">{window.location.origin}/api/auth/oidc/callback</p>
          </div>

          <Button size="sm" disabled={!draft || save.isPending} onClick={() => draft && save.mutate(draft)}>
            {save.isPending ? 'Saving...' : 'Save'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function UpdateStatusTab() {
  const { data, isLoading } = useUpdateCheck();
  const recheck = useRecheckUpdate();

  if (isLoading || !data) return <PageLoader />;

  const frontendUpdateAvailable = !!(data.frontendLatest && compareVersions(data.frontendLatest, __APP_VERSION__) > 0);

  const rows = [
    { label: 'Backend', current: data.backend.current, latest: data.backend.latest, updateAvailable: data.backend.updateAvailable },
    { label: 'Sidecar', current: data.sidecar.current, latest: data.sidecar.latest, updateAvailable: data.sidecar.updateAvailable },
    { label: 'Frontend', current: __APP_VERSION__ as string | null, latest: data.frontendLatest, updateAvailable: frontendUpdateAvailable },
  ];

  return (
    <div className="max-w-lg space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm font-medium">Update Status</CardTitle>
          <Button
            size="sm"
            variant="outline"
            disabled={recheck.isPending}
            onClick={() => {
              toast.promise(recheck.mutateAsync(), {
                loading: 'Checking for updates...',
                success: (result) => {
                  const frontendBehind = !!(result.frontendLatest && compareVersions(result.frontendLatest, __APP_VERSION__) > 0);
                  return result.backend.updateAvailable || result.sidecar.updateAvailable || frontendBehind
                    ? 'Update available'
                    : 'All up to date';
                },
                error: 'Failed to check for updates',
              });
            }}
          >
            <RefreshCw className={cn('h-3.5 w-3.5 mr-1', recheck.isPending && 'animate-spin')} />
            Recheck Now
          </Button>
        </CardHeader>
        <CardContent className="space-y-1">
          <p className="text-xs text-muted-foreground mb-3">
            Compares this deployment against GitHub's <code className="font-mono-data">main</code> branch. Notify-only — nothing here runs an update automatically.
          </p>

          {rows.map((row) => {
            const known = row.current !== null && row.latest !== null;
            return (
              <div key={row.label} className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-0">
                <span className="text-xs font-medium w-16 shrink-0">{row.label}</span>
                <div className="flex items-center gap-4 flex-1">
                  <div>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Installed</p>
                    <p className="font-mono-data text-xs">{row.current ?? 'unreachable'}</p>
                  </div>
                  <div>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Latest (main)</p>
                    <p className={cn('font-mono-data text-xs', row.updateAvailable && 'text-primary')}>{row.latest ?? 'unknown'}</p>
                  </div>
                </div>
                <Badge
                  variant={!known ? 'secondary' : row.updateAvailable ? 'default' : 'outline'}
                  className="text-[10px] shrink-0"
                >
                  {!known ? 'unknown' : row.updateAvailable ? 'update available' : 'up to date'}
                </Badge>
              </div>
            );
          })}

          <p className="text-[11px] text-muted-foreground pt-3">
            {data.checkedAt ? `Last checked: ${new Date(data.checkedAt).toLocaleString()}` : 'Not checked yet'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
