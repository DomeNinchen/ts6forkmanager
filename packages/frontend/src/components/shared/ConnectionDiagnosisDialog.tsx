import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { CheckCircle2, XCircle, MinusCircle, RefreshCw, Copy, Loader2 } from 'lucide-react';
import type { ConnectionDiagnosis, DiagnosisStep } from '@ts6/common';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { copy } from '@/components/console/ResultView';

const P = 'pages.settings.connections.diagnosis';

function stepName(s: DiagnosisStep, t: TFunction): string {
  const name = t(`${P}.steps.${s.id}`);
  if (s.id === 'voice' && s.sid !== undefined) return `${name} (${t(`${P}.virtualServer`, { sid: s.sid })})`;
  return name;
}

/** What to do about a step: a text of the step's own where the generic cause text would mislead, the generic one otherwise. */
function remedy(s: DiagnosisStep, t: TFunction): string {
  if (s.status === 'ok') return s.source === 'live-session' ? t(`${P}.okLiveSession`) : t(`${P}.ok`);
  return t(`${P}.remedies.${s.id}.${s.cause}`, { defaultValue: t(`pages.settings.connections.causes.${s.cause}`) });
}

/** The report as plain text, for a support request: host and ports, never the API key, a password or a user name. */
export function diagnosisReport(name: string, d: ConnectionDiagnosis, t: TFunction): string {
  const mark = { ok: '[OK]', failed: '[FAIL]', skipped: '[--]' } as const;
  const lines = [
    `${t(`${P}.reportTitle`)}: ${name}`,
    `${t(`${P}.reportTime`)}: ${new Date().toISOString()}`,
    `${t('pages.settings.connections.host')}: ${d.host} (${d.useHttps ? 'HTTPS' : 'HTTP'})`,
    `${t(`${P}.reportVersion`)}: ${__APP_VERSION__}`,
    '',
  ];
  for (const s of d.steps) {
    const where = [s.port ? `${t(`${P}.port`)} ${s.port}` : '', s.durationMs !== undefined ? `${s.durationMs} ms` : ''].filter(Boolean).join(', ');
    lines.push(`${mark[s.status]} ${stepName(s, t)}${where ? ` (${where})` : ''}: ${remedy(s, t)}`);
    if (s.detail) lines.push(`      ${s.detail}`);
  }
  return lines.join('\n');
}

const ICON = {
  ok: <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />,
  failed: <XCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />,
  skipped: <MinusCircle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />,
};

/**
 * Connection diagnosis report (R10): one line per way to the server, with its verdict and what to do.
 * `run` is called on open and on "Test again"; nothing is stored.
 */
export function ConnectionDiagnosisDialog({ name, run, onClose }: { name: string; run: () => Promise<ConnectionDiagnosis>; onClose: () => void }) {
  const { t } = useTranslation();
  const [result, setResult] = useState<ConnectionDiagnosis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  /** The report as selectable text, where the browser offers no clipboard (plain http). */
  const [reportText, setReportText] = useState<string | null>(null);

  const copyReport = () => {
    if (!result) return;
    const text = diagnosisReport(name, result, t);
    if (navigator.clipboard) copy(text);
    else setReportText(text);
  };

  const start = () => {
    setRunning(true);
    setError(null);
    setReportText(null);
    run()
      .then(setResult)
      .catch((err: any) => setError(err?.response?.data?.error ?? err?.message ?? t(`${P}.failedToRun`)))
      .finally(() => setRunning(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(start, []);
  // Opened from state, not a DialogTrigger, so Radix has no trigger to give the focus back to on close.
  // Read during the first render: the dialog's own autofocus effect runs before this component's effects.
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => () => { setTimeout(() => opener?.focus(), 0); }, [opener]);

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">{t(`${P}.title`, { name })}</DialogTitle>
          <DialogDescription className="text-xs">
            {result ? `${result.host} (${result.useHttps ? 'HTTPS' : 'HTTP'})` : t(`${P}.description`)}
          </DialogDescription>
        </DialogHeader>

        <div aria-live="polite" aria-busy={running}>
          {running && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t(`${P}.running`)}</p>
          )}
          {!running && error && <p className="text-sm text-destructive">{error}</p>}
          {!running && result && (
            <ul className="max-h-[60vh] space-y-2 overflow-auto">
              {result.steps.map((s, i) => (
                <li key={`${s.id}-${s.port ?? i}`} className="rounded border border-border p-2">
                  <div className="flex items-center gap-2">
                    {ICON[s.status]}
                    <span className="text-sm font-medium">{stepName(s, t)}</span>
                    <span className="sr-only">{t(`${P}.status.${s.status}`)}</span>
                    <span className="ml-auto font-mono-data text-[11px] text-muted-foreground">
                      {[s.port ? `${t(`${P}.port`)} ${s.port}` : '', s.durationMs !== undefined ? `${s.durationMs} ms` : ''].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <p className={`mt-1 text-xs ${s.status === 'failed' ? '' : 'text-muted-foreground'}`}>{remedy(s, t)}</p>
                  {s.detail && <p className="mt-1 break-words font-mono-data text-[11px] text-muted-foreground">{s.detail}</p>}
                </li>
              ))}
            </ul>
          )}
          {reportText !== null && (
            <div className="mt-3">
              <label htmlFor="diagnosis-report" className="text-xs text-muted-foreground">{t(`${P}.copyManually`)}</label>
              <textarea id="diagnosis-report" readOnly autoFocus value={reportText} onFocus={(e) => e.currentTarget.select()}
                className="mt-1 h-40 w-full resize-none rounded border border-border bg-muted/40 p-2 font-mono-data text-[11px]" />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" disabled={running} onClick={start}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden /> {t(`${P}.again`)}
          </Button>
          <Button variant="outline" size="sm" disabled={running || !result} onClick={copyReport}>
            <Copy className="mr-1 h-3.5 w-3.5" aria-hidden /> {t(`${P}.copy`)}
          </Button>
          <Button size="sm" onClick={onClose}>{t('common.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
