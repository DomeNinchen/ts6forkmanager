import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';
import { JOURNAL_EVENTS, JOURNAL_RESULTS, JOURNAL_RANGES, JOURNAL_SOURCES } from '@ts6/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useServers } from '@/hooks/use-servers';
import { DEFAULT_FILTERS, type JournalFilterState } from '@/components/connection-journal/filters';
import { JournalByIp } from '@/components/connection-journal/JournalByIp';
import { JournalList } from '@/components/connection-journal/JournalList';
import { JournalSettings } from '@/components/connection-journal/JournalSettings';

type JournalTab = 'journal' | 'by-ip' | 'settings';

/**
 * Who signed in to this app and who joined a TeamSpeak server, from which address, and whether it
 * worked. Admin-only: every row carries an address. The filters are shared by the two lists, so
 * narrowing the journal and then looking at it by address (or the other way round) keeps what was asked for.
 */
export default function ConnectionJournal() {
  const { t } = useTranslation();
  const { data: servers } = useServers();
  const [tab, setTab] = useState<JournalTab>('journal');
  const [filters, setFilters] = useState<JournalFilterState>(DEFAULT_FILTERS);

  // The search box types freely; the lists are asked once typing has paused.
  const [search, setSearch] = useState(filters.q);
  useEffect(() => {
    const timer = setTimeout(() => setFilters((f) => (f.q === search ? f : { ...f, q: search })), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const patch = (change: Partial<JournalFilterState>) => setFilters((f) => ({ ...f, ...change }));
  const filtered =
    filters.source !== 'all' || filters.event !== 'all' || filters.result !== 'all' || filters.q !== '' || filters.ip !== ''
    || filters.server !== 'all' || filters.online || filters.range !== DEFAULT_FILTERS.range;

  // Only a TeamSpeak session has a server connection and can be "online now".
  const showsTs = filters.source !== 'web';

  const showAddress = (ip: string) => {
    patch({ ip });
    setTab('journal');
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">{t('pages.connectionJournal.title')}</h1>
        <p className="text-xs text-muted-foreground mt-1">{t('pages.connectionJournal.subtitle')}</p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as JournalTab)}>
        <TabsList>
          <TabsTrigger value="journal">{t('pages.connectionJournal.tabs.journal')}</TabsTrigger>
          <TabsTrigger value="by-ip">{t('pages.connectionJournal.tabs.byIp')}</TabsTrigger>
          <TabsTrigger value="settings">{t('pages.connectionJournal.tabs.settings')}</TabsTrigger>
        </TabsList>

        {tab !== 'settings' && (
          <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="journal-filters">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="h-9 w-56 pl-8"
                placeholder={t('pages.connectionJournal.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <Select value={filters.range} onValueChange={(v) => patch({ range: v as JournalFilterState['range'] })}>
              <SelectTrigger className="h-9 w-[150px]" aria-label={t('pages.connectionJournal.filters.range')}><SelectValue /></SelectTrigger>
              <SelectContent>
                {JOURNAL_RANGES.map((r) => <SelectItem key={r} value={r}>{t(`pages.connectionJournal.range.${r}`)}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select
              value={filters.source}
              onValueChange={(v) => {
                const source = v as JournalFilterState['source'];
                // The TeamSpeak-only filters mean nothing for web rows; they are dropped with the source.
                patch(source === 'web' ? { source, server: 'all', online: false } : { source });
              }}
            >
              <SelectTrigger className="h-9 w-[150px]" aria-label={t('pages.connectionJournal.filters.source')}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('pages.connectionJournal.filters.anySource')}</SelectItem>
                {JOURNAL_SOURCES.map((s) => <SelectItem key={s} value={s}>{t(`pages.connectionJournal.source.${s}`)}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.event} onValueChange={(v) => patch({ event: v as JournalFilterState['event'] })}>
              <SelectTrigger className="h-9 w-[170px]" aria-label={t('pages.connectionJournal.filters.event')}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('pages.connectionJournal.filters.anyEvent')}</SelectItem>
                {JOURNAL_EVENTS.map((e) => <SelectItem key={e} value={e}>{t(`pages.connectionJournal.event.${e}`)}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filters.result} onValueChange={(v) => patch({ result: v as JournalFilterState['result'] })}>
              <SelectTrigger className="h-9 w-[150px]" aria-label={t('pages.connectionJournal.filters.result')}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('pages.connectionJournal.filters.anyResult')}</SelectItem>
                {JOURNAL_RESULTS.map((r) => <SelectItem key={r} value={r}>{t(`pages.connectionJournal.result.${r}`)}</SelectItem>)}
              </SelectContent>
            </Select>

            {showsTs && servers && servers.length > 1 && (
              <Select value={String(filters.server)} onValueChange={(v) => patch({ server: v === 'all' ? 'all' : Number(v) })}>
                <SelectTrigger className="h-9 w-[170px]" aria-label={t('pages.connectionJournal.filters.server')}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('pages.connectionJournal.filters.anyServer')}</SelectItem>
                  {servers.map((s: { id: number; name: string }) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}

            {showsTs && (
              <div className="flex items-center gap-2 px-1">
                <Switch id="journal-online" checked={filters.online} onCheckedChange={(v) => patch({ online: v })} />
                <Label htmlFor="journal-online" className="text-xs">{t('pages.connectionJournal.filters.onlineNow')}</Label>
              </div>
            )}

            {filters.ip && (
              <Badge variant="default" className="gap-1 h-9 px-3" data-testid="journal-ip-chip">
                <span className="font-mono-data">{filters.ip}</span>
                <button type="button" aria-label={t('pages.connectionJournal.filters.removeAddress')} onClick={() => patch({ ip: '' })}>
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}

            {filtered && (
              <Button variant="ghost" size="sm" onClick={() => { setFilters(DEFAULT_FILTERS); setSearch(''); }}>
                {t('pages.connectionJournal.filters.reset')}
              </Button>
            )}
          </div>
        )}

        <TabsContent value="journal" className="mt-4">
          <JournalList filters={filters} onFilterIp={(ip) => patch({ ip })} />
        </TabsContent>
        <TabsContent value="by-ip" className="mt-4">
          <JournalByIp filters={filters} onFilterIp={showAddress} />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <JournalSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
