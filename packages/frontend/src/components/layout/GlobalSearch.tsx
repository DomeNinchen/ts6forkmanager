import { useEffect, useId, useMemo, useState, type ComponentProps } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/stores/ui.store';
import { useAuthStore } from '@/stores/auth.store';
import { settingsTabsFor } from '@/lib/settings-tabs';
import { searchEntries, pushRecent } from '@/lib/search';
import { useVisibleNavSections } from './Sidebar';
import { useSearchObjects, useOfflineClientSearch, type SearchEntry as Entry } from './use-search-objects';

/** Shortcut: at most this many hits per kind of server object; upgrade to "show more" if real servers need it. */
const OBJECTS_PER_TYPE = 8;

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Where focus goes back to on close: the search has no Radix trigger, so Radix cannot do it itself. */
let returnFocus: HTMLElement | null = null;

function setOpenFromHere(open: boolean) {
  if (open) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  useUiStore.getState().setSearchOpen(open);
}

/** Ctrl/Cmd+K opens and closes the search from anywhere - but not over another open dialog. */
export function useGlobalSearchShortcut() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'k' || !(isMac ? e.metaKey : e.ctrlKey) || e.altKey || e.shiftKey) return;
      const { searchOpen } = useUiStore.getState();
      if (!searchOpen && document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      e.preventDefault();
      setOpenFromHere(!searchOpen);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/** The visible way in: a search field look-alike with the shortcut on wide screens, an icon on narrow ones. */
export function GlobalSearchButton({ className, onOpen, ...props }: ComponentProps<typeof Button> & { onOpen?: () => void }) {
  const { t } = useTranslation();
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={t('nav.search.open')}
      aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
      className={cn('h-8 gap-2', className)}
      onClick={() => { onOpen?.(); setOpenFromHere(true); }}
      {...props}
    >
      <Search className="h-4 w-4 shrink-0" />
      <span className="hidden text-xs sm:inline">{t('nav.search.open')}</span>
      <kbd className="hidden rounded border border-current/25 px-1 font-mono text-[10px] opacity-70 md:inline">
        {isMac ? '⌘K' : `${t('nav.search.ctrl')}+K`}
      </kbd>
    </Button>
  );
}

const recentKey = (userId: number | undefined) => `ts6-search-recent:${userId ?? 0}`;

function readRecent(userId: number | undefined): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(recentKey(userId)) ?? '[]');
    return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** The search window; mounted once in AppLayout, opened through the ui store. */
export function GlobalSearch() {
  const { t, i18n } = useTranslation();
  const open = useUiStore((s) => s.searchOpen);
  const setOpen = useUiStore((s) => s.setSearchOpen);
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.user?.id);
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const sections = useVisibleNavSections();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const baseId = useId();

  // Only what this user may open right now: the sidebar's own filtered pages and the Settings tabs of the role.
  const entries = useMemo<Entry[]>(() => {
    const en = i18n.getFixedT('en');
    const settings = t('common.settings');
    return [
      ...sections.flatMap((section) => section.items.map((item) => ({
        id: `page:${item.to}`,
        terms: [item.label, item.enLabel, section.label, section.enLabel],
        label: item.label,
        hint: section.label,
        icon: item.icon,
        to: item.to,
      }))),
      ...settingsTabsFor(isAdmin).map((tab) => ({
        id: `settings:${tab.value}`,
        terms: [t(tab.labelKey), en(tab.labelKey), settings, en('common.settings')],
        label: t(tab.labelKey),
        hint: settings,
        icon: tab.icon,
        to: `/settings?tab=${tab.value}`,
      })),
    ];
  }, [sections, isAdmin, t, i18n]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    setRecent(readRecent(userId));
  }, [open, userId]);

  // Keyed on the paths as text: `sections` is a new array on every render.
  const pagesKey = sections.flatMap((s) => s.items.map((i) => i.to)).join(' ');
  const visiblePages = useMemo(() => new Set(pagesKey.split(' ')), [pagesKey]);
  const objects = useSearchObjects(open, visiblePages);
  const onlineIds = useMemo(() => new Set(objects.groups.find((g) => g.key === 'clients')?.items.map((i) => i.id)), [objects.groups]);
  const offline = useOfflineClientSearch(open, query, visiblePages, onlineIds);

  const groups = useMemo(() => {
    const typed = query.trim() !== '';
    // A recent entry shows only while it still exists and is still allowed: a deleted channel or a lost right drops it.
    const byId = new Map([...entries, ...objects.groups.flatMap((g) => g.items)].map((e) => [e.id, e]));
    const found = searchEntries(entries, query);
    const recentEntries = typed ? [] : recent.map((id) => byId.get(id)).filter((e): e is Entry => !!e);
    return [
      { key: 'recent', label: t('nav.search.recent'), items: recentEntries },
      { key: 'pages', label: t('nav.search.pages'), items: found.filter((e) => e.id.startsWith('page:')) },
      { key: 'settings', label: t('common.settings'), items: found.filter((e) => e.id.startsWith('settings:')) },
      // Server objects only once something is typed; an empty search stays short.
      // The offline clients follow the online ones; TeamSpeak's name search already filtered and capped them.
      ...(typed ? objects.groups.flatMap((g) => {
        const hits = { ...g, items: searchEntries(g.items, query, OBJECTS_PER_TYPE) };
        return g.key === 'clients' ? [hits, offline.group] : [hits];
      }) : []),
    ].filter((g) => g.items.length > 0);
  }, [entries, objects.groups, offline.group, query, recent, t]);

  const flat = groups.flatMap((g) => g.items.map((item) => ({ item, optionId: `${baseId}-${g.key}-${item.id}` })));
  const current = flat[Math.min(active, flat.length - 1)];

  useEffect(() => {
    if (current) document.getElementById(current.optionId)?.scrollIntoView({ block: 'nearest' });
  }, [current?.optionId]);

  const choose = (entry: Entry) => {
    // Offline profiles are in no loaded list, so a recent entry could not be shown again without asking TeamSpeak.
    if (!entry.id.startsWith('offline')) {
      const next = pushRecent(readRecent(userId), entry.id);
      try { localStorage.setItem(recentKey(userId), JSON.stringify(next)); } catch { /* private mode: just no history */ }
    }
    setOpen(false);
    navigate(entry.to);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (flat.length === 0) return;
    const move = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (move) {
      e.preventDefault();
      setActive((a) => (Math.min(a, flat.length - 1) + move + flat.length) % flat.length);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setActive(e.key === 'Home' ? 0 : flat.length - 1);
    } else if (e.key === 'Enter' && current) {
      e.preventDefault();
      choose(current.item);
    }
  };

  const listId = `${baseId}-list`;
  let index = -1;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        onCloseAutoFocus={(e) => {
          // The opener may be gone (the phone drawer closes first); then the drawer's own menu button takes it.
          const target = returnFocus?.isConnected ? returnFocus : document.querySelector<HTMLElement>('[data-mobile-nav-trigger]');
          if (target) { e.preventDefault(); target.focus(); }
        }}
        className="top-[12vh] max-w-xl translate-y-0 gap-0 overflow-hidden p-0 data-[state=closed]:slide-out-to-top-[10vh] data-[state=open]:slide-in-from-top-[10vh] max-sm:w-[calc(100vw-2rem)]"
      >
        <DialogTitle className="sr-only">{t('nav.search.title')}</DialogTitle>
        <DialogDescription className="sr-only">{t('nav.search.hint')}</DialogDescription>
        <div className="flex items-center gap-2 border-b border-border px-3 pr-10">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={current?.optionId}
            aria-label={t('nav.search.title')}
            autoComplete="off"
            spellCheck={false}
            value={query}
            placeholder={t('nav.search.placeholder')}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
            className="h-12 w-full bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
          />
        </div>
        <div id={listId} role="listbox" aria-label={t('nav.search.title')} className="max-h-[60vh] overflow-y-auto p-2">
          {flat.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t('nav.search.empty')}</p>}
          {groups.map((group) => (
            <div key={group.key} role="group" aria-labelledby={`${baseId}-${group.key}`} className="mb-1">
              <div id={`${baseId}-${group.key}`} className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </div>
              {group.items.map((item) => {
                index += 1;
                const i = index;
                const optionId = `${baseId}-${group.key}-${item.id}`;
                const selected = current?.optionId === optionId;
                return (
                  <div
                    key={optionId}
                    id={optionId}
                    role="option"
                    aria-selected={selected}
                    onMouseMove={() => setActive(i)}
                    onClick={() => choose(item)}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm',
                      selected ? 'bg-accent text-accent-foreground' : 'text-foreground',
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{item.label}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{item.hint}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {/* Always in the tree, so screen readers hear the text when it appears. */}
        <p aria-live="polite" className={cn('px-3 text-xs text-muted-foreground', offline.searching && 'border-t border-border py-2')}>
          {offline.searching ? t('nav.search.searchingDatabase') : ''}
        </p>
        {objects.noWebQuery && (
          <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">{t('nav.search.noWebQuery')}</p>
        )}
        <div className="hidden border-t border-border px-3 py-2 text-xs text-muted-foreground sm:block" aria-hidden>
          {t('nav.search.hint')}
        </div>
      </DialogContent>
    </Dialog>
  );
}
