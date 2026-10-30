import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check } from 'lucide-react';
import { ESCALATING_PERMISSIONS, ROLE_PERMISSIONS, isUserRole } from '@ts6/common';

/** What a role may do, read from the same templates the backend enforces - shown before a role is given to someone. */
export function RolePermissions({ role }: { role: string }) {
  const { t } = useTranslation();
  if (!isUserRole(role)) return null;
  const k = 'pages.settings.users.permissions';

  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 text-xs space-y-2" data-testid="role-permissions">
      {role === 'admin' ? (
        <p>{t(`${k}.adminAll`)}</p>
      ) : (
        <>
          <p className="font-medium">{t(`${k}.heading`)}</p>
          <ul className="space-y-1">
            {ROLE_PERMISSIONS[role].map((p) => (
              <li key={p} className="flex items-start gap-1.5">
                <Check className="h-3.5 w-3.5 mt-px shrink-0 text-primary" />
                <span>
                  {t(`${k}.labels.${p.replace('.', '_')}`)}
                  {ESCALATING_PERMISSIONS.includes(p) && (
                    <span className="ml-1.5 text-amber-600 dark:text-amber-400">({t(`${k}.escalating`)})</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {role === 'moderator' && (
            <p className="flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
              {t(`${k}.moderatorWarning`)}
            </p>
          )}
        </>
      )}
    </div>
  );
}
