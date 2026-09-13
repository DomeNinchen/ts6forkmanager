import { compareVersions } from '@ts6/common';
import { Download, Copy, X } from 'lucide-react';
import { toast } from 'sonner';
import { useUpdateCheck } from '@/hooks/use-update-check';
import { useUpdateBannerStore, type UpdateComponent } from '@/stores/update-banner.store';

const DEPLOY_COMMAND = 'git pull && docker compose up -d --build';

interface OutdatedComponent {
  component: UpdateComponent;
  label: string;
  current: string;
  latest: string;
}

export function UpdateBanner() {
  const { data } = useUpdateCheck();
  const dismissedFor = useUpdateBannerStore((s) => s.dismissedFor);
  const dismiss = useUpdateBannerStore((s) => s.dismiss);

  if (!data) return null;

  const frontendUpdateAvailable = !!(data.frontendLatest && compareVersions(data.frontendLatest, __APP_VERSION__) > 0);

  const candidates: OutdatedComponent[] = [
    data.backend.updateAvailable && data.backend.current && data.backend.latest
      ? { component: 'backend', label: 'Backend', current: data.backend.current, latest: data.backend.latest }
      : null,
    data.sidecar.updateAvailable && data.sidecar.current && data.sidecar.latest
      ? { component: 'sidecar', label: 'Sidecar', current: data.sidecar.current, latest: data.sidecar.latest }
      : null,
    frontendUpdateAvailable
      ? { component: 'frontend', label: 'Frontend', current: __APP_VERSION__, latest: data.frontendLatest! }
      : null,
  ].filter((c): c is OutdatedComponent => c !== null);

  const outdated = candidates.filter((c) => dismissedFor[c.component] !== c.latest);
  if (outdated.length === 0) return null;

  const dismissAll = () => {
    for (const c of outdated) dismiss(c.component, c.latest);
  };

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-primary/10 px-4 py-2 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <Download className="h-3.5 w-3.5 text-primary shrink-0" />
        <span>
          Update available:{' '}
          {outdated.map((c, i) => (
            <span key={c.component} className="font-mono-data">
              {i > 0 && ', '}
              {c.label} v{c.current} → v{c.latest}
            </span>
          ))}
        </span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(DEPLOY_COMMAND);
            toast.success('Copied');
          }}
          className="inline-flex items-center gap-1 rounded-sm border border-border bg-background px-2 py-0.5 font-mono-data hover:bg-muted"
          title="Copy deploy command"
        >
          <Copy className="h-3 w-3" />
          {DEPLOY_COMMAND}
        </button>
      </div>
      <button onClick={dismissAll} className="p-1 hover:bg-muted rounded-sm shrink-0" title="Postpone">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
