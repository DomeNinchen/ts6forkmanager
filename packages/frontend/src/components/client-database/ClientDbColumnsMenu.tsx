import { useTranslation } from 'react-i18next';
import type { ClientDbAssignableGroup } from '@ts6/common';
import { Columns3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  CLIENT_DB_COLUMN_IDS, REQUIRED_COLUMN, useClientDatabaseViewStore,
} from '@/stores/client-database.store';
import { COLUMN_LABEL_KEYS } from './columns';

interface ClientDbColumnsMenuProps {
  /** The server's id as the store keys it ("configId:sid"). */
  serverKey: string;
  /** Group mode is on: the groups that can be shown as columns. */
  groups: ClientDbAssignableGroup[];
  groupMode: boolean;
}

/** One row of the menu: a checkbox that is only a picture, so the whole row is the click target and the menu stays open. */
function ToggleItem({ label, checked, disabled, onToggle }: { label: string; checked: boolean; disabled?: boolean; onToggle: () => void }) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      onSelect={(e) => { e.preventDefault(); onToggle(); }}
    >
      <Checkbox checked={checked} tabIndex={-1} className="pointer-events-none" aria-hidden />
      <span className="truncate">{label}</span>
    </DropdownMenuItem>
  );
}

export function ClientDbColumnsMenu({ serverKey, groups, groupMode }: ClientDbColumnsMenuProps) {
  const { t } = useTranslation();
  const visibleColumns = useClientDatabaseViewStore((s) => s.visibleColumns);
  const hiddenGroups = useClientDatabaseViewStore((s) => s.hiddenGroups[serverKey]) ?? [];
  const setColumnVisible = useClientDatabaseViewStore((s) => s.setColumnVisible);
  const resetColumns = useClientDatabaseViewStore((s) => s.resetColumns);
  const setHiddenGroups = useClientDatabaseViewStore((s) => s.setHiddenGroups);

  const toggleGroup = (sgid: number) =>
    setHiddenGroups(serverKey, hiddenGroups.includes(sgid) ? hiddenGroups.filter((id) => id !== sgid) : [...hiddenGroups, sgid]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          <Columns3 className="h-4 w-4 mr-1" /> {t('pages.clientDatabase.columnsMenu.title')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 max-h-[70vh] overflow-y-auto">
        <DropdownMenuLabel>{t('pages.clientDatabase.columnsMenu.columns')}</DropdownMenuLabel>
        {CLIENT_DB_COLUMN_IDS.map((id) => (
          <ToggleItem
            key={id}
            label={t(`pages.clientDatabase.columns.${COLUMN_LABEL_KEYS[id]}`)}
            checked={visibleColumns.includes(id)}
            disabled={id === REQUIRED_COLUMN}
            onToggle={() => setColumnVisible(id, !visibleColumns.includes(id))}
          />
        ))}
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); resetColumns(); }} className="text-muted-foreground">
          {t('pages.clientDatabase.columnsMenu.reset')}
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('pages.clientDatabase.columnsMenu.groups')}</DropdownMenuLabel>
        {!groupMode ? (
          <p className="px-2 pb-2 text-xs text-muted-foreground">{t('pages.clientDatabase.columnsMenu.groupsOff')}</p>
        ) : groups.length === 0 ? (
          <p className="px-2 pb-2 text-xs text-muted-foreground">{t('pages.clientDatabase.columnsMenu.noGroups')}</p>
        ) : (
          <>
            {groups.map((g) => (
              <ToggleItem key={g.sgid} label={g.name} checked={!hiddenGroups.includes(g.sgid)} onToggle={() => toggleGroup(g.sgid)} />
            ))}
            <div className="flex gap-1 px-1 pt-1">
              <Button size="sm" variant="ghost" className="h-7 flex-1 text-xs" onClick={() => setHiddenGroups(serverKey, [])}>
                {t('pages.clientDatabase.columnsMenu.showAll')}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 flex-1 text-xs" onClick={() => setHiddenGroups(serverKey, groups.map((g) => g.sgid))}>
                {t('pages.clientDatabase.columnsMenu.hideAll')}
              </Button>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
