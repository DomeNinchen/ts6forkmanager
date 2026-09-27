import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { logsApi } from '@/api/bans.api';
import { useServerStore } from '@/stores/server.store';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ScrollText, RefreshCw, Search, ChevronLeft, ChevronRight, Download, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const LEVEL_COLORS: Record<string, string> = {
  ERROR: 'text-destructive bg-destructive/10 border-destructive/20',
  WARNING: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
  INFO: 'text-blue-500 bg-blue-500/10 border-blue-500/20',
  DEBUG: 'text-muted-foreground bg-muted/50 border-border/50',
};

function parseLevel(line: string): string {
  if (line.includes('|ERROR')) return 'ERROR';
  if (line.includes('|WARNING')) return 'WARNING';
  if (line.includes('|INFO')) return 'INFO';
  if (line.includes('|DEBUG')) return 'DEBUG';
  return 'INFO';
}

export default function ServerLogs() {
  const { t } = useTranslation();
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  const qc = useQueryClient();
  const [lines, setLines] = useState('100');
  const [filter, setFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('ALL');
  const [instance, setInstance] = useState(false);
  const [beginPos, setBeginPos] = useState(0);
  const [showAddEntry, setShowAddEntry] = useState(false);
  const [addLevel, setAddLevel] = useState('4');
  const [addMsg, setAddMsg] = useState('');

  const linesNum = parseInt(lines);
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['logs', c, s, lines, instance, beginPos],
    queryFn: () => logsApi.get(c!, s!, { lines: linesNum, beginPos, instance }),
    enabled: !!c && !!s,
  });

  const addEntry = useMutation({
    mutationFn: () => logsApi.add(c!, s!, parseInt(addLevel), addMsg.trim()),
    onSuccess: () => {
      toast.success(t('pages.serverLogs.entryAdded'));
      setShowAddEntry(false);
      setAddMsg('');
      qc.invalidateQueries({ queryKey: ['logs', c, s] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.details || err?.response?.data?.error || t('pages.serverLogs.addFailed')),
  });

  const rawEntries = Array.isArray(data) ? data : [];
  const logs = useMemo(() => {
    return rawEntries
      .map((entry: any) => {
        const line = typeof entry === 'string' ? entry : entry.l || entry.msg || JSON.stringify(entry);
        return { raw: line, level: parseLevel(line) };
      })
      .filter((entry) => {
        if (levelFilter !== 'ALL' && entry.level !== levelFilter) return false;
        if (filter && !entry.raw.toLowerCase().includes(filter.toLowerCase())) return false;
        return true;
      });
  }, [rawEntries, filter, levelFilter]);

  const handleExport = (format: 'txt' | 'html') => {
    const lines = logs.map((l) => l.raw);
    const blob = format === 'txt'
      ? new Blob([lines.join('\n')], { type: 'text/plain' })
      : new Blob([
          `<!doctype html><html><head><meta charset="utf-8"><title>Server Log Export</title></head><body><pre>${
            lines.map((l) => l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')).join('\n')
          }</pre></body></html>`,
        ], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${instance ? 'instance' : 'server'}-log-${new Date().toISOString().slice(0, 10)}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!c || !s) return <EmptyState icon={ScrollText} title={t('pages.noServerSelected')} />;
  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('nav.items.serverLogs')}</h1>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowAddEntry(true)}>
            <Plus className="h-4 w-4 mr-1" /> {t('pages.serverLogs.addEntry')}
          </Button>
          <Select onValueChange={(v) => handleExport(v as 'txt' | 'html')}>
            <SelectTrigger className="h-9 text-xs w-[110px]"><Download className="h-3.5 w-3.5 mr-1" /><SelectValue placeholder={t('pages.serverLogs.export')} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="txt">{t('pages.serverLogs.asTxt')}</SelectItem>
              <SelectItem value="html">{t('pages.serverLogs.asHtml')}</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn('h-4 w-4 mr-1', isFetching && 'animate-spin')} /> {t('common.refresh')}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder={t('pages.serverLogs.filterPlaceholder')} value={filter} onChange={(e) => setFilter(e.target.value)} className="pl-8 h-9" />
        </div>
        <Select value={instance ? 'instance' : 'server'} onValueChange={(v) => { setInstance(v === 'instance'); setBeginPos(0); }}>
          <SelectTrigger className="w-[140px] h-9 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="server">{t('pages.serverLogs.thisServer')}</SelectItem>
            <SelectItem value="instance">{t('pages.serverLogs.instanceLog')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={levelFilter} onValueChange={setLevelFilter}>
          <SelectTrigger className="w-[130px] h-9 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t('pages.serverLogs.allLevels')}</SelectItem>
            <SelectItem value="ERROR">{t('pages.serverLogs.levelError')}</SelectItem>
            <SelectItem value="WARNING">{t('pages.serverLogs.levelWarning')}</SelectItem>
            <SelectItem value="INFO">{t('pages.serverLogs.levelInfo')}</SelectItem>
            <SelectItem value="DEBUG">{t('pages.serverLogs.levelDebug')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={lines} onValueChange={(v) => { setLines(v); setBeginPos(0); }}>
          <SelectTrigger className="w-[120px] h-9 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="25">{t('pages.serverLogs.nLines', { count: 25 })}</SelectItem>
            <SelectItem value="50">{t('pages.serverLogs.nLines', { count: 50 })}</SelectItem>
            <SelectItem value="100">{t('pages.serverLogs.nLines', { count: 100 })}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="card-hero rounded-md border border-border bg-card overflow-hidden shadow-xs">
        <ScrollArea className="h-[calc(100vh-260px)]">
          <div className="p-3 space-y-0.5">
            {logs.length === 0 ? (
              <p className="text-center text-muted-foreground text-sm py-10">{t('pages.serverLogs.noEntriesFound')}</p>
            ) : (
              logs.map((entry, i) => (
                <div key={i} className="flex items-start gap-2 py-0.5 group hover:bg-muted/10 rounded-sm px-1">
                  <span className={cn('text-[10px] px-1.5 py-0.5 rounded-sm border shrink-0 font-mono-data uppercase tracking-wider mt-0.5', LEVEL_COLORS[entry.level] || LEVEL_COLORS.INFO)}>
                    {entry.level.slice(0, 3)}
                  </span>
                  <span className="text-xs font-mono-data text-muted-foreground leading-relaxed break-all">
                    {entry.raw}
                  </span>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {t('pages.serverLogs.entriesShown', { count: logs.length })}
          {beginPos > 0 && ` · ${t('pages.serverLogs.skippingFirst', { count: beginPos })}`}
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setBeginPos((p) => Math.max(0, p - linesNum))} disabled={beginPos === 0}>
            <ChevronLeft className="h-3.5 w-3.5 mr-1" /> {t('pages.serverLogs.newer')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setBeginPos((p) => p + linesNum)} disabled={rawEntries.length < linesNum}>
            {t('pages.serverLogs.older')} <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </div>
      </div>

      {/* Add Log Entry Dialog */}
      <Dialog open={showAddEntry} onOpenChange={setShowAddEntry}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('pages.serverLogs.addEntry')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">{t('pages.serverLogs.level')}</Label>
              <Select value={addLevel} onValueChange={setAddLevel}>
                <SelectTrigger className="h-9 text-xs mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">{t('pages.serverLogs.levelError')}</SelectItem>
                  <SelectItem value="2">{t('pages.serverLogs.levelWarning')}</SelectItem>
                  <SelectItem value="3">{t('pages.serverLogs.levelDebug')}</SelectItem>
                  <SelectItem value="4">{t('pages.serverLogs.levelInfo')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t('pages.messages.message')}</Label>
              <Textarea value={addMsg} onChange={(e) => setAddMsg(e.target.value)} rows={2} className="mt-1" autoFocus />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddEntry(false)}>{t('common.cancel')}</Button>
            <Button onClick={() => addEntry.mutate()} disabled={!addMsg.trim() || addEntry.isPending}>{t('common.add')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
