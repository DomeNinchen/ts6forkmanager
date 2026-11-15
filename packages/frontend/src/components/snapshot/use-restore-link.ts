import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { ExternalToast } from 'sonner';
import { useAuthStore } from '@/stores/auth.store';

/**
 * The way back offered on a "deleted" notice: the delete routes name the before-bulk backup they took
 * (X-Before-Bulk-Backup); this opens the snapshot comparison with that backup and the deleted objects
 * (`kind:id`) ticked. Admins only (the comparison is admin only); nothing when no backup was taken.
 */
export function useRestoreLink() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  /** Toast options with the button (and time to reach it), or undefined. */
  return (responses: unknown[], targets: string[]): ExternalToast | undefined => {
    if (!isAdmin) return undefined;
    const name = responses.map((r) => (r as { headers?: Record<string, string> } | undefined)?.headers?.['x-before-bulk-backup']).find(Boolean);
    if (!name) return undefined;
    return {
      duration: 12_000,
      action: {
        label: t('pages.snapshotCompare.fromDeletion'),
        onClick: () => navigate(`/snapshot-compare?backup=${encodeURIComponent(`before-bulk/${name}`)}&select=${encodeURIComponent(targets.join(','))}`),
      },
    };
  };
}
