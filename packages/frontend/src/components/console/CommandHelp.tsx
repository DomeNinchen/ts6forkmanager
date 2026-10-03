import { useTranslation } from 'react-i18next';
import { getDangerReason, isReadOnlyCommand } from '@ts6/common';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { CatalogCommand, CatalogParam } from '@/lib/console/catalog-types';
import { describeConstraint, paramPlaceholder } from '@/lib/console/catalog';

interface CommandHelpProps {
  command: CatalogCommand;
  /** The parameter the caret is currently in the value of, highlighted in the syntax. */
  activeParam?: string;
  /** Also list the permissions the command checks. */
  detailed?: boolean;
  className?: string;
}

function ParamChip({ param, active }: { param: CatalogParam; active: boolean }) {
  const { t } = useTranslation();
  const constraint = describeConstraint(param);
  const closedValues = param.values && param.closed;
  return (
    <span
      className={cn(
        'inline-flex items-baseline gap-0.5 rounded border px-1.5 py-0.5 font-mono text-xs',
        param.required ? 'border-primary/50 text-foreground' : 'border-border text-muted-foreground',
        active && 'bg-primary/15 ring-1 ring-primary',
      )}
      title={param.required ? t('pages.console.help.required') : t('pages.console.help.optional')}
    >
      <span className={param.required ? 'font-semibold' : undefined}>{param.name}</span>
      <span className="opacity-60">=</span>
      <span className="opacity-80">{closedValues && constraint ? constraint : `{${paramPlaceholder(param)}}`}</span>
      {param.repeatable && <span title={t('pages.console.help.repeatable')}>{'…'}</span>}
    </span>
  );
}

/** Usage of one command: what it takes (required, optional, repeatable, ranges, fixed values) and what it checks. */
export function CommandHelp({ command, activeParam, detailed = false, className }: CommandHelpProps) {
  const { t } = useTranslation();
  const danger = getDangerReason(command.name);
  const active = command.params.find((param) => param.name === activeParam);
  const activeConstraint = active ? describeConstraint(active) : null;

  return (
    <div className={cn('space-y-2 text-sm', className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono font-semibold">{command.name}</span>
        {command.aliasOf && <Badge variant="secondary">{t('pages.console.help.aliasOf', { name: command.aliasOf })}</Badge>}
        {command.hidden && <Badge variant="outline" title={t('pages.console.help.hiddenHint')}>{t('pages.console.help.hidden')}</Badge>}
        {danger && <Badge variant="destructive">{t('pages.console.help.needsConfirmation')}</Badge>}
        {isReadOnlyCommand(command.name) && <Badge variant="success">{t('pages.console.help.readOnly')}</Badge>}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {command.options.map((option) => (
          <span key={option} className="rounded border border-dashed border-border px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            -{option}
          </span>
        ))}
        {command.params.map((param) => (
          <ParamChip key={param.name} param={param} active={param.name === activeParam} />
        ))}
        {command.properties && (
          <span className="rounded border border-dashed border-border px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            {t('pages.console.help.properties', { group: command.properties })}
          </span>
        )}
        {command.options.length === 0 && command.params.length === 0 && !command.properties && (
          <span className="text-xs text-muted-foreground">{t('pages.console.help.noParameters')}</span>
        )}
      </div>

      {active && (
        <div className="rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs">
          <span className="font-mono font-semibold">{active.name}</span>
          <span className="text-muted-foreground">
            {' · '}
            {active.required ? t('pages.console.help.required') : t('pages.console.help.optional')}
            {active.repeatable && ` · ${t('pages.console.help.repeatable')}`}
            {active.type === 'integer' && ` · ${t('pages.console.help.integer')}`}
            {active.range && ` · ${t('pages.console.help.range', { min: active.range[0], max: active.range[1] })}`}
            {active.default !== undefined && ` · ${t('pages.console.help.defaultValue', { value: active.default })}`}
          </span>
          {active.values && (
            <div className="mt-1 flex flex-wrap gap-1">
              {active.values.map((entry) => (
                <span key={entry.value} className="rounded bg-secondary px-1.5 py-0.5 font-mono">
                  {entry.value}
                  {entry.label && <span className="ml-1 font-sans text-muted-foreground">{entry.label}</span>}
                </span>
              ))}
              {!active.closed && <span className="px-1 text-muted-foreground">{t('pages.console.help.orOther')}</span>}
            </div>
          )}
          {!active.values && activeConstraint && <span className="ml-2 text-muted-foreground">{activeConstraint}</span>}
        </div>
      )}

      {detailed && command.permissions.length > 0 && (
        <div>
          <div className="mb-1 text-xs text-muted-foreground">{t('pages.console.help.permissions')}</div>
          <div className="flex flex-wrap gap-1">
            {command.permissions.map((permission) => (
              <span key={permission} className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px]">
                {permission}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
