import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { authApi } from '@/api/auth.api';
import { useAuthStore } from '@/stores/auth.store';
import { useLogout } from '@/hooks/use-auth';
import { ShieldCheck } from 'lucide-react';

/**
 * Blocks the entire app behind a mandatory 2FA setup for admin accounts that
 * haven't enabled it yet. Rendered by AppLayout in place of the normal
 * sidebar/outlet - there is deliberately no way to navigate around this.
 */
export function MandatoryTotpSetup() {
  const { updateUser } = useAuthStore();
  const logout = useLogout();
  const [step, setStep] = useState<'intro' | 'setup' | 'codes'>('intro');
  const [qrData, setQrData] = useState<{ secret: string; qrCodeDataUrl: string } | null>(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const setup = useMutation({
    mutationFn: authApi.totpSetup,
    onSuccess: (data) => { setQrData(data); setStep('setup'); },
    onError: () => toast.error('Failed to start 2FA setup'),
  });

  const verifySetup = useMutation({
    mutationFn: () => authApi.totpVerifySetup(confirmCode),
    onSuccess: (data) => {
      // Don't flip totpEnabled in the store yet - that's the flag this whole
      // gate is keyed on, and doing so now would unmount this component before
      // the recovery codes below ever get shown.
      setRecoveryCodes(data.recoveryCodes);
      setStep('codes');
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Invalid code'),
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-background grid-bg p-4">
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />
      <Card className="w-full max-w-sm border-border/50 backdrop-blur-xs relative">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <CardTitle className="text-sm font-medium">Two-Factor Authentication Required</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 'intro' && (
            <>
              <p className="text-xs text-muted-foreground">
                Admin accounts require two-factor authentication. Set it up now with an authenticator app (Google Authenticator, Authy, ...) to continue.
              </p>
              <Button className="w-full" onClick={() => setup.mutate()} disabled={setup.isPending}>
                {setup.isPending ? 'Starting...' : 'Set Up Now'}
              </Button>
              <Button variant="ghost" className="w-full" onClick={logout}>Log out instead</Button>
            </>
          )}

          {step === 'setup' && qrData && (
            <>
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
              <Button className="w-full" onClick={() => verifySetup.mutate()} disabled={!confirmCode || verifySetup.isPending}>
                {verifySetup.isPending ? 'Verifying...' : 'Verify & Enable'}
              </Button>
            </>
          )}

          {step === 'codes' && recoveryCodes && (
            <>
              <p className="text-xs text-muted-foreground">
                Save these recovery codes somewhere safe. Each one can be used once to log in if you lose access to your authenticator app - they won't be shown again.
              </p>
              <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/30 p-3 font-mono-data text-xs">
                {recoveryCodes.map((c) => <span key={c}>{c}</span>)}
              </div>
              <Button className="w-full" onClick={() => { updateUser({ totpEnabled: true }); toast.success('2FA enabled'); }}>
                I've saved these codes
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
