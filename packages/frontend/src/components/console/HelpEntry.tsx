import { useTranslation } from 'react-i18next';
import { getDangerReason } from '@ts6/common';
import { cn } from '@/lib/utils';
import { COMMANDS, getCommand } from '@/lib/console/catalog';
import { CommandHelp } from './CommandHelp';

interface HelpEntryProps {
  /** A command name, or null for the overview of all of them. */
  topic: string | null;
  /** Called with a command name when one in the overview is clicked. */
  onPick: (command: string) => void;
}

/** The console's own `help` (WebQuery has none): the overview of all commands, or the usage of one. */
export function HelpEntry({ topic, onPick }: HelpEntryProps) {
  const { t } = useTranslation();

  if (topic) {
    const command = getCommand(topic);
    if (!command) return <p className="text-sm text-muted-foreground">{t('pages.console.help.unknownTopic', { name: topic })}</p>;
    return <CommandHelp command={command} detailed />;
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">{t('pages.console.help.intro', { count: COMMANDS.length })}</p>
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
        <li>{t('pages.console.help.introHelp')}</li>
        <li>{t('pages.console.help.introUse')}</li>
        <li>{t('pages.console.help.introKeys')}</li>
        <li>{t('pages.console.help.introEscapes')}</li>
      </ul>
      <div className="flex flex-wrap gap-1">
        {COMMANDS.map((command) => (
          <button
            key={command.name}
            type="button"
            onClick={() => onPick(command.name)}
            title={command.hidden ? t('pages.console.help.hiddenHint') : undefined}
            className={cn(
              'rounded border border-border px-1.5 py-0.5 font-mono text-xs hover:border-primary hover:text-primary',
              getDangerReason(command.name) && 'border-destructive/50 text-destructive',
              command.hidden && 'border-dashed',
            )}
          >
            {command.name}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">{t('pages.console.help.legend')}</p>
    </div>
  );
}
