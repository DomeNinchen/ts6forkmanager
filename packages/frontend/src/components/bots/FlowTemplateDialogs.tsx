import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, KeyRound, FileUp, RefreshCw, ShieldAlert } from 'lucide-react';
import {
  checkFlowTemplate, flowCapabilities, parseFlowTemplate, FLOW_TEMPLATE_OBJECT_TYPES,
  type FlowCapability, type FlowDiff, type FlowTemplateFile, type FlowTemplateInput, type FlowTemplateInputType,
  type FlowTemplateTarget, type FlowTemplateUpdate, type FlowTemplateWarning,
} from '@ts6/common';
import { botsApi } from '@/api/bots.api';
import { channelsApi } from '@/api/channels.api';
import { groupsApi } from '@/api/groups.api';
import { musicBotsApi } from '@/api/music.api';
import { useBot } from '@/hooks/use-bots';
import { TestPanel } from '@/components/bots/TestPanel';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';

type ObjectType = 'channel' | 'servergroup' | 'channelgroup' | 'bot';
type ServerObject = { id: string; name: string };
const isObjectType = (type: FlowTemplateInputType): type is ObjectType => FLOW_TEMPLATE_OBJECT_TYPES.includes(type);

/** Channels, regular groups and music bots of one virtual server, as id + name (same query keys as the pages, so loaded lists are reused). */
function useServerObjects(configId: number | null, sid: number, enabled: boolean): Partial<Record<ObjectType, ServerObject[]>> {
  const on = enabled && configId !== null;
  const regular = (g: any) => String(g.type) === '1';
  const channels = useQuery({ queryKey: ['channels', configId, sid], queryFn: () => channelsApi.list(configId!, sid), enabled: on });
  const serverGroups = useQuery({ queryKey: ['server-groups', configId, sid], queryFn: () => groupsApi.serverGroups(configId!, sid), enabled: on });
  const channelGroups = useQuery({ queryKey: ['channel-groups', configId, sid], queryFn: () => groupsApi.channelGroups(configId!, sid), enabled: on });
  const bots = useQuery({ queryKey: ['music-bots'], queryFn: musicBotsApi.list, enabled: on });
  return useMemo(() => ({
    channel: (channels.data as any[] | undefined)?.map((c) => ({ id: String(c.cid), name: String(c.channel_name ?? '') })),
    servergroup: (serverGroups.data as any[] | undefined)?.filter(regular).map((g) => ({ id: String(g.sgid), name: String(g.name ?? '') })),
    channelgroup: (channelGroups.data as any[] | undefined)?.filter(regular).map((g) => ({ id: String(g.cgid), name: String(g.name ?? '') })),
    bot: (bots.data as any[] | undefined)?.filter((b) => b.serverConfigId === configId).map((b) => ({ id: String(b.id), name: String(b.name ?? '') })),
  }), [channels.data, serverGroups.data, channelGroups.data, bots.data, configId]);
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The import's starting value: server objects picked by name (never by the old id), other inputs their default. undefined: list not loaded yet. */
function suggestedValue(input: FlowTemplateInput, objects: Partial<Record<ObjectType, ServerObject[]>>): string | undefined {
  if (!isObjectType(input.type)) return input.default ?? '';
  const list = objects[input.type];
  if (!list) return undefined;
  const ids = (input.names ?? []).filter(Boolean).map((n) => list.find((o) => sameName(o.name, n))?.id).filter((id): id is string => !!id);
  return input.multiple ? [...new Set(ids)].join(',') : ids[0] ?? '';
}

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

function DiffView({ diff, title }: { diff: FlowDiff; title: string }) {
  const { t } = useTranslation();
  const name = (n: { label?: string; type: string }) => n.label || n.type;
  const count = diff.added.length + diff.removed.length + diff.changed.length + diff.edgesAdded + diff.edgesRemoved;
  return (
    <details className="rounded-md border p-2">
      <summary className="cursor-pointer font-medium">
        {t('components.flowTemplates.diffHeading', { title, summary: count ? t('components.flowTemplates.diffSummary', { added: diff.added.length, removed: diff.removed.length, changed: diff.changed.length }) : t('components.flowTemplates.diffNone') })}
      </summary>
      {count > 0 && (
        <ul className="mt-2 space-y-1 text-muted-foreground max-h-48 overflow-y-auto break-words">
          {diff.added.map((n) => <li key={`a${n.id}`}>{t('components.flowTemplates.diffAdded', { name: name(n) })}</li>)}
          {diff.removed.map((n) => <li key={`r${n.id}`}>{t('components.flowTemplates.diffRemoved', { name: name(n) })}</li>)}
          {diff.changed.map((n) => (
            <li key={`c${n.id}`}>
              {t('components.flowTemplates.diffChanged', { name: name(n) })}
              <ul className="pl-3">
                {n.fields.map((f) => <li key={f.field}><code>{f.field}</code>: {f.before ?? '–'} → {f.after ?? '–'}</li>)}
              </ul>
            </li>
          ))}
          {(diff.edgesAdded > 0 || diff.edgesRemoved > 0) && <li>{t('components.flowTemplates.diffEdges', { added: diff.edgesAdded, removed: diff.edgesRemoved })}</li>}
        </ul>
      )}
    </details>
  );
}

/** A flow on this server from an earlier version of the same template: what the new version changes. */
function UpdatePanel({ updates, basis, onBasis, version }: { updates: FlowTemplateUpdate[]; basis: FlowTemplateUpdate; onBasis: (flowId: number) => void; version: string }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border border-primary/40 p-3 space-y-2 text-xs">
      <p className="font-medium text-sm flex items-center gap-1.5"><RefreshCw className="h-4 w-4 shrink-0" aria-hidden /> {t('components.flowTemplates.updateTitle')}</p>
      {updates.length > 1 && (
        <div>
          <Label htmlFor="tpl-update-basis" className="text-xs">{t('components.flowTemplates.updateBasis')}</Label>
          <Select value={String(basis.flowId)} onValueChange={(v) => onBasis(Number(v))}>
            <SelectTrigger id="tpl-update-basis"><SelectValue /></SelectTrigger>
            <SelectContent>
              {updates.map((u) => <SelectItem key={u.flowId} value={String(u.flowId)}>{u.flowName} (v{u.installedVersion})</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      <p className="break-words">{t('components.flowTemplates.updateOf', { flow: basis.flowName, from: basis.installedVersion, to: version })}</p>
      {basis.relation !== 'newer' && <p className="text-warning">{t(`components.flowTemplates.updateRelation.${basis.relation}`)}</p>}
      {basis.major && <p className="text-warning">{t('components.flowTemplates.updateMajor')}</p>}
      {basis.newCapabilities.length > 0 && <CapabilityList capabilities={basis.newCapabilities} title={t('components.flowTemplates.updateNewCapabilities')} warn />}
      {basis.againstPrevious
        ? <DiffView diff={basis.againstPrevious} title={t('components.flowTemplates.diffPrevious', { version: basis.installedVersion })} />
        : <p className="text-muted-foreground">{t('components.flowTemplates.diffPreviousUnknown', { version: basis.installedVersion })}</p>}
      <DiffView diff={basis.againstLocal} title={t('components.flowTemplates.diffLocal', { flow: basis.flowName })} />
      <p className="text-muted-foreground">{t('components.flowTemplates.updateCopyNote', { flow: basis.flowName })}</p>
    </div>
  );
}

function CapabilityList({ capabilities, title, warn }: { capabilities: FlowCapability[]; title?: string; warn?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={`rounded-md border p-3 space-y-1 ${warn ? 'border-warning/40 bg-warning/5' : ''}`}>
      <p className="text-xs font-medium flex items-center gap-1.5"><ShieldAlert className="h-3.5 w-3.5" aria-hidden /> {title ?? t('components.flowTemplates.capabilitiesTitle')}</p>
      {capabilities.length === 0
        ? <p className="text-xs text-muted-foreground">{t('components.flowTemplates.capabilitiesNone')}</p>
        : (
          <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
            {capabilities.map((c) => (
              <li key={c.kind} className="break-words">{t(`components.flowTemplates.capabilities.${c.kind}`, { details: c.details?.join(', ') ?? '' })}</li>
            ))}
          </ul>
        )}
    </div>
  );
}

function InputField({ input, objects, value, onChange }: {
  input: FlowTemplateInput;
  objects: Partial<Record<ObjectType, ServerObject[]>>;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const id = `tpl-input-${input.key}`;
  const list = isObjectType(input.type) ? objects[input.type] : undefined;
  const names = (input.names ?? []).filter(Boolean);
  const hint = !isObjectType(input.type) ? null
    : names.length ? t('components.flowTemplates.originalNames', { names: names.join(', ') })
      : input.default ? t('components.flowTemplates.originalId', { id: input.default }) : null;
  const selected = value ? value.split(',').map((v) => v.trim()) : [];
  const toggle = (objectId: string) => onChange((selected.includes(objectId) ? selected.filter((v) => v !== objectId) : [...selected, objectId]).join(','));

  let control: React.ReactNode;
  if (isObjectType(input.type)) {
    if (!list) control = <p className="text-xs text-muted-foreground">{t('common.loading')}</p>;
    else if (list.length === 0) control = <p className="text-xs text-destructive">{t('components.flowTemplates.noObjects')}</p>;
    else if (input.multiple) {
      control = (
        <div role="group" aria-labelledby={`${id}-label`} className="max-h-36 overflow-y-auto rounded-md border p-2 space-y-1">
          {list.map((o) => (
            <div key={o.id} className="flex items-center gap-2">
              <Checkbox id={`${id}-${o.id}`} checked={selected.includes(o.id)} onCheckedChange={() => toggle(o.id)} />
              <Label htmlFor={`${id}-${o.id}`} className="text-xs font-normal break-all">{o.name} <span className="text-muted-foreground">#{o.id}</span></Label>
            </div>
          ))}
        </div>
      );
    } else {
      control = (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id={id} className="h-8 text-xs"><SelectValue placeholder={t('components.flowTemplates.choose')} /></SelectTrigger>
          <SelectContent>
            {list.map((o) => <SelectItem key={o.id} value={o.id}>{o.name} <span className="text-muted-foreground">#{o.id}</span></SelectItem>)}
          </SelectContent>
        </Select>
      );
    }
  } else if (input.type === 'select') {
    control = (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="h-8 text-xs"><SelectValue placeholder={t('components.flowTemplates.choose')} /></SelectTrigger>
        <SelectContent>
          {(input.options ?? []).map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  } else {
    control = <Input id={id} type={input.type === 'number' ? 'number' : 'text'} className="h-8 text-xs" value={value} onChange={(e) => onChange(e.target.value)} />;
  }

  return (
    <div className="space-y-1">
      <Label id={`${id}-label`} htmlFor={input.multiple && list?.length ? undefined : id} className="text-xs break-words">
        {input.label}{' '}
        {input.required ? <span className="text-destructive" aria-hidden>*</span> : <span className="text-muted-foreground">({t('components.flowTemplates.optional')})</span>}
        {isObjectType(input.type) && <span className="text-muted-foreground"> · {t(`components.flowTemplates.types.${input.type}`)}</span>}
      </Label>
      {control}
      {hint && <p className="text-[11px] text-muted-foreground break-words">{hint}</p>}
    </div>
  );
}

export function ExportTemplateDialog({ bot, onOpenChange }: { bot: { id: number; serverConfigId: number; virtualServerId: number } | null; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['bot-export', bot?.id],
    queryFn: () => botsApi.exportTemplate(bot!.id),
    enabled: bot !== null,
    gcTime: 0,
  });
  // Names of the objects behind the inputs, so the importing server can suggest its own objects of the same name.
  const objects = useServerObjects(bot?.serverConfigId ?? null, bot?.virtualServerId ?? 1, !!data?.template.inputs.some((i) => isObjectType(i.type)));
  const [meta, setMeta] = useState({ id: '', name: '', version: '', author: '', description: '' });
  useEffect(() => {
    if (data) setMeta({ id: data.template.id, name: data.template.name, version: data.template.version, author: data.template.author ?? '', description: data.template.description ?? '' });
  }, [data]);

  const download = () => {
    if (!data) return;
    const inputs = data.template.inputs.map((input) => {
      const list = isObjectType(input.type) ? objects[input.type] : undefined;
      if (!list || !input.default) return input;
      const names = input.default.split(',').map((id) => list.find((o) => o.id === id)?.name ?? '');
      return names.some(Boolean) ? { ...input, names } : input;
    });
    const template: FlowTemplateFile = { ...data.template, inputs, id: meta.id.trim(), name: meta.name.trim(), version: meta.version.trim() };
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
    <Dialog open={bot !== null} onOpenChange={onOpenChange}>
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

/**
 * Import in three steps: the file with what the flow can do, mapping its inputs
 * onto objects of this server, then a test run of the new (disabled) flow before
 * it can be switched on from here.
 */
export function ImportTemplateDialog({ open, onOpenChange, serverConfigId, sid, onImported }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverConfigId: number | null;
  sid: number;
  onImported: (botId: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<{ id: number; name: string } | null>(null);
  const [tested, setTested] = useState(false);
  const [updates, setUpdates] = useState<FlowTemplateUpdate[] | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [basisId, setBasisId] = useState<number | null>(null);
  const [appliedBasis, setAppliedBasis] = useState<number | null>(null);
  useEffect(() => {
    if (!open) { setStep(1); setText(null); setFileName(''); setValues({}); setCreated(null); setTested(false); }
  }, [open]);

  const check = useMemo(() => (text === null ? null : parseFlowTemplate(text)), [text]);
  const template = check?.ok ? check.template : null;

  // Flows on this server from an earlier version of this template (the import is then an update, still as a copy).
  useEffect(() => {
    setUpdates(null);
    setPreviewFailed(false);
    setAppliedBasis(null);
    if (!template || text === null || serverConfigId === null) return;
    let live = true;
    botsApi.previewImport({ file: text, serverConfigId, virtualServerId: sid })
      .then((r) => { if (live) { setUpdates(r.updates); setBasisId(r.updates[0]?.flowId ?? null); } })
      .catch(() => { if (live) { setUpdates([]); setPreviewFailed(true); } });
    return () => { live = false; };
  }, [template, text, serverConfigId, sid]);
  const basis = updates?.find((u) => u.flowId === basisId) ?? null;
  const capabilities = useMemo(() => (template ? flowCapabilities(template.flow.nodes) : []), [template]);
  const objects = useServerObjects(serverConfigId, sid, open && !!template?.inputs.some((i) => isObjectType(i.type)));
  const lang = i18n.language.slice(0, 2) as 'de' | 'en' | 'fr';
  const shownName = template?.translations?.[lang]?.name || template?.name;
  const shownDescription = template?.translations?.[lang]?.description || template?.description;

  // Fill each input once its object list is there; what the user already picked stays.
  useEffect(() => {
    if (!template) return;
    setValues((prev) => {
      let next = prev;
      for (const input of template.inputs) {
        if (prev[input.key] !== undefined) continue;
        const v = suggestedValue(input, objects);
        if (v !== undefined) next = { ...next, [input.key]: v };
      }
      return next;
    });
  }, [template, objects]);

  const missing = template?.inputs.filter((i) => i.required && !values[i.key]?.trim()) ?? [];

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setValues({});
    setText(await file.text());
  };

  const importFlow = useMutation({
    mutationFn: () => botsApi.importTemplate({
      file: text!, serverConfigId: serverConfigId!, virtualServerId: sid,
      values: Object.fromEntries(template!.inputs.map((i) => [i.key, values[i.key] ?? ''])),
      ...(basis ? { name: `${basis.flowName} ${template!.version}` } : {}),
    }),
    onSuccess: (res) => {
      toast.success(t('components.flowTemplates.imported', { name: res.name }));
      qc.invalidateQueries({ queryKey: ['bots'] });
      setCreated({ id: res.id, name: res.name });
      setStep(3);
    },
    onError: (err: any) => {
      const details: string[] = err?.response?.data?.details ?? [];
      toast.error([err?.response?.data?.error ?? t('components.flowTemplates.importFailed'), ...details].join('\n'));
    },
  });

  const enable = useMutation({
    mutationFn: () => botsApi.enable(created!.id),
    onSuccess: () => {
      toast.success(t('components.flowTemplates.enabled', { name: created!.name }));
      qc.invalidateQueries({ queryKey: ['bots'] });
      finish();
    },
    onError: (err: any) => toast.error(err?.response?.data?.error ?? t('components.flowTemplates.enableFailed')),
  });

  const finish = () => {
    const id = created!.id;
    onOpenChange(false);
    onImported(id);
  };

  const { data: createdBot } = useBot(created?.id ?? null);
  const flow = useMemo(() => {
    if (!createdBot?.flowData) return null;
    try { return typeof createdBot.flowData === 'string' ? JSON.parse(createdBot.flowData) : createdBot.flowData; } catch { return null; }
  }, [createdBot]);
  // Stable, so the panel's cleanup does not run on every render.
  const onResult = useCallback((report: unknown) => { if (report) setTested(true); }, []);
  const noop = useCallback(() => {}, []);

  const stepName = t(`components.flowTemplates.steps.${step === 1 ? 'file' : step === 2 ? 'map' : 'test'}`);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={step === 3 ? 'max-w-2xl' : 'max-w-lg'}>
        <DialogHeader>
          <DialogTitle>{t('components.flowTemplates.importTitle')}</DialogTitle>
          <DialogDescription>{t('components.flowTemplates.stepOf', { step, name: stepName })}</DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{t('components.flowTemplates.importHint')}</p>
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
              <div className="space-y-3 max-h-[50vh] overflow-y-auto">
                <div className="rounded-md border p-3 text-xs space-y-1">
                  <p className="font-medium text-sm flex items-center gap-1.5 break-words"><FileUp className="h-4 w-4 shrink-0" aria-hidden /> {shownName} <span className="text-muted-foreground font-normal">v{template.version}</span></p>
                  {template.author && <p className="text-muted-foreground">{t('components.flowTemplates.byAuthor', { author: template.author })}</p>}
                  {shownDescription && <p className="text-muted-foreground whitespace-pre-line break-words">{shownDescription}</p>}
                  <p className="text-muted-foreground">{t('components.flowTemplates.summary', { nodes: template.flow.nodes.length, inputs: template.inputs.length })}</p>
                </div>
                <CapabilityList capabilities={capabilities} />
                {basis && updates && <UpdatePanel updates={updates} basis={basis} onBasis={setBasisId} version={template.version} />}
                {previewFailed && <p className="text-xs text-warning">{t('components.flowTemplates.updateCheckFailed')}</p>}
                <p className="text-xs text-muted-foreground">{t('components.flowTemplates.importDisabledNote')}</p>
                <TargetList template={template} items={template.secrets} icon={KeyRound} title={t('components.flowTemplates.secretsToEnter')} />
              </div>
            )}
          </div>
        )}

        {step === 2 && template && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{t('components.flowTemplates.mapHint')}</p>
            <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
              {template.inputs.map((input) => (
                <InputField key={input.key} input={input} objects={objects} value={values[input.key] ?? ''} onChange={(v) => setValues((prev) => ({ ...prev, [input.key]: v }))} />
              ))}
            </div>
            {missing.length > 0 && <p role="status" className="text-xs text-destructive">{t('components.flowTemplates.missingCount', { count: missing.length })}</p>}
          </div>
        )}

        {step === 3 && created && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{t('components.flowTemplates.testHint')}</p>
            {flow
              ? <TestPanel embedded botId={created.id} nodes={flow.nodes ?? []} edges={flow.edges ?? []} onPick={noop} onResult={onResult} />
              : <p className="text-xs text-muted-foreground">{t('common.loading')}</p>}
            {template && <TargetList template={template} items={template.secrets} icon={KeyRound} title={t('components.flowTemplates.secretsToEnter')} />}
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === 1 && <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            {/* Nothing to map: import straight away. */}
            <Button
              onClick={() => {
                if (!template!.inputs.length) return importFlow.mutate();
                // An update starts with the mapping of the installed flow (empty after a major version).
                if (basis && basis.flowId !== appliedBasis) {
                  setValues((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(basis.values).filter(([, v]) => v)) }));
                  setAppliedBasis(basis.flowId);
                }
                setStep(2);
              }}
              disabled={!template || serverConfigId === null || updates === null || importFlow.isPending}
            >
              {template && !template.inputs.length ? t('components.flowTemplates.import') : t('common.next')}
            </Button>
          </>}
          {step === 2 && <>
            <Button variant="outline" onClick={() => setStep(1)}>{t('common.back')}</Button>
            <Button onClick={() => importFlow.mutate()} disabled={missing.length > 0 || importFlow.isPending}>{t('components.flowTemplates.import')}</Button>
          </>}
          {step === 3 && <>
            {!tested && <p className="text-xs text-muted-foreground self-center sm:mr-auto">{t('components.flowTemplates.testFirst')}</p>}
            <Button variant="outline" onClick={finish}>{t('components.flowTemplates.keepDisabled')}</Button>
            <Button onClick={() => enable.mutate()} disabled={!tested || enable.isPending}>{t('components.flowTemplates.enable')}</Button>
          </>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
