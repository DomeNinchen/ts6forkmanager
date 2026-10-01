import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClientDbSearchMode, ClientDbSearchParams } from '@ts6/common';
import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { orderChannels } from './format';

const MODES: ClientDbSearchMode[] = ['name', 'uid', 'dbid', 'custom', 'channelgroup'];
/** Radix selects cannot hold an empty value, so "no filter" gets a name of its own. */
const ANY = 'any';

interface ClientDbSearchBarProps {
  /** A server-side search is currently shown instead of the list. */
  active: boolean;
  busy: boolean;
  channels: any[];
  channelGroups: any[];
  onSearch: (params: ClientDbSearchParams) => void;
  onClear: () => void;
}

export function ClientDbSearchBar({ active, busy, channels, channelGroups, onSearch, onClear }: ClientDbSearchBarProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ClientDbSearchMode>('name');
  const [text, setText] = useState('');
  const [ident, setIdent] = useState('');
  const [cid, setCid] = useState(ANY);
  const [cgid, setCgid] = useState(ANY);

  const channelOptions = useMemo(() => orderChannels(channels), [channels]);
  // Regular groups only: template groups (type 0) are never assigned to anyone, query groups (type 2) are not channel groups in use.
  const groupOptions = useMemo(() => channelGroups.filter((g: any) => Number(g.type) === 1), [channelGroups]);

  const canSearch = (() => {
    switch (mode) {
      case 'name':
      case 'uid': return text.trim().length > 0;
      case 'dbid': return /^\d+$/.test(text.trim()) && Number(text.trim()) > 0;
      case 'custom': return ident.trim().length > 0;
      case 'channelgroup': return true;
    }
  })();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSearch || busy) return;
    const params: ClientDbSearchParams = { mode };
    if (mode === 'name' || mode === 'uid' || mode === 'dbid') params.query = text.trim();
    if (mode === 'custom') {
      params.ident = ident.trim();
      if (text.trim()) params.query = text.trim();
    }
    if (mode === 'channelgroup') {
      if (cid !== ANY) params.cid = Number(cid);
      if (cgid !== ANY) params.cgid = Number(cgid);
    }
    onSearch(params);
  };

  const clear = () => {
    setText('');
    setIdent('');
    setCid(ANY);
    setCgid(ANY);
    onClear();
  };

  return (
    <form onSubmit={submit} className="card-hero rounded-md border border-border bg-card p-3 space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-44">
          <Label className="text-xs">{t('pages.clientDatabase.search.mode')}</Label>
          <Select value={mode} onValueChange={(v) => setMode(v as ClientDbSearchMode)}>
            <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MODES.map((m) => <SelectItem key={m} value={m}>{t(`pages.clientDatabase.search.modes.${m}`)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {mode === 'custom' && (
          <div className="w-48">
            <Label className="text-xs">{t('pages.clientDatabase.search.identifier')}</Label>
            <Input
              className="mt-1 h-9"
              value={ident}
              onChange={(e) => setIdent(e.target.value)}
              placeholder={t('pages.clientDatabase.search.placeholders.ident')}
            />
          </div>
        )}

        {mode !== 'channelgroup' && (
          <div className="min-w-56 flex-1">
            <Label className="text-xs">{mode === 'custom' ? t('pages.clientDatabase.search.value') : t('pages.clientDatabase.search.query')}</Label>
            <Input
              className="mt-1 h-9"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t(`pages.clientDatabase.search.placeholders.${mode}`)}
              inputMode={mode === 'dbid' ? 'numeric' : undefined}
            />
          </div>
        )}

        {mode === 'channelgroup' && (
          <>
            <div className="w-56">
              <Label className="text-xs">{t('pages.clientDatabase.search.channel')}</Label>
              <Select value={cid} onValueChange={setCid}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>{t('pages.clientDatabase.search.allChannels')}</SelectItem>
                  {channelOptions.map((ch) => (
                    <SelectItem key={ch.cid} value={String(ch.cid)}>
                      {`${' '.repeat(ch.depth)}${ch.name}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-56">
              <Label className="text-xs">{t('pages.clientDatabase.search.group')}</Label>
              <Select value={cgid} onValueChange={setCgid}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>{t('pages.clientDatabase.search.anyGroup')}</SelectItem>
                  {groupOptions.map((g: any) => <SelectItem key={g.cgid} value={String(g.cgid)}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        <Button type="submit" size="sm" className="h-9" disabled={!canSearch || busy}>
          <Search className="h-4 w-4 mr-1" /> {t('pages.clientDatabase.search.run')}
        </Button>
        {active && (
          <Button type="button" size="sm" variant="outline" className="h-9" onClick={clear}>
            <X className="h-4 w-4 mr-1" /> {t('pages.clientDatabase.search.clear')}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t(`pages.clientDatabase.search.hints.${mode}`)}</p>
    </form>
  );
}
