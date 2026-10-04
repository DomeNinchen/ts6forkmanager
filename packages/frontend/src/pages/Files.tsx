import { useState, useMemo, useRef, useEffect, useCallback, type DragEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { checkFileName, joinRepositoryPath, type ServerFileEntry } from '@ts6/common';
import { filesApi } from '@/api/files.api';
import { channelsApi } from '@/api/channels.api';
import { useServerStore } from '@/stores/server.store';
import { useTransfers } from '@/stores/transfers.store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { TransferPanel } from '@/components/files/TransferPanel';
import { UploadConflictDialog } from '@/components/files/UploadConflictDialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn, formatBytes } from '@/lib/utils';
import { fileErrorMessage, pathProblemMessage } from '@/lib/file-errors';
import {
  FolderOpen, File, Folder, ArrowLeft, FolderPlus, Trash2, Hash, HardDrive, AlertTriangle, FolderInput, Upload, Download,
} from 'lucide-react';
import { toast } from 'sonner';

/** Something a drag carries that can be uploaded, as opposed to a dragged piece of text or a link. */
const dragCarriesFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files');

export default function Files() {
  const { t, i18n } = useTranslation();
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  const qc = useQueryClient();

  const [selectedCid, setSelectedCid] = useState<number | null>(null);
  const [currentPath, setCurrentPath] = useState('/');
  const [showMkdir, setShowMkdir] = useState(false);
  const [newDirName, setNewDirName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ServerFileEntry | null>(null);
  const [moveTarget, setMoveTarget] = useState<ServerFileEntry | null>(null);
  const [moveTargetCid, setMoveTargetCid] = useState('');
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch channel list for selector
  const { data: channelData } = useQuery({
    queryKey: ['channels-for-files', c, s],
    queryFn: () => channelsApi.list(c!, s!),
    enabled: !!c && !!s,
  });

  const channels = useMemo(() => {
    if (!channelData || !Array.isArray(channelData)) return [];
    return channelData.map((ch: any) => ({
      cid: Number(ch.cid),
      name: ch.channel_name,
    }));
  }, [channelData]);

  // Fetch files in selected channel + path. Never served from cache: an upload
  // that finished while another page was open has to show up on return.
  const { data: fileData, isLoading: loadingFiles, error: filesError } = useQuery({
    queryKey: ['files', c, s, selectedCid, currentPath],
    queryFn: () => filesApi.list(c!, s!, selectedCid!, currentPath),
    enabled: !!c && !!s && !!selectedCid,
    retry: false,
    staleTime: 0,
  });

  const { data: limits } = useQuery({
    queryKey: ['files-limits', c, s],
    queryFn: () => filesApi.limits(c!, s!),
    enabled: !!c && !!s,
    staleTime: 5 * 60_000,
  });

  const files: ServerFileEntry[] = useMemo(() => {
    if (!fileData || !Array.isArray(fileData)) return [];
    // Directories first, then alphabetical
    return [...fileData].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [fileData]);

  const mkdirMutation = useMutation({
    mutationFn: (dirname: string) => filesApi.createDir(c!, s!, selectedCid!, dirname),
    onSuccess: () => {
      toast.success(t('pages.files.directoryCreated'));
      setShowMkdir(false);
      setNewDirName('');
      qc.invalidateQueries({ queryKey: ['files', c, s, selectedCid, currentPath] });
    },
    onError: () => toast.error(t('pages.files.directoryCreateFailed')),
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => filesApi.delete(c!, s!, selectedCid!, name),
    onSuccess: () => {
      toast.success(t('pages.files.fileDeleted'));
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ['files', c, s, selectedCid, currentPath] });
    },
    onError: () => toast.error(t('pages.files.fileDeleteFailed')),
  });

  const moveMutation = useMutation({
    mutationFn: ({ name, targetCid }: { name: string; targetCid: number }) => filesApi.move(c!, s!, selectedCid!, name, targetCid),
    onSuccess: () => {
      toast.success(t('pages.files.fileMoved'));
      setMoveTarget(null);
      setMoveTargetCid('');
      qc.invalidateQueries({ queryKey: ['files', c, s, selectedCid, currentPath] });
    },
    onError: (err: any) => toast.error(err?.response?.data?.details || err?.response?.data?.error || t('pages.files.fileMoveFailed')),
  });

  // A download is a link the browser opens itself, so the file streams straight
  // to disk and the browser's own download list shows the progress
  const downloadMutation = useMutation({
    mutationFn: (entry: ServerFileEntry) =>
      filesApi.createDownloadLink(c!, s!, selectedCid!, joinRepositoryPath(currentPath, entry.name)),
    onSuccess: (link) => {
      const anchor = document.createElement('a');
      anchor.href = link.url;
      anchor.download = link.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      toast.success(t('pages.files.downloadStarted', { name: link.name }));
    },
    onError: (err, entry) => toast.error(fileErrorMessage(err, t, entry.name)),
  });

  const enqueueUploads = useTransfers((state) => state.enqueueUploads);
  const uploadFiles = useCallback(
    (list: File[]) => {
      if (!c || !s || !selectedCid || list.length === 0) return;
      enqueueUploads({ configId: c, sid: s, cid: selectedCid, directory: currentPath }, list, limits?.maxUploadBytes);
    },
    [c, s, selectedCid, currentPath, limits, enqueueUploads],
  );

  // The listing is refreshed whenever another upload into it completes
  const uploadsDoneHere = useTransfers(
    (state) => state.uploads.filter((item) => (
      item.status === 'done' && item.configId === c && item.sid === s && item.cid === selectedCid && item.directory === currentPath
    )).length,
  );
  useEffect(() => {
    if (uploadsDoneHere > 0) qc.invalidateQueries({ queryKey: ['files', c, s, selectedCid, currentPath] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadsDoneHere]);

  const navigateTo = (entry: ServerFileEntry) => {
    if (entry.isDirectory) setCurrentPath(joinRepositoryPath(currentPath, entry.name));
  };

  const goUp = () => {
    if (currentPath === '/') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    setCurrentPath(parts.length === 0 ? '/' : '/' + parts.join('/'));
  };

  const dirNameProblem = newDirName.trim() ? checkFileName(newDirName.trim()) : null;

  const handleMkdir = () => {
    const name = newDirName.trim();
    if (!name || checkFileName(name)) return;
    mkdirMutation.mutate(joinRepositoryPath(currentPath, name));
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate(joinRepositoryPath(currentPath, deleteTarget.name));
  };

  const handleMove = () => {
    if (!moveTarget || !moveTargetCid) return;
    moveMutation.mutate({ name: joinRepositoryPath(currentPath, moveTarget.name), targetCid: Number(moveTargetCid) });
  };

  const handleDrop = (event: DragEvent) => {
    if (!dragCarriesFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (!selectedCid) return;

    // The items have to be read right now, inside the event
    const dropped: File[] = [];
    let folders = 0;
    for (const item of Array.from(event.dataTransfer.items)) {
      if (item.kind !== 'file') continue;
      if (item.webkitGetAsEntry?.()?.isDirectory) {
        folders++;
        continue;
      }
      const file = item.getAsFile();
      if (file) dropped.push(file);
    }
    if (folders > 0) toast.info(t('pages.files.foldersNotSupported'));
    uploadFiles(dropped);
  };

  const formatDate = (ms: number) => {
    if (!ms) return '-';
    return new Date(ms).toLocaleDateString(i18n.language, {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  // Breadcrumb parts
  const pathParts = currentPath.split('/').filter(Boolean);

  if (!c || !s) return <EmptyState icon={FolderOpen} title={t('pages.noServerSelected')} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('pages.files.title')}</h1>
        {selectedCid && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowMkdir(true)}>
              <FolderPlus className="h-4 w-4 mr-1" /> {t('pages.files.newFolder')}
            </Button>
            <Button size="sm" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4 mr-1" /> {t('pages.files.uploadFiles')}
            </Button>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          uploadFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />

      <div className="grid grid-cols-12 gap-4">
        {/* Channel Selector */}
        <Card className="card-hero col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Hash className="h-3.5 w-3.5" /> {t('pages.files.channels')}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[500px]">
              <div className="p-2 space-y-0.5">
                {channels.map((ch) => (
                  <button
                    key={ch.cid}
                    onClick={() => { setSelectedCid(ch.cid); setCurrentPath('/'); }}
                    className={cn(
                      'w-full text-left px-2.5 py-1.5 rounded-md text-sm transition-colors truncate',
                      selectedCid === ch.cid
                        ? 'bg-primary/10 text-primary'
                        : 'text-foreground hover:bg-muted/50',
                    )}
                  >
                    {ch.name}
                  </button>
                ))}
                {channels.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">{t('pages.files.noChannels')}</p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* File List */}
        <Card
          className={cn('card-hero col-span-9 relative', dragging && 'border-primary')}
          onDragEnter={(e) => {
            if (!selectedCid || !dragCarriesFiles(e)) return;
            e.preventDefault();
            dragDepth.current++;
            setDragging(true);
          }}
          onDragOver={(e) => {
            if (!selectedCid || !dragCarriesFiles(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDragLeave={(e) => {
            if (!selectedCid || !dragCarriesFiles(e)) return;
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0) setDragging(false);
          }}
          onDrop={handleDrop}
        >
          {dragging && (
            <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-primary/10 border-2 border-dashed border-primary text-sm font-medium text-primary pointer-events-none">
              <Upload className="h-5 w-5" /> {t('pages.files.dropToUpload')}
            </div>
          )}
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {selectedCid && currentPath !== '/' && (
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={goUp}>
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </Button>
                )}
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <HardDrive className="h-3.5 w-3.5" />
                  <button onClick={() => setCurrentPath('/')} className="hover:text-foreground transition-colors">/</button>
                  {pathParts.map((part, i) => (
                    <span key={i} className="flex items-center gap-1">
                      <span>/</span>
                      <button
                        onClick={() => setCurrentPath('/' + pathParts.slice(0, i + 1).join('/'))}
                        className="hover:text-foreground transition-colors"
                      >
                        {part}
                      </button>
                    </span>
                  ))}
                </div>
              </div>
              {selectedCid && (
                <Badge variant="secondary" className="text-[10px] font-mono-data">
                  {t('pages.files.itemCount', { count: files.length })}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {!selectedCid ? (
              <div className="flex items-center justify-center h-[400px]">
                <p className="text-sm text-muted-foreground">{t('pages.files.selectChannelHint')}</p>
              </div>
            ) : loadingFiles ? (
              <div className="flex items-center justify-center h-[400px]">
                <PageLoader />
              </div>
            ) : filesError ? (
              <div className="flex flex-col items-center justify-center h-[400px] gap-3 px-8">
                <AlertTriangle className="h-8 w-8 text-amber-400" />
                <p className="text-sm font-medium text-foreground">{t('pages.files.unavailableTitle')}</p>
                <p className="text-xs text-muted-foreground text-center max-w-md">
                  {(filesError as any)?.response?.data?.error?.includes('SSH credentials not configured')
                    ? t('pages.files.unavailableSsh')
                    : (filesError as any)?.response?.data?.error?.includes('SSH')
                      ? t('pages.files.sshConnectFailed')
                      : (filesError as any)?.response?.data?.details || (filesError as any)?.response?.data?.error || t('pages.files.loadFailed')}
                </p>
                {(filesError as any)?.response?.data?.code != null && (
                  <p className="text-[10px] text-muted-foreground/60 mt-1">{t('pages.files.ts3ErrorCode', { code: (filesError as any).response.data.code })}</p>
                )}
              </div>
            ) : (
              <ScrollArea className="h-[460px]">
                {/* File table header */}
                <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[10px] text-muted-foreground uppercase tracking-wider border-b border-border">
                  <div className="col-span-6">{t('pages.files.colName')}</div>
                  <div className="col-span-2 text-right">{t('pages.files.colSize')}</div>
                  <div className="col-span-3">{t('pages.files.colModified')}</div>
                  <div className="col-span-1"></div>
                </div>

                {files.length === 0 ? (
                  <div className="flex items-center justify-center h-[350px]">
                    <EmptyState icon={FolderOpen} title={t('pages.files.emptyDirectory')} description={t('pages.files.emptyDirectoryDescription')} />
                  </div>
                ) : (
                  <div className="divide-y divide-border/50">
                    {files.map((file) => (
                      <div
                        key={file.name}
                        className={cn(
                          'grid grid-cols-12 gap-2 px-4 py-2 text-sm items-center group hover:bg-muted/20 transition-colors',
                          file.isDirectory && 'cursor-pointer',
                        )}
                        onClick={() => navigateTo(file)}
                      >
                        <div className="col-span-6 flex items-center gap-2 truncate">
                          {file.isDirectory ? (
                            <Folder className="h-4 w-4 text-primary/70 shrink-0" />
                          ) : (
                            <File className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          <span className="truncate">{file.name}</span>
                        </div>
                        <div className="col-span-2 text-right text-xs text-muted-foreground font-mono-data">
                          {file.isDirectory ? '-' : formatBytes(file.size)}
                        </div>
                        <div className="col-span-3 text-xs text-muted-foreground font-mono-data">
                          {formatDate(file.modified)}
                        </div>
                        <div className="col-span-1 flex justify-end gap-0.5">
                          {!file.isDirectory && (
                            <button
                              onClick={(e) => { e.stopPropagation(); downloadMutation.mutate(file); }}
                              className="p-1 rounded-sm opacity-0 group-hover:opacity-100 hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
                              title={t('pages.files.download')}
                            >
                              <Download className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {!file.isDirectory && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setMoveTarget(file); setMoveTargetCid(''); }}
                              className="p-1 rounded-sm opacity-0 group-hover:opacity-100 hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
                              title={t('pages.files.moveToAnotherChannel')}
                            >
                              <FolderInput className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteTarget(file); }}
                            className="p-1 rounded-sm opacity-0 group-hover:opacity-100 hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      <TransferPanel configId={c} sid={s} />

      {/* Limits notice */}
      {limits && (
        <p className="text-xs text-muted-foreground text-center">
          {t('pages.files.uploadLimitNotice', { size: formatBytes(limits.maxUploadBytes) })}
        </p>
      )}

      <UploadConflictDialog />

      {/* Create Directory Dialog */}
      <Dialog open={showMkdir} onOpenChange={setShowMkdir}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('pages.files.createDirectory')}</DialogTitle></DialogHeader>
          <div>
            <Label className="text-xs">{t('pages.files.directoryName')}</Label>
            <Input value={newDirName} onChange={(e) => setNewDirName(e.target.value)} placeholder={t('pages.files.newFolderPlaceholder')} autoFocus />
            {dirNameProblem && <p className="text-xs text-destructive mt-1">{pathProblemMessage(dirNameProblem, t)}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMkdir(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleMkdir} disabled={mkdirMutation.isPending || !newDirName.trim() || !!dirNameProblem}>{t('common.create')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move File Dialog */}
      <Dialog open={!!moveTarget} onOpenChange={(v) => !v && setMoveTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('pages.files.moveTitle', { name: moveTarget?.name })}</DialogTitle></DialogHeader>
          <p className="text-[11px] text-muted-foreground">{t('pages.files.moveHint')}</p>
          <div>
            <Label className="text-xs">{t('pages.files.targetChannel')}</Label>
            <Select value={moveTargetCid} onValueChange={setMoveTargetCid}>
              <SelectTrigger className="mt-1"><SelectValue placeholder={t('pages.files.chooseChannelPlaceholder')} /></SelectTrigger>
              <SelectContent>
                {channels.filter((ch) => ch.cid !== selectedCid).map((ch) => (
                  <SelectItem key={ch.cid} value={String(ch.cid)}>{ch.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveTarget(null)}>{t('common.cancel')}</Button>
            <Button onClick={handleMove} disabled={!moveTargetCid || moveMutation.isPending}>
              <FolderInput className="h-4 w-4 mr-1" /> {t('pages.files.move')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={() => setDeleteTarget(null)}
        title={deleteTarget?.isDirectory ? t('pages.files.deleteFolderTitle') : t('pages.files.deleteFileTitle')}
        description={deleteTarget?.isDirectory
          ? t('pages.files.deleteFolderDescription', { name: deleteTarget?.name })
          : t('pages.files.deleteFileDescription', { name: deleteTarget?.name })}
        confirmLabel={t('common.delete')}
        destructive
        onConfirm={handleDelete}
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
