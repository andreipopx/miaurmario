'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDownToLine, ArrowUpFromLine, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import type { StudioItem } from '@/lib/studio/editor-state';

interface CanvasPanelProps {
  items: StudioItem[];
  onRemove: (itemId: string) => void;
  onMove: (itemId: string, pos_x: number, pos_y: number) => void;
  onBringToFront: (itemId: string) => void;
  onSendToBack: (itemId: string) => void;
}

// Canvas is a 3:4 portrait — lookbook page proportions. Coordinates
// on items are normalized [0..1] against this box so they survive resizes.
const CANVAS_MARGIN = 0.04;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

interface DraggableCanvasItemProps {
  item: StudioItem;
  isSelected: boolean;
  onSelect: (itemId: string) => void;
}

function DraggableCanvasItem({
  item,
  isSelected,
  onSelect,
}: DraggableCanvasItemProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: item.id });

  // Compose the absolute position (percent, from item state) with the live
  // drag transform (pixels, from @dnd-kit). We anchor by the item's center
  // via translate(-50%, -50%) so pos_x/pos_y describe the visual center.
  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${(item.pos_x ?? 0.5) * 100}%`,
    top: `${(item.pos_y ?? 0.5) * 100}%`,
    transform: `translate(-50%, -50%) ${CSS.Translate.toString(transform) ?? ''} scale(${item.scale ?? 1}) rotate(${item.rotation ?? 0}deg)`,
    zIndex: (isDragging ? 999 : item.z_index ?? 0) + (isSelected ? 100 : 0),
    touchAction: 'none',
    cursor: isDragging ? 'grabbing' : 'grab',
    transition: isDragging ? 'none' : 'box-shadow 200ms, filter 200ms',
    willChange: 'transform',
  };

  const src = item.thumbnail_url ?? item.image_url ?? null;

  return (
    <button
      ref={setNodeRef}
      type="button"
      style={style}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(item.id);
      }}
      className={cn(
        'no-callout select-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-panel',
        'w-[26%] max-w-[140px] aspect-square',
        'rounded-tile bg-transparent',
        isSelected && 'ring-2 ring-signature ring-offset-2 ring-offset-panel',
        isDragging && 'opacity-90 drop-shadow-[0_10px_20px_rgba(0,0,0,0.25)]'
      )}
      aria-label={item.name ?? item.type}
      aria-pressed={isSelected}
    >
      {src ? (
        <Image
          src={src}
          alt={item.name ?? item.type}
          fill
          className="object-contain pointer-events-none drop-shadow-[0_3px_6px_rgba(0,0,0,0.18)]"
          sizes="(max-width: 640px) 30vw, 20vw"
          draggable={false}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center rounded-tile bg-background">
          <span className="text-xs text-muted-foreground">{item.type}</span>
        </div>
      )}
    </button>
  );
}

/**
 * Free-form canvas for arranging outfit items. iPhone-first: a
 * long-press starts the drag on touch so scrolling still works over the panel.
 */
export function CanvasPanel({
  items,
  onRemove,
  onMove,
  onBringToFront,
  onSendToBack,
}: CanvasPanelProps) {
  const t = useTranslations('studioCanvas');
  const canvasRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 3 } }),
    // Long-press so a swipe over the canvas can still scroll on iPhone.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const target = items.find((i) => i.id === event.active.id);
      if (!target) return;
      const dx = event.delta.x / rect.width;
      const dy = event.delta.y / rect.height;
      const nextX = clamp(
        (target.pos_x ?? 0.5) + dx,
        CANVAS_MARGIN,
        1 - CANVAS_MARGIN
      );
      const nextY = clamp(
        (target.pos_y ?? 0.5) + dy,
        CANVAS_MARGIN,
        1 - CANVAS_MARGIN
      );
      onMove(String(event.active.id), nextX, nextY);
    },
    [items, onMove]
  );

  const selected = useMemo(
    () => items.find((i) => i.id === selectedId) ?? null,
    [items, selectedId]
  );

  if (items.length === 0) {
    return (
      <div
        className={cn(
          'no-callout relative mx-auto aspect-[3/4] w-full max-w-md rounded-lg',
          'bg-panel border-2 border-dashed border-border',
          'flex items-center justify-center p-8'
        )}
      >
        <div className="space-y-2 text-center">
          <p className="text-lg font-bold text-foreground">
            {t('emptyTitle')}
          </p>
          <p className="text-sm text-muted-foreground">{t('emptyHint')}</p>
        </div>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="mx-auto w-full max-w-md space-y-3">
        <div
          ref={canvasRef}
          onClick={() => setSelectedId(null)}
          data-no-swipe
          data-no-ptr
          className={cn(
            'no-callout relative aspect-[3/4] w-full overflow-hidden rounded-lg',
            'bg-panel'
          )}
        >
          {items.map((item) => (
            <DraggableCanvasItem
              key={item.id}
              item={item}
              isSelected={selectedId === item.id}
              onSelect={setSelectedId}
            />
          ))}
        </div>

        {selected && (
          <div
            role="toolbar"
            aria-label={t('toolbarLabel')}
            className={cn(
              'flex items-center justify-center gap-0.5 p-1',
              'rounded-full bg-primary text-primary-foreground shadow-[0_10px_30px_rgba(0,0,0,0.12)]',
              'mx-auto w-fit'
            )}
          >
            <button
              type="button"
              onClick={() => onBringToFront(selected.id)}
              className="flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-primary-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signature"
              aria-label={t('bringToFront')}
              title={t('bringToFront')}
            >
              <ArrowUpFromLine className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onSendToBack(selected.id)}
              className="flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-primary-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signature"
              aria-label={t('sendToBack')}
              title={t('sendToBack')}
            >
              <ArrowDownToLine className="h-4 w-4" />
            </button>
            <span className="mx-1 max-w-[8rem] truncate text-[13px] font-semibold text-primary-foreground/80">
              {selected.name ?? selected.type}
            </span>
            <button
              type="button"
              onClick={() => {
                onRemove(selected.id);
                setSelectedId(null);
              }}
              className="flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-primary-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signature"
              aria-label={t('remove')}
              title={t('remove')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {!selected && (
          <p className="text-center text-xs text-muted-foreground">
            {t('hint')}
          </p>
        )}
      </div>
    </DndContext>
  );
}

/**
 * Read-only version of the canvas used on the outfit detail page — renders
 * items at their saved coordinates so the arrangement the user built survives
 * navigation. Falls back to `null` if the outfit has no spatial layout (the
 * caller should render the classic grid instead).
 */
export function CanvasPreview({ items }: { items: StudioItem[] }) {
  if (items.length === 0) return null;
  return (
    <div
      className={cn(
        'relative mx-auto aspect-[3/4] w-full max-w-md overflow-hidden rounded-lg',
        'bg-panel'
      )}
    >
      {items.map((item) => {
        const src = item.thumbnail_url ?? item.image_url ?? null;
        return (
          <div
            key={item.id}
            style={{
              position: 'absolute',
              left: `${(item.pos_x ?? 0.5) * 100}%`,
              top: `${(item.pos_y ?? 0.5) * 100}%`,
              transform: `translate(-50%, -50%) scale(${item.scale ?? 1}) rotate(${item.rotation ?? 0}deg)`,
              zIndex: item.z_index ?? 0,
            }}
            className="w-[26%] max-w-[140px] aspect-square"
          >
            {src ? (
              <Image
                src={src}
                alt={item.name ?? item.type}
                fill
                className="object-contain drop-shadow-[0_3px_6px_rgba(0,0,0,0.18)]"
                sizes="(max-width: 640px) 30vw, 20vw"
                draggable={false}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center rounded-tile bg-background">
                <span className="text-xs text-muted-foreground">
                  {item.type}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
