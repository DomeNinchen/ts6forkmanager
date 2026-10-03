import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClientDbProfile } from '@ts6/common';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  buildExportFile, defaultDelimiter, downloadExport, exportFilename, formatExportDate,
  type CsvDelimiter, type ExportColumn, type ExportDateFormat, type ExportEncoding, type ExportFormat,
} from '@/lib/client-database-export';

type ExportScope = 'selected' | 'visible' | 'loaded' | 'database';

const FORMATS: ExportFormat[] = ['csv', 'html', 'json'];
const ENCODINGS: ExportEncoding[] = ['utf8-bom', 'utf8', 'utf16le'];
const DELIMITERS: { value: CsvDelimiter; key: string }[] = [
  { value: ',', key: 'comma' }, { value: ';', key: 'semicolon' }, { value: '\t', key: 'tab' },
];
const DATE_FORMATS: ExportDateFormat[] = ['iso-local', 'iso-utc', 'locale', 'unix'];

interface ClientDbExportDialogProps {
  /** Mounted only while the dialog is open. */
  sid: number;
  /** What the current column view shows, ready to export (headers translated, group columns included). */
  columns: ExportColumn<ClientDbProfile>[];
  selected: ClientDbProfile[];
  /** Every row the table shows, across its pages, after the text filter and the sort. */
  visible: ClientDbProfile[];
  loaded: ClientDbProfile[];
  /** Profiles in the whole database. */
  total: number;
  /** Reads every block that is still missing, reporting how many profiles are loaded, and returns them all. Stops early when asked. */
  loadWholeDatabase: (onProgress: (loaded: number) => void, shouldStop: () => boolean) => Promise<ClientDbProfile[]>;
  onClose: () => void;
}

export function ClientDbExportDialog({
  sid, columns, selected, visible, loaded, total, loadWholeDatabase, onClose,
}: ClientDbExportDialogProps) {
  const { t, i18n } = useTranslation();
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [encoding, setEncoding] = useState<ExportEncoding>('utf8-bom');
  const [delimiter, setDelimiter] = useState<CsvDelimiter>(() => defaultDelimiter(i18n.language));
  const [dateFormat, setDateFormat] = useState<ExportDateFormat>('iso-local');
  const [scope, setScope] = useState<ExportScope>(selected.length > 0 ? 'selected' : 'visible');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const stop = useRef(false);

  const counts: Record<ExportScope, number> = { selected: selected.length, visible: visible.length, loaded: loaded.length, database: total };
  const sampleSeconds = Math.floor(Date.now() / 1000);

  const run = async () => {
    setBusy(true);
    stop.current = false;
    try {
      let rows: ClientDbProfile[];
      if (scope === 'database') {
        rows = await loadWholeDatabase((n) => setProgress(n), () => stop.current);
        if (stop.current) return;
      } else {
        rows = scope === 'selected' ? selected : scope === 'visible' ? visible : loaded;
      }
      const options = { format, encoding, delimiter, dateFormat, locale: i18n.language };
      const file = buildExportFile(rows, columns, options, {
        title: t('pages.clientDatabase.export.htmlTitle'),
        subtitle: t('pages.clientDatabase.export.htmlSubtitle', {
          sid, count: rows.length, date: new Date().toLocaleString(i18n.language),
        }),
        lang: i18n.language,
      });
      downloadExport(file, exportFilename(sid, format));
      toast.success(t('pages.clientDatabase.export.done', { count: rows.length }));
      onClose();
    } catch {
      toast.error(t('pages.clientDatabase.export.failed'));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const cancel = () => {
    stop.current = true;
    if (!busy) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) cancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('pages.clientDatabase.export.title')}</DialogTitle>
          <DialogDescription>{t('pages.clientDatabase.export.columnsHint', { columns: columns.map((c) => c.header).join(', ') })}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">{t('pages.clientDatabase.export.format')}</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as ExportFormat)} disabled={busy}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FORMATS.map((f) => <SelectItem key={f} value={f}>{t(`pages.clientDatabase.export.formats.${f}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{t('pages.clientDatabase.export.encoding')}</Label>
            <Select value={format === 'json' ? 'utf8' : encoding} onValueChange={(v) => setEncoding(v as ExportEncoding)} disabled={busy || format === 'json'}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ENCODINGS.map((e) => <SelectItem key={e} value={e}>{t(`pages.clientDatabase.export.encodings.${e}`)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {format === 'csv' && (
            <div>
              <Label className="text-xs">{t('pages.clientDatabase.export.delimiter')}</Label>
              <Select value={delimiter} onValueChange={(v) => setDelimiter(v as CsvDelimiter)} disabled={busy}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DELIMITERS.map((d) => <SelectItem key={d.key} value={d.value}>{t(`pages.clientDatabase.export.delimiters.${d.key}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label className="text-xs">{t('pages.clientDatabase.export.dateFormat')}</Label>
            <Select value={dateFormat} onValueChange={(v) => setDateFormat(v as ExportDateFormat)} disabled={busy}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DATE_FORMATS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {t(`pages.clientDatabase.export.dateFormats.${f}`)} - {String(formatExportDate(sampleSeconds, f, i18n.language))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label className="text-xs">{t('pages.clientDatabase.export.scope')}</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as ExportScope)} disabled={busy}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(['selected', 'visible', 'loaded', 'database'] as ExportScope[]).map((s) => (
                  <SelectItem key={s} value={s} disabled={s === 'selected' && selected.length === 0}>
                    {t(`pages.clientDatabase.export.scopes.${s}`, { count: counts[s] })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {scope === 'database' && loaded.length < total && (
              <p className="mt-1 text-xs text-muted-foreground">{t('pages.clientDatabase.export.databaseHint')}</p>
            )}
          </div>
        </div>
        {format === 'json' && <p className="text-xs text-muted-foreground">{t('pages.clientDatabase.export.jsonNote')}</p>}

        <DialogFooter>
          {busy && progress !== null && (
            <span className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('pages.clientDatabase.export.loading', { loaded: progress, total })}
            </span>
          )}
          <Button variant="outline" onClick={cancel}>{busy ? t('pages.clientDatabase.stop') : t('common.cancel')}</Button>
          <Button onClick={run} disabled={busy || counts[scope] === 0}>
            {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
            {t('pages.clientDatabase.export.run')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
