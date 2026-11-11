import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, KeyRound, FileUp } from 'lucide-react';
import {
  checkFlowTemplate, parseFlowTemplate,
  type FlowTemplateFile, type FlowTemplateTarget, type FlowTemplateWarning,
} from '@ts6/common';
import { botsApi } from '@/api/bots.api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';

function nodeLabel(template: FlowTemplateFile, target: FlowTemplateTarget): string {
  const node = template.flow.nodes.find((n) => n.id === target.node);
  return `${node?.label || node?.type || target.node}: ${target.field}`;
}

function TargetList({ template, items, icon: Icon, title }: { template: FlowTemplateFile; items: (FlowTemplateTarget | FlowTemplateWarning)[]; icon: React.ElementType; title: string }) {
  const { t } = useTranslation();
  if (!items.length) return null;
  return (
    <div className="rounded-md border border-warning/40 bg-warning/5 p-3 space-y-1">
      <p className="text-xs font-medium flex items-center gap-1.5"><Icon className="h-3.5 w-3.5" aria-hidden /> {title}</p>
      <ul className="text-xs text-muted-foreground space-y-0.5 max-h-32 overflow-y-auto">
        {items.map((item, i) => (
          <li key={i}>
            {nodeLabel(template, item)}
            {'reason' in item && <span className="ml-1 opacity-80">({t(`components.flowTemplates.reasons.${item.reason}`)})</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ExportTemplateDialog({ botId, onOpenChange }: { botId: number | null; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['bot-export', botId],
    queryFn: () => botsApi.exportTemplate(botId!),
    enabled: botId !== null,
    gcTime: 0,
  });
  const [meta, setMeta] = useState({ id: '', name: '', version: '', author: '', description: '' });
  useEffect(() => {
    if (data) setMeta({ id: data.template.id, name: data.template.name, version: data.template.version, author: data.template.author ?? '', description: data.template.description ?? '' });
  }, [data]);

  const download = () => {
    if (!data) return;
    const template: FlowTemplateFile = { ...data.template, id: meta.id.trim(), name: meta.name.trim(), version: meta.version.trim() };
    if (meta.author.trim()) template.author = meta.author.trim(); else delete template.author;
    if (meta.description.trim()) template.description = meta.description.trim(); else delete template.description;
    const check = checkFlowTemplate(template);
    if (!check.ok) { toast.error(check.errors.join('\n')); return; }
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${template.id}-${template.version}.ts6flow.json`;
    a.click();
    URL.revokeObjectURL(url);
    onOpenChange(false);
  };

  const field = (key: keyof typeof meta, label: string, placeholder?: string) => (
    <div>
      <Label htmlFor={`tpl-export-${key}`} className="text-xs">{label}</Label>
      <Input id={`tpl-export-${key}`} value={meta[key]} placeholder={placeholder} onChange={(e) => setMeta({ ...meta, [key]: e.target.value })} />
    </div>
  );

  return (
    <Dialog open={botId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('components.flowTemplates.exportTitle')}</DialogTitle>
          <DialogDescription>{t('components.flowTemplates.exportHint')}</DialogDescription>
        </DialogHeader>
        {isLoading && <p className="text-sm text-muted-foreground">{t('common.loading')}</p>}
        {isError && <p className="text-sm text-destructive">{t('components.flowTemplates.exportFailed')}</p>}
        {data && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {field('name', t('common.name'))}
              {field('id', t('components.flowTemplates.id'), 'my-flow')}
              {field('version', t('components.flowTemplates.version'), '1.0.0')}
              {field('author', t('components.flowTemplates.author'))}
            </div>
            <div>
              <Label htmlFor="tpl-export-description" className="text-xs">{t('common.description')}</Label>
              <Textarea id="tpl-export-description" rows={2} value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} />
            </div>
            <p className="text-xs text-muted-foreground">
              {t('components.flowTemplates.summary', { nodes: data.template.flow.nodes.length, inputs: data.template.inputs.length })}
            </p>
            <TargetList template={data.template} items={data.template.secrets} icon={KeyRound} title={t('components.flowTemplates.secretsRemoved')} />
            <TargetList template={data.template} items={data.warnings} icon={AlertTriangle} title={t('components.flowTemplates.warningsTitle')} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button onClick={download} disabled={!data}>{t('components.flowTemplates.download')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ImportTemplateDialog({ open, onOpenChange, serverConfigId, sid, onImported }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverConfigId: number | null;
  sid: number;
  onImported: (botId: number) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!open) { setText(null); setFileName(''); } }, [open]);

  const check = text === null ? null : parseFlowTemplate(text);
  const template = check?.ok ? check.template : null;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setText(await file.text());
  };

  const submit = async () => {
    if (!template || text === null || serverConfigId === null) return;
    setBusy(true);
    try {
      const res = await botsApi.importTemplate({ file: text, serverConfigId, virtualServerId: sid });
      toast.success(t('components.flowTemplates.imported', { name: res.name }));
      onOpenChange(false);
      onImported(res.id);
    } catch (err: any) {
      const details: string[] = err?.response?.data?.details ?? [];
      toast.error([err?.response?.data?.error ?? t('components.flowTemplates.importFailed'), ...details].join('\n'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('components.flowTemplates.importTitle')}</DialogTitle>
          <DialogDescription>{t('components.flowTemplates.importHint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="tpl-import-file" className="text-xs">{t('components.flowTemplates.file')}</Label>
            <Input id="tpl-import-file" type="file" accept=".json,application/json" onChange={(e) => pick(e.target.files?.[0])} />
          </div>
          {check && !check.ok && (
            <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <p className="text-xs font-medium text-destructive">{t('components.flowTemplates.invalid', { file: fileName })}</p>
              <ul className="mt-1 text-xs text-muted-foreground list-disc pl-4 max-h-40 overflow-y-auto">
                {check.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
          {template && (
            <div className="space-y-3">
              <div className="rounded-md border p-3 text-xs space-y-1">
                <p className="font-medium text-sm flex items-center gap-1.5"><FileUp className="h-4 w-4" aria-hidden /> {template.name} <span className="text-muted-foreground font-normal">v{template.version}</span></p>
                {template.author && <p className="text-muted-foreground">{t('components.flowTemplates.byAuthor', { author: template.author })}</p>}
                {template.description && <p className="text-muted-foreground whitespace-pre-line">{template.description}</p>}
                <p className="text-muted-foreground">{t('components.flowTemplates.summary', { nodes: template.flow.nodes.length, inputs: template.inputs.length })}</p>
              </div>
              <p className="text-xs text-muted-foreground">{t('components.flowTemplates.importDisabledNote')}</p>
              <TargetList template={template} items={template.secrets} icon={KeyRound} title={t('components.flowTemplates.secretsToEnter')} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button onClick={submit} disabled={!template || busy || serverConfigId === null}>{t('components.flowTemplates.import')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
