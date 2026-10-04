import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Folder, X } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn, formatBytes } from '@/lib/utils';
import { pathProblemMessage } from '@/lib/file-errors';
import type { ItemProblem, ResolvedGroup } from '@/lib/upload-tree';

// The list of a folder's files is as long as the folder; only this many are drawn
const MAX_LISTED = 200;
// Problems named right in the row, before the list is opened
const MAX_PROBLEMS_SHOWN = 3;

export function problemText(problem: ItemProblem, t: TFunction, maxUploadBytes?: number): string {
  if (problem.kind === 'name') return pathProblemMessage(problem.problem, t);
  if (problem.kind === 'size') return t('pages.files.errors.tooLargeFor', { size: formatBytes(maxUploadBytes ?? 0) });
  return t('pages.files.uploadDialog.duplicate');
}

interface UploadGroupRowProps {
  resolved: ResolvedGroup;
  maxUploadBytes?: number;
  onAdjust: (key: number, adjust: boolean) => void;
  onRemove: (key: number) => void;
}

/**
 * One row of the upload window: a file, or a folder with everything in it. What
 * it will be called on the server is shown right there, with the choice of
 * plain ASCII names where a name has umlauts or the like, and what cannot be
 * uploaded and why.
 */
export function UploadGroupRow({ resolved, maxUploadBytes, onAdjust, onRemove }: UploadGroupRowProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { group, name, items, ready, files, emptyFolders, bytes, flagged } = resolved;

  const problems = items.filter((entry) => entry.problem);
  const nothingLeft = ready.length === 0;
  const keepsNonAscii = flagged > 0 && !group.adjust;
  const renamed = name !== group.name;
  const checkboxId = `upload-adjust-${group.key}`;

  // "3 files, 2 KB", "3 files, 2 KB, 1 empty folder", or just "1 empty folder" for a folder with no file in it
  const summary = group.folder
    ? [
        files > 0 || emptyFolders === 0 ? t('pages.files.uploadDialog.summary', { count: files, size: formatBytes(bytes) }) : '',
        emptyFolders > 0 ? t('pages.files.uploadDialog.folderEmpty', { count: emptyFolders }) : '',
      ].filter(Boolean).join(', ')
    : formatBytes(items[0]?.item.file?.size ?? 0);

  return (
    <li className="px-3 py-2 text-sm">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0">
          {nothingLeft ? (
            <AlertTriangle className="h-4 w-4 text-destructive" />
          ) : problems.length > 0 || keepsNonAscii ? (
            <AlertTriangle className="h-4 w-4 text-amber-400" />
          ) : (
            <Check className="h-4 w-4 text-emerald-400" />
          )}
        </div>

        <div className={cn('min-w-0 flex-1 space-y-1', nothingLeft && 'opacity-80')}>
          <div className="flex items-center gap-2">
            {group.folder && <Folder className="h-3.5 w-3.5 shrink-0 text-primary/70" />}
            <span className={cn('truncate font-medium', nothingLeft && 'line-through')} title={name}>
              {name}{group.folder ? '/' : ''}
            </span>
            <span className="shrink-0 font-mono-data text-xs text-muted-foreground">{summary}</span>
          </div>

          {renamed && (
            <p className="truncate text-xs text-muted-foreground" title={group.name}>
              {t('pages.files.uploadDialog.originalName', { name: group.folder ? `${group.name}/` : group.name })}
            </p>
          )}

          {/* A file on its own: the one reason it is left out. A folder: the first few, the rest in the list below */}
          {problems.slice(0, group.folder ? MAX_PROBLEMS_SHOWN : 1).map((entry) => (
            <p key={entry.path} className="truncate text-xs text-destructive" title={entry.path}>
              {group.folder ? `${entry.path}: ` : ''}{problemText(entry.problem!, t, maxUploadBytes)}
            </p>
          ))}
          {group.folder && problems.length > MAX_PROBLEMS_SHOWN && (
            <p className="text-xs text-destructive">
              {t('pages.files.uploadDialog.moreProblems', { count: problems.length - MAX_PROBLEMS_SHOWN })}
            </p>
          )}

          {flagged > 0 && (
            <div className="flex items-center gap-2">
              <Checkbox
                id={checkboxId}
                checked={group.adjust}
                onCheckedChange={(value) => onAdjust(group.key, value === true)}
              />
              <Label htmlFor={checkboxId} className="text-xs">
                {group.folder
                  ? t('pages.files.uploadDialog.adjustLabelFolder', { count: flagged })
                  : t('pages.files.uploadDialog.adjustLabel')}
              </Label>
            </div>
          )}
          {keepsNonAscii && !nothingLeft && (
            <p className="text-xs text-amber-400">
              {group.folder ? t('pages.files.uploadDialog.keepWarningFolder') : t('pages.files.uploadDialog.keepWarning')}
            </p>
          )}

          {group.folder && (
            <>
              <button
                onClick={() => setOpen((value) => !value)}
                className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                aria-expanded={open}
              >
                {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                {t('pages.files.uploadDialog.showContents', { count: items.length })}
              </button>
              {open && (
                <ul className="max-h-40 divide-y divide-border/40 overflow-y-auto rounded-md border border-border/60 text-xs">
                  {items.slice(0, MAX_LISTED).map((entry) => (
                    <li key={entry.item.segments.join('/')} className="flex items-baseline gap-2 px-2 py-1">
                      <span
                        className={cn('min-w-0 flex-1 truncate', entry.problem && 'text-destructive line-through')}
                        title={entry.problem ? problemText(entry.problem, t, maxUploadBytes) : entry.path}
                      >
                        {entry.path}{entry.item.file ? '' : '/'}
                      </span>
                      <span className="shrink-0 font-mono-data text-muted-foreground">
                        {entry.item.file ? formatBytes(entry.item.file.size) : t('pages.files.uploadDialog.emptyFolderMark')}
                      </span>
                    </li>
                  ))}
                  {items.length > MAX_LISTED && (
                    <li className="px-2 py-1 text-muted-foreground">
                      {t('pages.files.uploadDialog.listMore', { count: items.length - MAX_LISTED })}
                    </li>
                  )}
                </ul>
              )}
            </>
          )}
        </div>

        <button
          onClick={() => onRemove(group.key)}
          className="shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={t('pages.files.uploadDialog.remove')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}
