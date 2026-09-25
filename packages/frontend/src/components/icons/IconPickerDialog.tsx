import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Image as ImageIcon, Search } from 'lucide-react';
import { iconsApi } from '@/api/icons.api';
import { useServerStore } from '@/stores/server.store';
import { IconImage } from '@/components/icons/IconImage';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { EmptyState } from '@/components/shared/EmptyState';
import { cn } from '@/lib/utils';

interface IconPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the picked icon's ID; the dialog closes itself afterward. */
  onSelect: (iconId: number) => void;
  currentIconId?: number;
}

/** Browse the active server's icon pool and pick one. Shares the ['icons', c,
 * s] query key with the Icon Browser page, so switching between them doesn't
 * refetch. Read-only - uploading new icons stays the Icon Browser's job. */
export function IconPickerDialog({ open, onOpenChange, onSelect, currentIconId }: IconPickerDialogProps) {
  const { selectedConfigId: c, selectedSid: s } = useServerStore();
  const [search, setSearch] = useState('');

  const { data: pool, isLoading, error } = useQuery({
    queryKey: ['icons', c, s],
    queryFn: () => iconsApi.list(c!, s!),
    enabled: !!c && !!s && open,
    retry: false,
  });

  const icons = useMemo(() => {
    const all = pool?.icons ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return all;
    return all.filter((icon) => String(icon.iconId).includes(term));
  }, [pool, search]);

  const errorMessage = (error as any)?.response?.data?.error as string | undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Choose an icon</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search icon ID..."
            className="pl-8 h-9"
            autoFocus
          />
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center h-[320px]">
            <PageLoader />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-[320px] gap-3 px-8">
            <AlertTriangle className="h-8 w-8 text-amber-400" />
            <p className="text-sm font-medium text-foreground">Icon pool unavailable</p>
            <p className="text-xs text-muted-foreground text-center max-w-md">
              {errorMessage?.includes('SSH')
                ? 'Reading the icon pool requires SSH access, because the TeamSpeak WebQuery HTTP API does not support file transfer commands. Configure SSH credentials in the server settings, or type the icon ID directly.'
                : errorMessage || 'Failed to load the icon pool - type the icon ID directly instead.'}
            </p>
          </div>
        ) : icons.length === 0 ? (
          <div className="flex items-center justify-center h-[320px]">
            <EmptyState
              icon={ImageIcon}
              title={search ? 'No matching icons' : 'No icons uploaded'}
              description={search ? 'No icon in this pool matches your search.' : 'Upload icons on the Icons page first, then pick one here.'}
            />
          </div>
        ) : (
          <ScrollArea className="h-[320px]">
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 p-1">
              {icons.map((icon) => (
                <button
                  key={icon.iconId}
                  onClick={() => { onSelect(icon.iconId); onOpenChange(false); }}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-lg border p-2.5 transition-colors',
                    icon.iconId === currentIconId
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/30 hover:bg-muted/20',
                  )}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted/30">
                    <IconImage iconId={icon.iconId} size={26} />
                  </div>
                  <span className="text-[10px] font-mono-data text-foreground truncate max-w-full">#{icon.iconId}</span>
                </button>
              ))}
            </div>
          </ScrollArea>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
