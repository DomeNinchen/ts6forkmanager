import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Image as ImageIcon, Search, Trash2, Upload, X, CheckSquare,
} from 'lucide-react';
import { toast } from 'sonner';
import type { IconUsageRef, ServerIcon } from '@ts6/common';
import { iconsApi } from '@/api/icons.api';
import { useServerStore } from '@/stores/server.store';
import { useAuthStore } from '@/stores/auth.store';
import { IconImage } from '@/components/icons/IconImage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { cn, formatBytes } from '@/lib/utils';

const ACCEPTED_TYPES = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';

const USAGE_LABELS: Record<IconUsageRef['kind'], string> = {
  virtualserver: 'Virtual Server',
  servergroup: 'Server Group',
  channelgroup: 'Channel Group',
  channel: 'Channel',
};

function describeUsage(refs: IconUsageRef[]): string {
  return refs
    .map((ref) => `${USAGE_LABELS[ref.kind]}: ${ref.name}${ref.id ? ` (#${ref.id})` : ''}`)
    .join(', ');
}

export default function Icons() {
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  const isAdmin = useAuthStore((state) => state.isAdmin());
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [deleteTargets, setDeleteTargets] = useState<ServerIcon[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: pool, isLoading, error } = useQuery({
    queryKey: ['icons', c, s],
    queryFn: () => iconsApi.list(c!, s!),
    enabled: !!c && !!s,
    retry: false,
  });

  // Usage runs over WebQuery, so it keeps working (and stays useful) even when
  // the SSH-only icon listing above fails.
  const { data: usage } = useQuery({
    queryKey: ['icon-usage', c, s],
    queryFn: () => iconsApi.usage(c!, s!),
    enabled: !!c && !!s,
    retry: false,
  });

  const icons = useMemo(() => {
    const all = pool?.icons ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return all;
    return all.filter((icon) => String(icon.iconId).includes(term) || icon.name.toLowerCase().includes(term));
  }, [pool, search]);

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['icons', c, s] });
    qc.invalidateQueries({ queryKey: ['icon-usage', c, s] });
  }, [qc, c, s]);

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const results = [];
      for (const file of files) {
        results.push(await iconsApi.upload(c!, s!, file));
      }
      return results;
    },
    onSuccess: (results) => {
      const added = results.filter((r) => !r.alreadyExisted).length;
      const duplicates = results.length - added;
      if (added > 0) toast.success(`${added} icon(s) uploaded`);
      if (duplicates > 0) toast.info(`${duplicates} icon(s) were already in the pool`);
      invalidate();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || 'Upload failed');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (iconIds: number[]) =>
      iconIds.length === 1
        ? iconsApi.delete(c!, s!, iconIds[0]).then(() => ({ succeeded: 1, failed: 0 }))
        : iconsApi.bulkDelete(c!, s!, iconIds),
    onSuccess: ({ succeeded, failed }) => {
      if (succeeded > 0) toast.success(`${succeeded} icon(s) deleted`);
      if (failed > 0) toast.error(`${failed} icon(s) could not be deleted`);
      setDeleteTargets(null);
      setSelected(new Set());
      invalidate();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || 'Delete failed');
    },
  });

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      const files = Array.from(fileList);
      const max = pool?.maxFileSize;
      const tooLarge = max ? files.filter((f) => f.size > max) : [];
      if (tooLarge.length > 0) {
        toast.error(
          `${tooLarge.length} file(s) exceed this server's icon size limit of ${formatBytes(max!)} (i_max_icon_filesize).`,
        );
      }
      const accepted = max ? files.filter((f) => f.size <= max) : files;
      if (accepted.length > 0) uploadMutation.mutate(accepted);
    },
    [pool, uploadMutation],
  );

  const toggleSelected = (iconId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(iconId)) next.delete(iconId);
      else next.add(iconId);
      return next;
    });
  };

  const selectedIcons = useMemo(
    () => (pool?.icons ?? []).filter((icon) => selected.has(icon.iconId)),
    [pool, selected],
  );

  const usedByTargets = useMemo(() => {
    if (!deleteTargets || !usage) return [] as { icon: ServerIcon; refs: IconUsageRef[] }[];
    return deleteTargets
      .map((icon) => ({ icon, refs: usage[icon.iconId] ?? [] }))
      .filter((entry) => entry.refs.length > 0);
  }, [deleteTargets, usage]);

  if (!c || !s) return <EmptyState icon={ImageIcon} title="No server selected" />;

  const errorMessage = (error as any)?.response?.data?.error as string | undefined;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-semibold">Icon Browser</h1>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search icon ID..."
                className="pl-8 h-9 w-56"
              />
            </div>
            {isAdmin && (
              <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploadMutation.isPending}>
                <Upload className="h-4 w-4 mr-1" />
                {uploadMutation.isPending ? 'Uploading...' : 'Upload Icons'}
              </Button>
            )}
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES}
          multiple
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />

        <Card
          className={cn('card-hero', dragging && 'border-primary')}
          onDragOver={(e) => {
            if (!isAdmin) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            if (!isAdmin) return;
            e.preventDefault();
            setDragging(false);
            handleFiles(e.dataTransfer.files);
          }}
        >
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <ImageIcon className="h-3.5 w-3.5" /> Icon Pool
              </CardTitle>
              <div className="flex items-center gap-2">
                {pool?.maxFileSize ? (
                  <Badge variant="outline" className="text-[10px] font-mono-data">
                    max {formatBytes(pool.maxFileSize)}
                  </Badge>
                ) : null}
                <Badge variant="secondary" className="text-[10px] font-mono-data">
                  {icons.length} icon(s)
                </Badge>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {selected.size > 0 && (
              <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-border bg-muted/20">
                <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <CheckSquare className="h-3.5 w-3.5" /> {selected.size} selected
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                    <X className="h-3.5 w-3.5 mr-1" /> Clear
                  </Button>
                  {isAdmin && (
                    <Button variant="destructive" size="sm" onClick={() => setDeleteTargets(selectedIcons)}>
                      <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete selected
                    </Button>
                  )}
                </div>
              </div>
            )}

            {isLoading ? (
              <div className="flex items-center justify-center h-[400px]">
                <PageLoader />
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center h-[400px] gap-3 px-8">
                <AlertTriangle className="h-8 w-8 text-amber-400" />
                <p className="text-sm font-medium text-foreground">Icon Browser Unavailable</p>
                <p className="text-xs text-muted-foreground text-center max-w-md">
                  {errorMessage?.includes('SSH')
                    ? 'Reading the icon pool requires SSH access, because the TeamSpeak WebQuery HTTP API does not support file transfer commands. Please configure SSH credentials (username & password) in the server settings.'
                    : errorMessage || 'Failed to load the icon pool.'}
                </p>
              </div>
            ) : icons.length === 0 ? (
              <div className="flex items-center justify-center h-[400px]">
                <EmptyState
                  icon={ImageIcon}
                  title={search ? 'No matching icons' : 'No icons uploaded'}
                  description={
                    search
                      ? 'No icon in this pool matches your search.'
                      : isAdmin
                        ? 'Upload a PNG, JPEG, GIF, WebP or SVG file - or drop one here - to add it to this server\'s icon pool.'
                        : 'This server has no icons in its icon pool yet.'
                  }
                />
              </div>
            ) : (
              <ScrollArea className="h-[520px]">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 p-4">
                  {icons.map((icon) => {
                    const refs = usage?.[icon.iconId] ?? [];
                    const isSelected = selected.has(icon.iconId);
                    return (
                      <div
                        key={icon.iconId}
                        onClick={() => toggleSelected(icon.iconId)}
                        className={cn(
                          'group relative flex flex-col items-center gap-2 rounded-lg border p-3 cursor-pointer transition-colors',
                          isSelected
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/30 hover:bg-muted/20',
                        )}
                      >
                        <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted/30">
                          <IconImage iconId={icon.iconId} size={32} />
                        </div>
                        <span className="text-[11px] font-mono-data text-foreground truncate max-w-full">
                          #{icon.iconId}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono-data">
                          {formatBytes(icon.size)}
                        </span>

                        {refs.length > 0 && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                variant="secondary"
                                className="absolute top-1.5 left-1.5 text-[9px] px-1 py-0"
                              >
                                in use
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">{describeUsage(refs)}</TooltipContent>
                          </Tooltip>
                        )}

                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTargets([icon]);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        {isAdmin && pool && !error && (
          <p className="text-[11px] text-muted-foreground">
            Icons are stored in the virtual server's own icon pool. The icon ID is the CRC32 checksum of the file,
            so uploading the same image twice always yields the same ID.
            {pool.maxFileSize ? ` This server accepts icons up to ${formatBytes(pool.maxFileSize)} (i_max_icon_filesize).` : ''}
            {pool.canManage ? '' : ' Note: the query identity is missing the b_icon_manage permission.'}
          </p>
        )}

        <ConfirmDialog
          open={!!deleteTargets}
          onOpenChange={(open) => !open && setDeleteTargets(null)}
          title={deleteTargets && deleteTargets.length > 1 ? `Delete ${deleteTargets.length} icons?` : 'Delete icon?'}
          description={
            usedByTargets.length > 0
              ? `Warning: ${usedByTargets.length} of the selected icon(s) are still assigned — ${usedByTargets
                  .map((entry) => `#${entry.icon.iconId} → ${describeUsage(entry.refs)}`)
                  .join(' | ')}. Deleting them leaves those assignments pointing at a missing icon.`
              : 'This removes the icon from the server\'s icon pool. This cannot be undone.'
          }
          confirmLabel="Delete"
          destructive
          loading={deleteMutation.isPending}
          onConfirm={() => deleteTargets && deleteMutation.mutate(deleteTargets.map((icon) => icon.iconId))}
        />
      </div>
    </TooltipProvider>
  );
}
