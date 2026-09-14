import { useState } from 'react';
import { Navigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { useLogin, useVerifyTotp } from '@/hooks/use-auth';
import { useAuthStore } from '@/stores/auth.store';
import { authApi } from '@/api/auth.api';
import { Loader2, AlertCircle, ShieldCheck } from 'lucide-react';

const SSO_ERROR_MESSAGES: Record<string, string> = {
  sso_not_configured: 'SSO is not configured.',
  sso_failed: 'SSO login failed. Please try again.',
  sso_invalid_state: 'SSO login expired or was tampered with. Please try again.',
  sso_no_subject: 'The SSO provider did not return a valid identity.',
  account_disabled: 'This account has been disabled.',
};

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [rememberDevice, setRememberDevice] = useState(true);
  const login = useLogin();
  const verifyTotp = useVerifyTotp();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());
  const { data: oidc } = useQuery({ queryKey: ['oidc-status'], queryFn: authApi.oidcStatus, staleTime: 5 * 60 * 1000 });
  const ssoError = new URLSearchParams(window.location.search).get('error');

  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  const ticket = login.data?.requiresTotp ? login.data.ticket : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login.mutate({ username, password });
  };

  const handleVerifyTotp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticket) return;
    verifyTotp.mutate({ ticket, code: totpCode, rememberDevice });
  };

  if (ticket) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background grid-bg">
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />
        <div className="w-full max-w-sm mx-4 relative">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center h-14 w-14 rounded-xl bg-primary/10 border border-primary/20 mb-4">
              <ShieldCheck className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-xl font-semibold text-foreground">Two-Factor Authentication</h1>
            <p className="text-sm text-muted-foreground mt-1">Enter the code from your authenticator app</p>
          </div>

          <Card className="border-border/50 backdrop-blur-xs">
            <CardContent className="pt-6">
              <form onSubmit={handleVerifyTotp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="totp-code" className="text-xs">Code (or a recovery code)</Label>
                  <Input
                    id="totp-code"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    placeholder="123456"
                    autoComplete="one-time-code"
                    autoFocus
                  />
                </div>

                <div className="flex items-center justify-between">
                  <Label htmlFor="remember-device" className="text-xs text-muted-foreground">Remember this device for 15 days</Label>
                  <Switch id="remember-device" checked={rememberDevice} onCheckedChange={setRememberDevice} />
                </div>

                {verifyTotp.isError && (
                  <div className="flex items-center gap-2 text-destructive text-xs bg-destructive/10 rounded-md px-3 py-2">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span>Invalid code. Please try again.</span>
                  </div>
                )}

                <Button type="submit" className="w-full" disabled={verifyTotp.isPending || !totpCode}>
                  {verifyTotp.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    'Verify'
                  )}
                </Button>
                <Button type="button" variant="ghost" className="w-full" onClick={() => login.reset()}>
                  Back to login
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background grid-bg">
      {/* Ambient glow */}
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-sm mx-4 relative">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-xl bg-primary/10 border border-primary/20 mb-4">
            <span className="text-primary font-bold text-xl font-mono-data text-glow">TS</span>
          </div>
          <h1 className="text-xl font-semibold text-foreground">TeamSpeak 6 Manager</h1>
          <p className="text-sm text-muted-foreground mt-1">Server Administration Panel</p>
        </div>

        <Card className="border-border/50 backdrop-blur-xs">
          <CardHeader className="pb-4">
            <h2 className="text-sm font-medium text-center text-muted-foreground">Sign in to continue</h2>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username" className="text-xs">Username</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  autoComplete="username"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-xs">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </div>

              {login.isError && (
                <div className="flex items-center gap-2 text-destructive text-xs bg-destructive/10 rounded-md px-3 py-2">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>Invalid credentials. Please try again.</span>
                </div>
              )}

              {ssoError && (
                <div className="flex items-center gap-2 text-destructive text-xs bg-destructive/10 rounded-md px-3 py-2">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>{SSO_ERROR_MESSAGES[ssoError] || 'SSO login failed.'}</span>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={login.isPending || !username || !password}>
                {login.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  'Sign In'
                )}
              </Button>
            </form>

            {oidc?.enabled && (
              <>
                <div className="flex items-center gap-3 my-4">
                  <Separator className="flex-1" />
                  <span className="text-[10px] text-muted-foreground uppercase">or</span>
                  <Separator className="flex-1" />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => { window.location.href = '/api/auth/oidc/login'; }}
                >
                  <ShieldCheck className="h-4 w-4" />
                  {oidc.buttonLabel}
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-[10px] text-muted-foreground/50 mt-6 font-mono-data">
          TS6 WEBUI v{__APP_VERSION__}
        </p>
      </div>
    </div>
  );
}
