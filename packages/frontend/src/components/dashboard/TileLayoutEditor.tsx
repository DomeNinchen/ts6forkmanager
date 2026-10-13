import { useTranslation } from 'react-i18next';
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors,
  type Announcements, type DragEndEvent, type UniqueIdentifier,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical } from 'lucide-react';
import type { DashboardTileSetting, DashboardTileWidth } from '@ts6/common';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { TILE_WIDTH_CLASS, tileDef } from './tile-registry';

const WIDTHS: DashboardTileWidth[] = [1, 2, 3];

interface Props {
  layout: DashboardTileSetting[];
  onChange: (layout: DashboardTileSetting[]) => void;
}

/**
 * The customise mode: every tile, hidden ones included, as a placeholder at its own width in the
 * same grid the dashboard uses. Order by dragging the handle (mouse, touch or keyboard) or with
 * the arrow buttons; width and visibility per tile. Changes only go to `onChange` - saving is the page's.
 */
export function TileLayoutEditor({ layout, onChange }: Props) {
  const { t } = useTranslation();
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const move = (from: number, to: number) => onChange(arrayMove(layout, from, to));
  const update = (id: string, patch: Partial<DashboardTileSetting>) =>
    onChange(layout.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    move(layout.findIndex((t) => t.id === active.id), layout.findIndex((t) => t.id === over.id));
  };

  // What a screen reader hears while a tile is dragged with the keyboard - by default dnd-kit
  // announces in English and with the raw ids ("Draggable item ping was moved over ...").
  const nameOf = (id: UniqueIdentifier) => {
    const def = tileDef(String(id));
    return def ? t(def.labelKey) : String(id);
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => t('pages.dashboard.tiles.dnd.start', { name: nameOf(active.id) }),
    // Silent over its own place: dnd-kit reports that right after pick-up, which would drown out onDragStart.
    onDragOver: ({ active, over }) =>
      over && over.id !== active.id
        ? t('pages.dashboard.tiles.dnd.over', { name: nameOf(active.id), target: nameOf(over.id) })
        : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? t('pages.dashboard.tiles.dnd.end', { name: nameOf(active.id), target: nameOf(over.id) })
        : t('pages.dashboard.tiles.dnd.cancel', { name: nameOf(active.id) }),
    onDragCancel: ({ active }) => t('pages.dashboard.tiles.dnd.cancel', { name: nameOf(active.id) }),
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{ announcements, screenReaderInstructions: { draggable: t('pages.dashboard.tiles.dnd.instructions') } }}
    >
      <SortableContext items={layout.map((t) => t.id)} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {layout.map((tile, index) => (
            <EditableTile
              key={tile.id}
              tile={tile}
              isFirst={index === 0}
              isLast={index === layout.length - 1}
              onMove={(step) => move(index, index + step)}
              onChange={(patch) => update(tile.id, patch)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

interface EditableTileProps {
  tile: DashboardTileSetting;
  isFirst: boolean;
  isLast: boolean;
  onMove: (step: -1 | 1) => void;
  onChange: (patch: Partial<DashboardTileSetting>) => void;
}

function EditableTile({ tile, isFirst, isLast, onMove, onChange }: EditableTileProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: tile.id });
  const def = tileDef(tile.id);
  const name = def ? t(def.labelKey) : tile.id;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, transition }}
      className={cn(
        TILE_WIDTH_CLASS[tile.width],
        'flex flex-col gap-3 rounded-lg border bg-card p-4',
        tile.hidden ? 'border-dashed border-muted-foreground/40' : 'border-border',
        isDragging && 'relative z-10 shadow-lg ring-2 ring-primary',
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t('pages.dashboard.tiles.dragHandle', { name })}
          title={t('pages.dashboard.tiles.dragHandle', { name })}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <span className={cn('truncate text-sm font-medium', tile.hidden && 'text-muted-foreground')}>{name}</span>
        {tile.hidden && <Badge variant="secondary" className="shrink-0 text-[10px]">{t('pages.dashboard.tiles.hiddenBadge')}</Badge>}
        <div className="ml-auto flex shrink-0 items-center">
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={isFirst} onClick={() => onMove(-1)}
            aria-label={t('pages.dashboard.tiles.moveEarlier', { name })} title={t('pages.dashboard.tiles.moveEarlier', { name })}>
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={isLast} onClick={() => onMove(1)}
            aria-label={t('pages.dashboard.tiles.moveLater', { name })} title={t('pages.dashboard.tiles.moveLater', { name })}>
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onChange({ hidden: !tile.hidden })}
            aria-label={t(tile.hidden ? 'pages.dashboard.tiles.show' : 'pages.dashboard.tiles.hide', { name })}
            title={t(tile.hidden ? 'pages.dashboard.tiles.show' : 'pages.dashboard.tiles.hide', { name })}>
            {tile.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('pages.dashboard.tiles.width', { name })}>
        <span className="mr-1 text-[11px] text-muted-foreground">{t('pages.dashboard.tiles.widthLabel')}</span>
        {WIDTHS.map((w) => (
          <Button key={w} size="sm" variant={tile.width === w ? 'default' : 'outline'} className="h-6 px-2 text-[11px]"
            aria-pressed={tile.width === w} onClick={() => onChange({ width: w })}>
            {t(`pages.dashboard.tiles.width${w}`)}
          </Button>
        ))}
      </div>

      {def?.hintKey && <p className="text-[11px] text-muted-foreground">{t(def.hintKey)}</p>}
    </div>
  );
}
