'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import {
  Heart,
  Pencil,
  Trash2,
  X,
  Loader2,
  Calendar,
  Tag,
  Palette,
  Shirt,
  Sparkles,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Eraser,
  Undo2,
  ImagePlus,
  Layers,
  Droplets,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
  Star,
  ImageIcon,
  Link2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Stinky } from '@/components/stinky/stinky';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from 'sonner';
import { useUpdateItem, useDeleteItem, useReanalyzeItem, useRotateImage, useRemoveBackground, useRestoreOriginal, useReplaceItemImage, useLogWash, useWashHistory, useItemWearStats, useItemWearHistory, useAddItemImage, useDeleteItemImage, useSetPrimaryImage } from '@/lib/hooks/use-items';
import { Item, CLOTHING_TYPES } from '@/lib/types';
import { swatchHex } from '@/lib/colors';
import { ColorCaptureField } from '@/components/color-capture-field';
import { GeneratePairingsDialog } from '@/components/generate-pairings-dialog';
import { useFeatures } from '@/lib/hooks/use-features';
import { useTagLabel } from '@/lib/tag-labels';
import {
  FORMALITY_LEVELS,
  QUICK_STYLES,
  SEASONS,
  asTagList,
  toggleStyle,
} from '@/components/bulk-upload/tag-choices';
import { CarePanel } from '@/components/care-panel';
import { ItemUsagePanel } from '@/components/item-usage-panel';
import { CareLabelField } from '@/components/add-item/care-label-field';
import { CareDraft } from '@/lib/hooks/use-intake';
import { cn } from '@/lib/utils';
import { garmentTileTint } from '@/lib/garment-tint';

/** "https://www.zara.com/es/…" -> "zara.com" */
function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

interface ItemDetailDialogProps {
  item: Item | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Images now use signed URLs from backend (item.image_url, item.thumbnail_url)

/** The one-tap tag chip, same shape as the quick review pass uses. */
function tagChipClass(active: boolean): string {
  return cn(
    'min-h-[44px] rounded-full px-3 text-[14px] font-semibold transition-colors active:scale-[0.97]',
    active ? 'bg-primary text-primary-foreground' : 'bg-panel text-foreground hover:bg-secondary'
  );
}

export function ItemDetailDialog({ item, open, onOpenChange }: ItemDetailDialogProps) {
  const t = useTranslations('wardrobe.item');
  const tc = useTranslations('common');
  const tagLabel = useTagLabel();
  const locale = useLocale();
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPairingsDialog, setShowPairingsDialog] = useState(false);
  const [imageKey, setImageKey] = useState(0);
  const [editForm, setEditForm] = useState({
    name: '',
    type: '',
    subtype: '',
    brand: '',
    primary_color: '',
    primary_color_hex: null as string | null,
    notes: '',
    favorite: false,
    wash_interval: undefined as number | undefined,
    style: [] as string[],
    formality: '',
    season: [] as string[],
  });
  // Care is edited through its own field (it can also be read off a photo), so
  // it lives beside editForm and is only sent when the user actually touched it.
  const [careDraft, setCareDraft] = useState<CareDraft | null>(null);
  const [careTouched, setCareTouched] = useState(false);
  const [showWashHistory, setShowWashHistory] = useState(false);
  const [showWearHistory, setShowWearHistory] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  const updateItem = useUpdateItem();
  const deleteItem = useDeleteItem();
  const reanalyzeItem = useReanalyzeItem();
  const rotateImage = useRotateImage();
  const removeBackground = useRemoveBackground();
  const restoreOriginal = useRestoreOriginal();
  const replaceImage = useReplaceItemImage();
  const replaceImageInputRef = useRef<HTMLInputElement>(null);
  const { data: features } = useFeatures();
  const logWash = useLogWash();
  const { data: washHistory } = useWashHistory(item?.id || '');
  const { data: wearStats } = useItemWearStats(item?.id || '');
  const { data: wearHistory } = useItemWearHistory(item?.id || '', 20);
  const addImage = useAddItemImage();
  const deleteImage = useDeleteItemImage();
  const setPrimary = useSetPrimaryImage();

  useEffect(() => {
    if (item) {
      setEditForm({
        name: item.name || '',
        type: item.type,
        subtype: item.subtype || '',
        brand: item.brand || '',
        primary_color: item.primary_color || '',
        primary_color_hex: item.primary_color_hex ?? null,
        notes: item.notes || '',
        favorite: item.favorite,
        wash_interval: item.wash_interval ?? undefined,
        // The tagger writes these into `tags`; the API mirrors them onto columns.
        // Read whichever is filled in, so a hand-tagged garment edits as cleanly
        // as an AI-tagged one, and both are empty when there is no AI at all.
        style: asTagList(item.tags?.style ?? item.style),
        formality: item.tags?.formality ?? item.formality ?? '',
        season: asTagList(item.tags?.season ?? item.season),
      });
      setIsEditing(false);
      setActiveImageIndex(0);
      setCareDraft(null);
      setCareTouched(false);
    }
  }, [item?.id]);

  if (!item) return null;

  const handleSave = async () => {
    try {
      await updateItem.mutateAsync({
        id: item.id,
        data: {
          name: editForm.name || undefined,
          type: editForm.type,
          subtype: editForm.subtype || undefined,
          brand: editForm.brand || undefined,
          primary_color: editForm.primary_color || undefined,
          // Sent even when null, so "I picked the colour off the list" really does
          // drop a shade that no longer matches.
          primary_color_hex: editForm.primary_color ? editForm.primary_color_hex : null,
          notes: editForm.notes || undefined,
          favorite: editForm.favorite,
          wash_interval: editForm.wash_interval,
          style: editForm.style,
          formality: editForm.formality || undefined,
          season: editForm.season,
          ...(careTouched ? { care: careDraft } : {}),
        },
      });
      setIsEditing(false);
      setCareTouched(false);
    } catch (error) {
      console.error('Failed to update item:', error);
    }
  };

  const handleMarkWashed = async () => {
    try {
      await logWash.mutateAsync({ id: item.id });
      toast.success(t('toast.markedWashed'));
    } catch (error) {
      console.error('Failed to log wash:', error);
      toast.error(t('toast.markWashedFailed'));
    }
  };

  const handleDelete = async () => {
    try {
      await deleteItem.mutateAsync(item.id);
      setShowDeleteConfirm(false);
      onOpenChange(false);
      toast.success(t('toast.deleted'), {
        description: item.name
          ? t('toast.deletedDescWithName', { name: item.name })
          : t('toast.deletedDescGeneric'),
      });
    } catch (error) {
      console.error('Failed to delete item:', error);
      toast.error(t('toast.deleteFailed'), {
        description: t('toast.deleteFailedDesc'),
      });
    }
  };

  const handleToggleFavorite = async () => {
    try {
      await updateItem.mutateAsync({
        id: item.id,
        data: { favorite: !item.favorite },
      });
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
    }
  };

  const handleReanalyze = async () => {
    try {
      await reanalyzeItem.mutateAsync(item.id);
      // Status will update to 'processing' and UI will reflect it
    } catch (error) {
      console.error('Failed to trigger re-analysis:', error);
    }
  };

  const handleRotate = async (direction: 'cw' | 'ccw') => {
    try {
      await rotateImage.mutateAsync({ id: item.id, direction });
      setImageKey((k) => k + 1);
      toast.success(t('toast.imageRotated'));
    } catch (error) {
      console.error('Failed to rotate image:', error);
      toast.error(t('toast.imageRotateFailed'));
    }
  };

  const handleRemoveBackground = async () => {
    try {
      await removeBackground.mutateAsync({ id: item.id });
      setImageKey((k) => k + 1);
      toast.success(t('toast.backgroundRemoved'));
    } catch (error) {
      console.error('Failed to remove background:', error);
      toast.error(t('toast.backgroundRemoveFailed'));
    }
  };

  const handleRestoreOriginal = async () => {
    try {
      await restoreOriginal.mutateAsync(item.id);
      setImageKey((k) => k + 1);
      toast.success(t('toast.originalRestored'));
    } catch (error) {
      console.error('Failed to restore original image:', error);
      toast.error(t('toast.originalRestoreFailed'));
    }
  };

  const handleReplaceImage = async (file: File) => {
    try {
      await replaceImage.mutateAsync({ itemId: item.id, file });
      setImageKey((k) => k + 1);
      setActiveImageIndex(0);
      toast.success(t('toast.imageReplaced'));
    } catch (error) {
      console.error('Failed to replace image:', error);
      toast.error(t('toast.imageReplaceFailed'));
    }
  };

  const isAnalyzing = reanalyzeItem.isPending || item.status === 'processing';

  // Use signed URL from backend for better quality in detail view
  const imageUrl = item.image_url || item.image_path;
  // The shade sampled off this garment when there is one, the palette's version of
  // the family otherwise. The name beside it is always the family.
  const swatch = swatchHex(item.primary_color, item.primary_color_hex);
  // The same plate the grid uses, off the same shade the swatch shows, so opening a
  // garment does not change its colour.
  const detailTint = garmentTileTint(item.primary_color, swatch);

  // AI-generated tags.
  //
  // `tags` is a free-form JSON column. The tagger is asked for `"style": ["…"]`,
  // but a model that answers with a bare string — `{"style": "pumps"}` — and rows
  // written before the vocabulary settled both land here, and `.map` on a string
  // is not a function: one odd garment used to take the whole dashboard to its
  // error page. Every list is read through `asTagList`, so it stays one garment.
  const tags = item.tags || {};
  const tagColors = asTagList(tags.colors);
  const tagStyles = asTagList(tags.style);
  const tagSeasons = asTagList(tags.season);
  const tagOccasions = asTagList(tags.occasion);
  const tagFeatures = asTagList(tags.features);
  const hasAiTags = !!(tagColors.length || tags.pattern || tags.material ||
                   tagStyles.length || tagSeasons.length || tags.formality || tags.fit ||
                   tagOccasions.length || tags.condition || tagFeatures.length);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[90dvh] flex flex-col p-0 overflow-hidden [&>button]:hidden">
          {/* Header - sticky */}
          <DialogHeader className="flex-shrink-0 space-y-3 px-5 pb-3 pt-4 text-left sm:text-left">
            <div className="flex items-center justify-between gap-3">
              <DialogTitle className="min-w-0 truncate pr-0 text-xl">
                {item.name || tagLabel('types', item.type)}
              </DialogTitle>
              <Button
                variant="secondary"
                size="icon"
                onClick={() => onOpenChange(false)}
                className="shrink-0"
                title={t('toolbar.close')}
                aria-label={t('toolbar.close')}
              >
                <X className="h-5 w-5" strokeWidth={1.75} />
              </Button>
            </div>
            {/* Editing used to be an unlabelled pencil at the far end of a strip
                that scrolls off screen on a phone, which is the same as not being
                there. It is now a named button that never scrolls away, and the
                rest of the photo tools keep the strip to themselves. */}
            <Button
              variant={isEditing ? 'secondary' : 'default'}
              className="w-full justify-center"
              onClick={() => setIsEditing(!isEditing)}
              aria-pressed={isEditing}
            >
              {isEditing ? (
                <X className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
              ) : (
                <Pencil className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
              )}
              {isEditing ? t('toolbar.cancelEditing') : t('toolbar.editTags')}
            </Button>
            <div
              role="toolbar"
              aria-label={t('toolbar.label')}
              className="-mx-5 flex items-center gap-1.5 overflow-x-auto scrollbar-none px-5 pb-0.5"
            >
              <Button
                variant="secondary"
                size="icon"
                className="shrink-0"
                onClick={handleToggleFavorite}
                disabled={updateItem.isPending}
                aria-pressed={!!item.favorite}
                title={t('toolbar.toggleFavorite')}
                aria-label={t('toolbar.toggleFavorite')}
              >
                <Heart
                  strokeWidth={1.75}
                  className={`h-5 w-5 ${
                    item.favorite ? 'fill-signature text-foreground' : 'text-foreground'
                  }`}
                />
              </Button>
              <Button
                variant="secondary"
                size="icon"
                className="shrink-0"
                onClick={() => setShowPairingsDialog(true)}
                disabled={item.status !== 'ready'}
                title={t('toolbar.findMatchingOutfits')}
                aria-label={t('toolbar.findMatchingOutfits')}
              >
                <Layers className="h-5 w-5" strokeWidth={1.75} />
              </Button>
              <Button
                variant="secondary"
                size="icon"
                className="shrink-0"
                onClick={handleReanalyze}
                disabled={isAnalyzing}
                title={isAnalyzing ? t('toolbar.analysisInProgress') : t('toolbar.reanalyzeWithAi')}
                aria-label={isAnalyzing ? t('toolbar.analysisInProgress') : t('toolbar.reanalyzeWithAi')}
              >
                <RefreshCw
                  className={`h-5 w-5 ${isAnalyzing ? 'animate-spin' : ''}`}
                />
              </Button>
              <Button
                variant="secondary"
                size="icon"
                className="shrink-0"
                onClick={() => handleRotate('ccw')}
                disabled={rotateImage.isPending}
                title={t('toolbar.rotateLeft')}
                aria-label={t('toolbar.rotateLeft')}
              >
                {rotateImage.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <RotateCcw className="h-5 w-5" strokeWidth={1.75} />
                )}
              </Button>
              <Button
                variant="secondary"
                size="icon"
                className="shrink-0"
                onClick={() => handleRotate('cw')}
                disabled={rotateImage.isPending}
                title={t('toolbar.rotateRight')}
                aria-label={t('toolbar.rotateRight')}
              >
                {rotateImage.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <RotateCw className="h-5 w-5" strokeWidth={1.75} />
                )}
              </Button>
              {features?.background_removal && (
                <Button
                  variant="secondary"
                  size="icon"
                  className="shrink-0"
                  onClick={handleRemoveBackground}
                  disabled={removeBackground.isPending || !item.image_url}
                  title={t('toolbar.removeBackground')}
                  aria-label={t('toolbar.removeBackground')}
                >
                  {removeBackground.isPending ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Eraser className="h-5 w-5" strokeWidth={1.75} />
                  )}
                </Button>
              )}
              {item.original_image_path && (
                <Button
                  variant="secondary"
                  size="icon"
                  className="shrink-0"
                  onClick={handleRestoreOriginal}
                  disabled={restoreOriginal.isPending}
                  title={t('toolbar.undoBackgroundRemoval')}
                  aria-label={t('toolbar.undoBackgroundRemoval')}
                >
                  {restoreOriginal.isPending ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Undo2 className="h-5 w-5" strokeWidth={1.75} />
                  )}
                </Button>
              )}
              <Button
                variant="secondary"
                size="icon"
                className="shrink-0"
                onClick={() => replaceImageInputRef.current?.click()}
                disabled={replaceImage.isPending}
                title={t('toolbar.replaceImage')}
                aria-label={t('toolbar.replaceImage')}
              >
                {replaceImage.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <ImagePlus className="h-5 w-5" strokeWidth={1.75} />
                )}
              </Button>
              <input
                ref={replaceImageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    handleReplaceImage(file);
                  }
                  e.target.value = '';
                }}
              />
            </div>
          </DialogHeader>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-1">
            <div className="grid gap-6 sm:grid-cols-2 [&>*]:min-w-0">
            {/* Image Gallery */}
            <div className="space-y-2">
              <div
                className={cn(
                  'relative aspect-square overflow-hidden rounded-tile',
                  detailTint.className
                )}
                style={detailTint.style}
              >
                {(() => {
                  const allImages = [
                    { url: `${imageUrl}&v=${imageKey}`, id: 'primary' },
                    ...(item.additional_images || []).map((img) => ({ url: img.image_url, id: img.id })),
                  ];
                  const currentImage = allImages[activeImageIndex] || allImages[0];
                  return (
                    <>
                      <Image
                        key={`${currentImage.id}-${imageKey}`}
                        src={currentImage.url}
                        alt={item.name || tagLabel('types', item.type)}
                        fill
                        className={cn(
                          'object-contain p-4',
                          // Only a white-backed photo needs multiplying for the
                          // tint to show; a real cut-out is already transparent.
                          !item.has_cutout && 'mix-blend-multiply'
                        )}
                        sizes="(max-width: 640px) 100vw, 50vw"
                      />
                      {allImages.length > 1 && (
                        <>
                          <button
                            type="button"
                            aria-label={tc('aria.previousImage')}
                            className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() => setActiveImageIndex((i) => (i - 1 + allImages.length) % allImages.length)}
                          >
                            <ChevronLeft className="h-5 w-5" strokeWidth={1.75} />
                          </button>
                          <button
                            type="button"
                            aria-label={tc('aria.nextImage')}
                            className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() => setActiveImageIndex((i) => (i + 1) % allImages.length)}
                          >
                            <ChevronRight className="h-5 w-5" strokeWidth={1.75} />
                          </button>
                          <div className="absolute bottom-1 left-1/2 flex -translate-x-1/2">
                            {allImages.map((_, idx) => (
                              <button
                                key={idx}
                                type="button"
                                aria-label={t('imageN', { n: idx + 1 })}
                                aria-current={idx === activeImageIndex ? 'true' : undefined}
                                className="flex h-6 w-6 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                onClick={() => setActiveImageIndex(idx)}
                              >
                                <span className={`h-2 w-2 rounded-full ${idx === activeImageIndex ? 'bg-foreground' : 'bg-foreground/25'}`} />
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </>
                  );
                })()}
                {isAnalyzing && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-panel/85 backdrop-blur-[2px]" role="status" aria-live="polite">
                    <div className="flex h-24 w-24 items-center justify-center rounded-full bg-signature-soft">
                      <Stinky state="thinking" size={80} label="" />
                    </div>
                    <span className="text-sm font-bold text-foreground">{t('analyzing')}</span>
                  </div>
                )}
              </div>
              {/* Thumbnail strip */}
              {(item.additional_images?.length > 0 || isEditing) && (
                <div className="flex gap-2 overflow-x-auto p-1">
                  <button
                    type="button"
                    className={`relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-[14px] bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${activeImageIndex === 0 ? 'ring-[2.5px] ring-inset ring-signature' : ''}`}
                    onClick={() => setActiveImageIndex(0)}
                    aria-label={tc('primary')}
                    aria-current={activeImageIndex === 0 ? 'true' : undefined}
                  >
                    <Image src={imageUrl} alt={tc('primary')} fill className="object-contain p-1" sizes="48px" />
                  </button>
                  {(item.additional_images || []).map((img, idx) => (
                    <div key={img.id} className="relative flex-shrink-0">
                      <button
                        type="button"
                        className={`relative h-12 w-12 overflow-hidden rounded-[14px] bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${activeImageIndex === idx + 1 ? 'ring-[2.5px] ring-inset ring-signature' : ''}`}
                        onClick={() => setActiveImageIndex(idx + 1)}
                        aria-label={t('imageN', { n: idx + 2 })}
                        aria-current={activeImageIndex === idx + 1 ? 'true' : undefined}
                      >
                        <Image src={img.thumbnail_url || img.image_url} alt="" fill className="object-contain p-1" sizes="48px" />
                      </button>
                      {isEditing && (
                        <div className="absolute -right-1.5 -top-1.5 flex gap-0.5">
                          <button
                            type="button"
                            className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            title={t('toolbar.setAsPrimary')}
                            aria-label={t('toolbar.setAsPrimary')}
                            onClick={() => {
                              setPrimary.mutate({ itemId: item.id, imageId: img.id });
                              setActiveImageIndex(0);
                            }}
                          >
                            <Star className="h-3 w-3" strokeWidth={2} />
                          </button>
                          <button
                            type="button"
                            className="flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            title={t('toolbar.deleteImage')}
                            aria-label={t('toolbar.deleteImage')}
                            onClick={() => {
                              deleteImage.mutate({ itemId: item.id, imageId: img.id });
                              if (activeImageIndex > idx) setActiveImageIndex((i) => i - 1);
                            }}
                          >
                            <X className="h-3 w-3" strokeWidth={2} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {isEditing && (item.additional_images?.length || 0) < 4 && (
                    <label
                      className="flex h-12 w-12 flex-shrink-0 cursor-pointer items-center justify-center rounded-[14px] border-2 border-dashed border-border bg-panel transition-colors hover:bg-accent focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
                      aria-label={t('addImage')}
                    >
                      {addImage.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : (
                        <Plus className="h-4 w-4 text-muted-foreground" />
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            addImage.mutate({ itemId: item.id, file });
                          }
                          e.target.value = '';
                        }}
                      />
                    </label>
                  )}
                </div>
              )}
            </div>

            {/* Details */}
            <div className="space-y-4">
              {isEditing ? (
                // Edit form
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label className="font-bold">{t('form.name')}</Label>
                    <Input
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      placeholder={t('form.namePlaceholder')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">{t('form.type')}</Label>
                    <Select
                      value={editForm.type}
                      onValueChange={(v) => setEditForm({ ...editForm, type: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CLOTHING_TYPES.map((ty) => (
                          <SelectItem key={ty.value} value={ty.value}>
                            {tagLabel('types', ty.value)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">{t('form.brand')}</Label>
                    <Input
                      value={editForm.brand}
                      onChange={(e) => setEditForm({ ...editForm, brand: e.target.value })}
                      placeholder={t('form.brandPlaceholder')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-color" className="font-bold">{t('form.primaryColor')}</Label>
                    <ColorCaptureField
                      id="edit-color"
                      value={editForm.primary_color}
                      hex={editForm.primary_color_hex}
                      imageUrl={imageUrl}
                      onPick={({ color, hex }) =>
                        setEditForm({
                          ...editForm,
                          primary_color: color,
                          // A family off the list says nothing about the shade, so
                          // the old sample is cleared rather than left to contradict
                          // the new name.
                          primary_color_hex: hex ?? null,
                        })
                      }
                    />
                  </div>
                  {/* The three tags that decide when the stylist reaches for this
                      garment. Chips rather than selects: one tap each, and with no
                      AI they start empty rather than pre-filled with a guess. */}
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-bold">
                      {t('form.style')}{' '}
                      <span className="font-normal text-muted-foreground">{t('form.styleHint')}</span>
                    </legend>
                    <div className="flex flex-wrap gap-1.5">
                      {QUICK_STYLES.map((value) => {
                        const active = editForm.style.includes(value);
                        return (
                          <button
                            key={value}
                            type="button"
                            aria-pressed={active}
                            onClick={() =>
                              setEditForm({ ...editForm, style: toggleStyle(editForm.style, value) })
                            }
                            className={tagChipClass(active)}
                          >
                            {tagLabel('styles', value)}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>

                  <fieldset className="space-y-2">
                    <legend className="text-sm font-bold">{t('form.formality')}</legend>
                    <div className="flex flex-wrap gap-1.5">
                      {FORMALITY_LEVELS.map((value) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={editForm.formality === value}
                          onClick={() =>
                            setEditForm({
                              ...editForm,
                              formality: editForm.formality === value ? '' : value,
                            })
                          }
                          className={tagChipClass(editForm.formality === value)}
                        >
                          {tagLabel('formality', value)}
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  <fieldset className="space-y-2">
                    <legend className="text-sm font-bold">{t('form.season')}</legend>
                    <div className="flex flex-wrap gap-1.5">
                      {SEASONS.map((value) => {
                        const active = editForm.season.includes(value);
                        return (
                          <button
                            key={value}
                            type="button"
                            aria-pressed={active}
                            onClick={() =>
                              setEditForm({
                                ...editForm,
                                season: active
                                  ? editForm.season.filter((s) => s !== value)
                                  : [...editForm.season, value],
                              })
                            }
                            className={tagChipClass(active)}
                          >
                            {tagLabel('seasons', value)}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>

                  <div className="space-y-2">
                    <Label className="font-bold">{t('form.notes')}</Label>
                    <Textarea
                      value={editForm.notes}
                      onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                      placeholder={t('form.notesPlaceholder')}
                      rows={3}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="font-bold">{t('form.washInterval')}</Label>
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      value={editForm.wash_interval ?? ''}
                      onChange={(e) => setEditForm({ ...editForm, wash_interval: e.target.value ? parseInt(e.target.value) : undefined })}
                      placeholder={t('form.washIntervalDefault', { days: item.effective_wash_interval })}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t('form.washIntervalHelp')}
                    </p>
                  </div>
                  <CareLabelField
                    key={item.id}
                    initialValue={item.care}
                    value={careDraft}
                    onChange={(next) => {
                      setCareDraft(next);
                      setCareTouched(true);
                    }}
                    idPrefix="edit-care"
                  />
                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="secondary"
                      className="flex-1"
                      onClick={() => setIsEditing(false)}
                    >
                      {t('form.cancel')}
                    </Button>
                    <Button
                      className="flex-1"
                      onClick={handleSave}
                      disabled={updateItem.isPending}
                    >
                      {updateItem.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : null}
                      {t('form.save')}
                    </Button>
                  </div>
                </div>
              ) : (
                // View mode
                <div className="space-y-4">
                  {/* Basic info */}
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2 text-sm">
                      <Shirt className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
                      <span className="font-bold">{tagLabel('types', item.type)}</span>
                      {item.subtype && (
                        <span className="text-muted-foreground">• {item.subtype}</span>
                      )}
                    </div>
                    {item.brand && (
                      <div className="flex items-center gap-2 text-sm">
                        <Tag className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
                        <span>{item.brand}</span>
                      </div>
                    )}
                    {swatch && item.primary_color && (
                      <div className="flex items-center gap-2 text-sm">
                        <Palette className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
                        <div
                          className="h-4 w-4 rounded-full ring-1 ring-inset ring-black/10"
                          style={{ backgroundColor: swatch }}
                        />
                        <span>{tagLabel('colors', item.primary_color)}</span>
                      </div>
                    )}
                  </div>

                  {/* Cuánto la usas: veces puesta, coste por uso, con qué combina,
                      qué hacer con ella y «Rescátala». Replaces the one-line wear
                      count that used to sit in the info rows above. */}
                  <ItemUsagePanel item={item} />

                  {/* Wash Status */}
                  <div className="space-y-2.5 rounded-lg bg-panel p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-[15px] font-bold">
                        <span className={`flex h-7 w-7 items-center justify-center rounded-full ${item.needs_wash ? 'bg-pop-sky text-pop-foreground' : 'bg-background text-muted-foreground'}`}>
                          <Droplets className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </span>
                        {t('wash.sectionTitle')}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleMarkWashed}
                        disabled={logWash.isPending}
                      >
                        {logWash.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Droplets className="h-3.5 w-3.5" strokeWidth={1.75} />
                        )}
                        {t('wash.markWashed')}
                      </Button>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{t('wash.wearsSinceWash', { count: item.wears_since_wash, max: item.effective_wash_interval })}</span>
                        {item.needs_wash && (
                          <Badge variant="sky">{t('wash.needsWashing')}</Badge>
                        )}
                      </div>
                      <Progress
                        value={Math.min((item.wears_since_wash / item.effective_wash_interval) * 100, 100)}
                        className={`h-2 bg-background ${item.needs_wash ? '[&>div]:bg-pop-sky' : ''}`}
                      />
                      {item.last_washed_at && (
                        <p className="text-xs text-muted-foreground">
                          {t('wash.lastWashed', { date: new Date(item.last_washed_at).toLocaleDateString(locale) })}
                        </p>
                      )}
                    </div>

                    {/* Wash History */}
                    {washHistory && washHistory.length > 0 && (
                      <Collapsible open={showWashHistory} onOpenChange={setShowWashHistory}>
                        <CollapsibleTrigger className="flex min-h-[32px] items-center gap-1 rounded-full text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showWashHistory ? 'rotate-180' : ''}`} />
                          {t('wash.historyToggle', { count: washHistory.length })}
                        </CollapsibleTrigger>
                        <CollapsibleContent className="mt-1.5 space-y-1">
                          {washHistory.map((wash) => (
                            <div key={wash.id} className="text-xs text-muted-foreground flex items-center gap-2">
                              <span>{new Date(wash.washed_at).toLocaleDateString(locale)}</span>
                              {wash.method && <Badge variant="outline" className="text-[11px]">{wash.method}</Badge>}
                              {wash.notes && <span className="truncate">{wash.notes}</span>}
                            </div>
                          ))}
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </div>

                  {/* Wear History */}
                  {item.wear_count > 0 && wearStats && (
                    <div className="space-y-2.5 rounded-lg bg-panel p-4">
                      <div className="flex items-center gap-2 text-[15px] font-bold">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-pop-amber text-pop-foreground">
                          <Calendar className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </span>
                        {t('wear.sectionTitle')}
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-[14px] bg-background p-2.5">
                          <p className="text-muted-foreground">{t('wear.totalWears')}</p>
                          <p className="text-sm font-bold">{wearStats.total_wears}</p>
                        </div>
                        <div className="rounded-[14px] bg-background p-2.5">
                          <p className="text-muted-foreground">{t('wear.lastWorn')}</p>
                          <p className="text-sm font-bold">
                            {wearStats.days_since_last_worn === null
                              ? t('wear.never')
                              : wearStats.days_since_last_worn === 0
                              ? t('wear.today')
                              : t('wear.daysAgo', { days: wearStats.days_since_last_worn })}
                          </p>
                        </div>
                        <div className="rounded-[14px] bg-background p-2.5">
                          <p className="text-muted-foreground">{t('wear.avgPerMonth')}</p>
                          <p className="text-sm font-bold">{wearStats.average_wears_per_month}</p>
                        </div>
                        {wearStats.most_common_occasion && (
                          <div className="rounded-[14px] bg-background p-2.5">
                            <p className="text-muted-foreground">{t('wear.usualOccasion')}</p>
                            <p className="text-sm font-bold capitalize">{wearStats.most_common_occasion}</p>
                          </div>
                        )}
                      </div>

                      {/* Mini bar chart - wear by month */}
                      {Object.keys(wearStats.wear_by_month).length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">{t('wear.lastSixMonths')}</p>
                          <div className="flex items-end gap-1 h-12">
                            {Object.entries(wearStats.wear_by_month).map(([month, count]) => {
                              const maxCount = Math.max(...Object.values(wearStats.wear_by_month), 1);
                              const height = (count / maxCount) * 100;
                              return (
                                <div key={month} className="flex flex-1 flex-col items-center gap-0.5" title={t('wear.monthTooltip', { month, count })}>
                                  <div
                                    className="min-h-[2px] w-full rounded-full bg-signature"
                                    style={{ height: `${Math.max(height, 4)}%` }}
                                  />
                                  <span className="text-[9px] text-muted-foreground">{month.split('-')[1]}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Wear timeline */}
                      {wearHistory && wearHistory.length > 0 && (
                        <Collapsible open={showWearHistory} onOpenChange={setShowWearHistory}>
                          <CollapsibleTrigger className="flex min-h-[32px] items-center gap-1 rounded-full text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showWearHistory ? 'rotate-180' : ''}`} />
                            {t('wear.timelineToggle', { count: wearHistory.length })}
                          </CollapsibleTrigger>
                          <CollapsibleContent className="mt-1.5 space-y-1.5">
                            {wearHistory.map((entry) => (
                              <div key={entry.id} className="text-xs flex items-start gap-2">
                                <span className="text-muted-foreground whitespace-nowrap">
                                  {new Date(entry.worn_at).toLocaleDateString(locale)}
                                </span>
                                {entry.occasion && (
                                  <Badge variant="outline" className="text-[11px]">{entry.occasion}</Badge>
                                )}
                                {entry.outfit && (
                                  <div className="flex -space-x-1">
                                    {entry.outfit.items.slice(0, 3).map((oi) => (
                                      <div
                                        key={oi.id}
                                        className="h-6 w-6 overflow-hidden rounded-full border-2 border-panel bg-background"
                                        title={oi.name || tagLabel('types', oi.type)}
                                      >
                                        {oi.thumbnail_url && (
                                          <Image
                                            src={oi.thumbnail_url}
                                            alt={oi.name || tagLabel('types', oi.type)}
                                            width={20}
                                            height={20}
                                            className="h-full w-full object-contain"
                                          />
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </CollapsibleContent>
                        </Collapsible>
                      )}
                    </div>
                  )}

                  {/* AI Analysis */}
                  {(hasAiTags || item.ai_description) && item.status === 'ready' && (
                    <div className="space-y-2.5 rounded-lg bg-signature-soft p-4">
                      <div className="flex flex-wrap items-center gap-2 text-[15px] font-bold">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-signature text-signature-foreground">
                          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </span>
                        {t('ai.title')}
                        {item.ai_confidence !== undefined && item.ai_confidence > 0 && (
                          <Badge variant="outline" className="border-foreground/15 bg-background text-xs">
                            {t('ai.completeBadge', { pct: Math.round(item.ai_confidence * 100) })}
                          </Badge>
                        )}
                        {item.tags?.logprobs_confidence != null && (
                          <Badge variant="outline" className="border-foreground/15 bg-background text-xs">
                            {t('ai.confidentBadge', { pct: Math.round(item.tags.logprobs_confidence * 100) })}
                          </Badge>
                        )}
                      </div>
                      {item.ai_description && (
                        <p className="text-sm text-foreground/80">
                          &ldquo;{item.ai_description}&rdquo;
                        </p>
                      )}
                      {hasAiTags && <div className="flex flex-wrap gap-1.5">
                        {tagColors.map((color) => (
                          <Badge key={color} variant="outline" className="border-0 bg-background text-xs font-semibold">
                            {tagLabel('colors', color)}
                          </Badge>
                        ))}
                        {tags.pattern && (
                          <Badge variant="outline" className="border-0 bg-background text-xs font-semibold">
                            {tagLabel('patterns', tags.pattern)}
                          </Badge>
                        )}
                        {tags.material && (
                          <Badge variant="outline" className="border-0 bg-background text-xs font-semibold">
                            {tagLabel('materials', tags.material)}
                          </Badge>
                        )}
                        {tagStyles.map((s) => (
                          <Badge key={s} variant="outline" className="border-0 bg-background text-xs font-semibold">
                            {tagLabel('styles', s)}
                          </Badge>
                        ))}
                        {tagSeasons.map((s) => (
                          <Badge key={s} variant="outline" className="border-0 bg-background text-xs font-semibold">
                            {tagLabel('seasons', s)}
                          </Badge>
                        ))}
                        {tags.formality && (
                          <Badge variant="outline" className="border-0 bg-background text-xs font-semibold">
                            {tagLabel('formality', tags.formality)}
                          </Badge>
                        )}
                        {tags.fit && (
                          <Badge variant="outline" className="border-0 bg-background text-xs font-semibold">
                            {t('ai.fitLabel', { fit: tagLabel('fit', tags.fit) })}
                          </Badge>
                        )}
                        {tagOccasions.map((o) => (
                          <Badge key={o} variant="outline" className="border-0 bg-background text-xs font-semibold">
                            {tagLabel('occasions', o)}
                          </Badge>
                        ))}
                        {tags.condition && (
                          <Badge variant="outline" className="border-0 bg-background text-xs font-semibold">
                            {tags.condition}
                          </Badge>
                        )}
                        {tagFeatures.map((f) => (
                          <Badge key={f} variant="outline" className="border-0 bg-background text-xs font-semibold">
                            {f}
                          </Badge>
                        ))}
                      </div>}
                    </div>
                  )}

                  {/* Care label */}
                  <CarePanel care={item.care} hints={item.care_hints} />

                  {/* Where it came from */}
                  {item.source_url && (
                    <a
                      href={item.source_url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="flex items-center gap-2 text-sm font-semibold text-foreground underline-offset-4 hover:underline"
                    >
                      <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                      <span className="min-w-0 truncate">{sourceHost(item.source_url)}</span>
                    </a>
                  )}

                  {/* Notes */}
                  {item.notes && (
                    <div className="space-y-1">
                      <p className="text-[15px] font-bold">{t('notesLabel')}</p>
                      <p className="text-sm text-muted-foreground">{item.notes}</p>
                    </div>
                  )}

                  {/* Metadata */}
                  <div className="text-xs text-muted-foreground">
                    {t('addedOn', { date: new Date(item.created_at).toLocaleDateString(locale) })}
                  </div>
                </div>
              )}
            </div>
            </div>

            {/* Delete button - separated from other actions for safety */}
            {!isEditing && (
              <div className="mt-6 border-t border-border pt-4">
                <Button
                  variant="ghost"
                  className="-ml-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                  {t('deleteButton')}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteConfirm.descriptionWithName', { name: item.name || tagLabel('types', item.type) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteItem.isPending}
            >
              {deleteItem.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              {tc('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Generate Pairings Dialog */}
      <GeneratePairingsDialog
        item={item}
        open={showPairingsDialog}
        onOpenChange={setShowPairingsDialog}
      />
    </>
  );
}
