'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import {
  Check,
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
  Scissors,
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
import { PhotoViewPicker, useImageViewLabel } from '@/components/photo-view-picker';
import { MergeBackDialog } from '@/components/merge-back-dialog';
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
import { useUpdateItem, useDeleteItem, useReanalyzeItem, useBrushCutout, useResetCutout, useRemoveBackground, useRestoreOriginal, useReplaceItemImage, useLogWash, useWashHistory, useItemWearStats, useItemWearHistory, useAddItemImage, useDeleteItemImage, useSetItemImageView, useSetPrimaryImage } from '@/lib/hooks/use-items';
import { useRotationQueue } from '@/lib/hooks/use-rotation-queue';
import { AlphaBrush } from '@/components/shared/alpha-brush';
import { SubtypeField } from '@/components/bulk-upload/subtype-field';
import { subtypeAfterTypeChange } from '@/lib/subtypes';
import { garmentFrameStyle } from '@/lib/garment-framing';
import { CLOTHING_TYPES, type ImageView, type Item } from '@/lib/types';
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

/**
 * A row in an overflow menu: what it is called, and a sentence saying what it does.
 *
 * The strip this replaced was icon-only, and the icons were not the problem — the
 * problem was that "scissors" and "undo" do not say *quitar el fondo* and *volver a
 * la foto original* to anybody who has not read the code. So a row is wide, named,
 * and explains itself, which is affordable precisely because these are the rare
 * actions: nobody is tapping them twenty times in a row.
 */
function OverflowAction({
  icon,
  label,
  description,
  onClick,
  disabled = false,
  busy = false,
  destructive = false,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={cn(
        'flex min-h-[44px] w-full items-start gap-3 rounded-[14px] px-3 py-2.5 text-left',
        'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:pointer-events-none disabled:opacity-50',
        destructive ? 'text-destructive hover:bg-destructive/10' : 'hover:bg-panel'
      )}
    >
      <span className="mt-0.5 shrink-0" aria-hidden>
        {busy ? (
          <Loader2 className="h-[18px] w-[18px] animate-spin motion-reduce:animate-none" />
        ) : (
          icon
        )}
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold leading-snug">{label}</span>
        <span
          className={cn(
            'block text-[12px] leading-snug',
            destructive ? 'text-destructive/85' : 'text-muted-foreground'
          )}
        >
          {description}
        </span>
      </span>
    </button>
  );
}

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
  const tBrush = useTranslations('imageBrush');
  const tCrop = useTranslations('imageCrop');
  const tagLabel = useTagLabel();
  const locale = useLocale();
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  /** "Es la espalda de otra prenda…" — hand this garment's photo to another one. */
  const [showMergeBack, setShowMergeBack] = useState(false);
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
  /** The eraser panel, in place of the photo. */
  const [brushing, setBrushing] = useState(false);
  /** The rare actions, folded away: one for the garment, one for its photo. */
  const [showMore, setShowMore] = useState(false);
  const [showPhotoTools, setShowPhotoTools] = useState(false);
  /**
   * Asked before re-analysing.
   *
   * Re-analysis rewrites the type, the colour and the tags with whatever the model
   * says this time, so on a garment somebody has already corrected by hand it is a
   * destructive action wearing a refresh icon. It used to fire on one tap of an
   * unlabelled button in the middle of a scrolling strip.
   */
  const [confirmReanalyze, setConfirmReanalyze] = useState(false);
  /** Asked before throwing away edits the user has not saved. */
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  /** Briefly true after a successful save, so the button can say so. */
  const [saved, setSaved] = useState(false);
  /** Whether the discard prompt was raised by closing the dialog or by cancelling. */
  const closeAfterDiscard = useRef(false);
  /**
   * Turns the photo is drawn at while the server catches up.
   *
   * Keyed by photo, not by garment: this dialog can show a garment's own photo and
   * several extra ones, each of which turns on its own, so `target` says where the
   * key the queue is holding actually lives. `primary` is the garment's own.
   */
  const rotation = useRotationQueue({
    onSaved: () => setImageKey((k) => k + 1),
    target: (key) => ({ id: item?.id ?? '', imageId: key === 'primary' ? null : key }),
  });

  const updateItem = useUpdateItem();
  const deleteItem = useDeleteItem();
  const reanalyzeItem = useReanalyzeItem();
  const brushCutout = useBrushCutout();
  const resetCutout = useResetCutout();
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
  const setImageView = useSetItemImageView();
  const viewLabel = useImageViewLabel();
  const tViews = useTranslations('imageViews');
  const tMerge = useTranslations('mergeBack');
  /** Where a swipe across the photo began, so we can tell a swipe from a tap. */
  const touchStartX = useRef<number | null>(null);

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
      setBrushing(false);
      setSaved(false);
      setShowMore(false);
      setShowPhotoTools(false);
      setConfirmReanalyze(false);
    }
  }, [item?.id]);

  if (!item) return null;

  /**
   * What the form would send, so "has anything changed" is one comparison rather
   * than a flag every field has to remember to set.
   */
  const storedForm = {
    name: item.name || '',
    type: item.type,
    subtype: item.subtype || '',
    brand: item.brand || '',
    primary_color: item.primary_color || '',
    primary_color_hex: item.primary_color_hex ?? null,
    notes: item.notes || '',
    favorite: item.favorite,
    wash_interval: item.wash_interval ?? undefined,
    style: asTagList(item.tags?.style ?? item.style),
    formality: item.tags?.formality ?? item.formality ?? '',
    season: asTagList(item.tags?.season ?? item.season),
  };
  const dirty =
    careTouched || JSON.stringify({ ...storedForm }) !== JSON.stringify({ ...editForm });

  /** Leave edit mode, asking first if there is anything to lose. */
  const stopEditing = () => {
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    setIsEditing(false);
  };

  /**
   * What "discard" does, and where it lands.
   *
   * Cancelling edit mode drops the draft and stays on the garment; closing the whole
   * dialog drops the draft and leaves. The confirmation is the same either way, so it
   * remembers which one asked.
   */
  const discardEdits = () => {
    setEditForm(storedForm);
    setCareDraft(null);
    setCareTouched(false);
    setConfirmDiscard(false);
    setIsEditing(false);
    if (closeAfterDiscard.current) {
      closeAfterDiscard.current = false;
      onOpenChange(false);
    }
  };

  /** Closing with unsaved edits asks rather than quietly throwing them away. */
  const requestClose = () => {
    if (isEditing && dirty) {
      closeAfterDiscard.current = true;
      setConfirmDiscard(true);
      return;
    }
    onOpenChange(false);
  };

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
      // "Guardado" for a moment, then gone: a state that never clears stops being
      // information.
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (error) {
      console.error('Failed to update item:', error);
      toast.error(t('toast.saveFailed'));
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
    setConfirmReanalyze(false);
    try {
      await reanalyzeItem.mutateAsync(item.id);
      // The photo then wears the "analizando" veil, but that is a slow, quiet
      // change on a screen the user may already have scrolled past, so the queue
      // says so out loud too. Silence here used to be the only answer a tap got.
      toast.success(t('toast.reanalyzeQueued'));
    } catch (error) {
      console.error('Failed to trigger re-analysis:', error);
      toast.error(t('toast.reanalyzeFailed'));
    }
  };

  /**
   * Straightening, without the wait.
   *
   * The photo turns on screen at once and the save queues behind it, so the buttons
   * never lock up — which is what made straightening several garments in a row
   * tedious. `onSaved` bumps `imageKey` so the freshly written file is re-fetched
   * under a new signed URL and the CSS turn can be dropped.
   *
   * Whichever photo is on screen is the one that turns. Turning the front while the
   * user is looking at the back would be the same lie the eraser used to tell.
   */
  const handleRotate = (direction: 'cw' | 'ccw') => rotation.rotate(activeImage.id, direction);

  const openEraser = () => {
    setBrushing(true);
  };

  /**
   * Erase on whichever photo is on screen.
   *
   * The photo being edited is the one the user is looking at, so the id travels with
   * the mask: `null` for the garment's own photo, an image id for an extra one. The
   * back shot of a jumper has its own cut-out and its own original, and touching one
   * up must not reach into the other.
   */
  const handleBrush = async (mask: Blob, imageId: string | null) => {
    try {
      await brushCutout.mutateAsync({ id: item.id, mask, imageId });
      setImageKey((k) => k + 1);
      setBrushing(false);
      toast.success(tBrush('saved'));
    } catch (error) {
      console.error('Failed to save the cut-out edit:', error);
      toast.error(tBrush('saveFailed'));
    }
  };

  const handleResetCutout = async (imageId: string | null) => {
    try {
      await resetCutout.mutateAsync({ id: item.id, imageId });
      setImageKey((k) => k + 1);
      setBrushing(false);
      toast.success(tBrush('wasReset'));
    } catch (error) {
      console.error('Failed to reset the cut-out:', error);
      toast.error(tBrush('resetFailed'));
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

  /**
   * This garment's photos, in one list: the primary one first, then the extras in
   * their own order. Each carries its own alpha flag and its own side, because both
   * are facts about the photo and not about the garment.
   *
   * A garment with a single photo is a one-entry list, which is why the arrows, the
   * dots and the swipe all simply do not appear for it.
   */
  const photos: {
    id: string;
    url: string;
    view: ImageView;
    hasCutout: boolean;
    imageId: string | null;
    /** This photo's untouched version, for painting part of the cut-out back. */
    originalUrl: string | null;
  }[] = [
    {
      id: 'primary',
      url: `${imageUrl}&v=${imageKey}`,
      view: item.image_view ?? 'front',
      hasCutout: item.has_cutout === true,
      imageId: null,
      originalUrl: item.original_image_url ?? null,
    },
    ...(item.additional_images || []).map((img) => ({
      id: img.id,
      url: img.image_url,
      view: img.image_view ?? ('front' as ImageView),
      hasCutout: img.has_cutout === true,
      imageId: img.id,
      originalUrl: img.original_image_url ?? null,
    })),
  ];
  const activeImage = photos[activeImageIndex] ?? photos[0];
  const activeOriginalUrl = activeImage?.originalUrl ?? null;
  const savingView = setImageView.isPending || updateItem.isPending;

  /** Walk the photos, wrapping, whether the step came from a key, an arrow or a swipe. */
  const stepPhoto = (delta: number) =>
    setActiveImageIndex((i) => (i + delta + photos.length) % photos.length);

  /**
   * Relabel whichever photo is on screen. The primary photo lives on the item and
   * the rest in their own rows, so the two go to different endpoints — which is the
   * only reason this function exists rather than one call.
   */
  const saveView = async (next: ImageView) => {
    if (!activeImage || next === activeImage.view) return;
    try {
      if (activeImage.imageId === null) {
        await updateItem.mutateAsync({ id: item.id, data: { image_view: next } });
      } else {
        await setImageView.mutateAsync({
          itemId: item.id,
          imageId: activeImage.imageId,
          view: next,
        });
      }
      toast.success(tViews('saved'));
    } catch {
      toast.error(tViews('saveFailed'));
    }
  };

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
      {/* Escape and the backdrop go through the same guard as the close button, so
          there is no way out of the dialog that silently loses an edit. */}
      <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : requestClose())}>
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
                onClick={requestClose}
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
                rest of the photo tools keep the strip to themselves.

                While editing, this row becomes the save bar. It lives in the header
                rather than at the foot of the form because the form is long: the
                bottom button is still there for a mouse, but nobody should have to
                scroll a phone to save. It says which of the three things is true —
                guardar / guardando / guardado — and it is the only control here that
                changes shape, so the layout never jumps. */}
            {isEditing ? (
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="min-w-0 flex-1"
                  onClick={stopEditing}
                  disabled={updateItem.isPending}
                >
                  <X className="h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden />
                  <span className="min-w-0 truncate">{t('toolbar.cancelEditing')}</span>
                </Button>
                <Button
                  className="min-w-0 flex-1"
                  onClick={handleSave}
                  disabled={updateItem.isPending || !dirty}
                  aria-live="polite"
                >
                  {updateItem.isPending ? (
                    <Loader2
                      className="h-[18px] w-[18px] shrink-0 animate-spin motion-reduce:animate-none"
                      aria-hidden
                    />
                  ) : saved ? (
                    <Check className="h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden />
                  ) : null}
                  <span className="min-w-0 truncate">
                    {updateItem.isPending
                      ? t('form.saving')
                      : saved && !dirty
                        ? t('form.saved')
                        : t('form.save')}
                  </span>
                </Button>
              </div>
            ) : (
              <Button
                variant="default"
                className="w-full justify-center"
                onClick={() => setIsEditing(true)}
                aria-pressed={false}
              >
                <Pencil className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
                {t('toolbar.editTags')}
              </Button>
            )}
            {isEditing && dirty && (
              <p className="text-[12px] leading-snug text-warning" role="status">
                {t('form.unsaved')}
              </p>
            )}
            {/* What is on top, and what is not.
                This used to be one scrolling strip of nine unlabelled icons —
                favourite, outfits, re-analyse, two rotations, remove background,
                eraser, undo, replace photo — where a stray tap could re-cut a photo
                or overwrite tags the owner had just typed, and where half of them
                scrolled off the right edge of a phone. So:

                * two named things stay out: favourite and combinations, which are
                  the only two anybody opens a garment to do and neither of which
                  can lose anything;
                * everything else is a row in "Más opciones" with a plain-Spanish
                  name and a sentence saying what it will do;
                * and anything that rewrites the photo or the tags is locked behind
                  the pencil, because "bloquearlos hasta que le des a editar" is
                  exactly right: you cannot undo a re-analysis. */}
            {!isEditing ? (
              <div className="space-y-2">
                <div
                  role="group"
                  aria-label={t('toolbar.label')}
                  className="grid grid-cols-2 gap-2"
                >
                  <Button
                    variant="secondary"
                    className="min-w-0"
                    onClick={handleToggleFavorite}
                    disabled={updateItem.isPending}
                    aria-pressed={!!item.favorite}
                  >
                    <Heart
                      strokeWidth={1.75}
                      aria-hidden
                      className={cn(
                        'h-[18px] w-[18px] shrink-0',
                        item.favorite && 'fill-signature'
                      )}
                    />
                    <span className="min-w-0 truncate">
                      {item.favorite ? t('toolbar.favoriteRemove') : t('toolbar.favoriteAdd')}
                    </span>
                  </Button>
                  <Button
                    variant="secondary"
                    className="min-w-0"
                    onClick={() => setShowPairingsDialog(true)}
                    disabled={item.status !== 'ready'}
                    title={item.status !== 'ready' ? t('toolbar.pairingsNotReady') : undefined}
                  >
                    <Layers className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
                    <span className="min-w-0 truncate">{t('toolbar.pairings')}</span>
                  </Button>
                </div>
                <Collapsible open={showMore} onOpenChange={setShowMore}>
                  <CollapsibleTrigger className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-full px-3 text-[14px] font-semibold text-muted-foreground transition-colors hover:bg-panel hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {t('toolbar.more')}
                    <ChevronDown
                      className={cn('h-4 w-4 transition-transform', showMore && 'rotate-180')}
                      aria-hidden
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-1 pt-1">
                    <OverflowAction
                      icon={<RefreshCw className="h-[18px] w-[18px]" strokeWidth={1.75} />}
                      label={t('toolbar.reanalyzeWithAi')}
                      description={t('toolbar.reanalyzeWhat')}
                      busy={isAnalyzing}
                      disabled={isAnalyzing}
                      onClick={() => setConfirmReanalyze(true)}
                    />
                    <OverflowAction
                      icon={<Layers className="h-[18px] w-[18px]" strokeWidth={1.75} />}
                      label={tMerge('openFromItem')}
                      description={t('toolbar.mergeBackWhat')}
                      onClick={() => setShowMergeBack(true)}
                    />
                    <OverflowAction
                      destructive
                      icon={<Trash2 className="h-[18px] w-[18px]" strokeWidth={1.75} />}
                      label={t('deleteButton')}
                      description={t('toolbar.deleteWhat')}
                      onClick={() => setShowDeleteConfirm(true)}
                    />
                    {/* Said here rather than under the photo, because here is where
                        somebody hunting for the rotate button will look. */}
                    <p className="px-3 pb-1 pt-1.5 text-[12px] leading-snug text-muted-foreground">
                      {t('toolbar.photoLocked')}
                    </p>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            ) : (
              <div className="space-y-2">
                <p
                  id="item-photo-tools"
                  className="text-[12px] font-semibold text-muted-foreground"
                >
                  {t('toolbar.photoGroup')}
                </p>
                {/* Never disabled mid-save: the photo turns straight away and the
                    saves queue up behind it, so several turns in a row cost no
                    waiting. A small spinner after the pair says one is still being
                    written. */}
                <div
                  role="group"
                  aria-labelledby="item-photo-tools"
                  className="flex items-center gap-2"
                >
                  <Button
                    variant="secondary"
                    size="icon"
                    className="shrink-0"
                    onClick={() => handleRotate('ccw')}
                    title={t('toolbar.rotateLeft')}
                    aria-label={t('toolbar.rotateLeft')}
                  >
                    <RotateCcw className="h-5 w-5" strokeWidth={1.75} />
                  </Button>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="shrink-0"
                    onClick={() => handleRotate('cw')}
                    title={t('toolbar.rotateRight')}
                    aria-label={t('toolbar.rotateRight')}
                  >
                    <RotateCw className="h-5 w-5" strokeWidth={1.75} />
                  </Button>
                  {rotation.isBusy(activeImage.id) && (
                    <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground" role="status">
                      <Loader2
                        className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none"
                        aria-hidden
                      />
                      {tCrop('saving')}
                    </span>
                  )}
                </div>
                {/* Whatever the automatic cut-out got wrong, by hand. The same
                    control as in the add form, and it edits the stored alpha, so the
                    fix shows on every screen and not only on this one. */}
                <Button
                  variant={brushing ? 'default' : 'secondary'}
                  className="w-full min-w-0"
                  onClick={openEraser}
                  disabled={!item.image_url}
                  aria-pressed={brushing}
                >
                  <Eraser className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
                  <span className="min-w-0 truncate">{tBrush('open')}</span>
                </Button>
                <Collapsible open={showPhotoTools} onOpenChange={setShowPhotoTools}>
                  <CollapsibleTrigger className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-full px-3 text-[14px] font-semibold text-muted-foreground transition-colors hover:bg-panel hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {t('toolbar.morePhoto')}
                    <ChevronDown
                      className={cn(
                        'h-4 w-4 transition-transform',
                        showPhotoTools && 'rotate-180'
                      )}
                      aria-hidden
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-1 pt-1">
                    {features?.background_removal && (
                      <OverflowAction
                        icon={<Scissors className="h-[18px] w-[18px]" strokeWidth={1.75} />}
                        label={t('toolbar.removeBackground')}
                        description={t('toolbar.removeBackgroundWhat')}
                        busy={removeBackground.isPending}
                        disabled={removeBackground.isPending || !item.image_url}
                        onClick={handleRemoveBackground}
                      />
                    )}
                    {item.original_image_path && (
                      <OverflowAction
                        icon={<Undo2 className="h-[18px] w-[18px]" strokeWidth={1.75} />}
                        label={t('toolbar.undoBackgroundRemoval')}
                        description={t('toolbar.restoreOriginalWhat')}
                        busy={restoreOriginal.isPending}
                        disabled={restoreOriginal.isPending}
                        onClick={handleRestoreOriginal}
                      />
                    )}
                    <OverflowAction
                      icon={<ImagePlus className="h-[18px] w-[18px]" strokeWidth={1.75} />}
                      label={t('toolbar.replaceImage')}
                      description={t('toolbar.replaceImageWhat')}
                      busy={replaceImage.isPending}
                      disabled={replaceImage.isPending}
                      onClick={() => replaceImageInputRef.current?.click()}
                    />
                  </CollapsibleContent>
                </Collapsible>
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
            )}
          </DialogHeader>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-1">
            <div className="grid gap-6 sm:grid-cols-2 [&>*]:min-w-0">
            {/* Image Gallery */}
            <div className="space-y-2">
              {/* The eraser takes the photo's place rather than opening a screen of
                  its own: it *is* the photo, being edited, and the cropper in the add
                  form works the same way. */}
              {brushing ? (
                <div className="rounded-tile bg-panel p-3">
                  <AlphaBrush
                    // The photo on screen, not the garment's: a back shot is cut out
                    // on its own and is fixed on its own.
                    key={activeImage.id}
                    src={activeImage.url}
                    restoreSrc={activeOriginalUrl}
                    busy={brushCutout.isPending}
                    resetting={resetCutout.isPending}
                    canReset={activeImage.hasCutout}
                    onApply={({ mask }) => void handleBrush(mask, activeImage.imageId)}
                    onCancel={() => setBrushing(false)}
                    onReset={() => void handleResetCutout(activeImage.imageId)}
                  />
                </div>
              ) : (
              /* The gallery is a region of its own so the arrow keys can belong to
                 it: left and right walk this garment's photos, and a swipe does
                 the same thing on a phone. */
              <div
                role="group"
                aria-label={tc('aria.imageGallery')}
                tabIndex={photos.length > 1 ? 0 : -1}
                onKeyDown={(e) => {
                  if (photos.length < 2) return;
                  if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    stepPhoto(-1);
                  } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    stepPhoto(1);
                  }
                }}
                onTouchStart={(e) => {
                  touchStartX.current = e.touches[0]?.clientX ?? null;
                }}
                onTouchEnd={(e) => {
                  const from = touchStartX.current;
                  touchStartX.current = null;
                  if (from === null || photos.length < 2) return;
                  const dx = (e.changedTouches[0]?.clientX ?? from) - from;
                  // Comfortably past a tap, comfortably short of a page scroll.
                  if (Math.abs(dx) > 48) stepPhoto(dx < 0 ? 1 : -1);
                }}
                className={cn(
                  'relative aspect-square overflow-hidden rounded-tile',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  detailTint.className
                )}
                style={detailTint.style}
              >
                {(() => {
                  const currentImage = photos[activeImageIndex] || photos[0];
                  return (
                    <>
                      <Image
                        key={`${currentImage.id}-${imageKey}`}
                        src={currentImage.url}
                        alt={`${item.name || tagLabel('types', item.type)} — ${viewLabel(currentImage.view)}`}
                        fill
                        className={cn(
                          'object-contain p-4 transition-transform duration-200 motion-reduce:transition-none',
                          // Asked of this photo, not of the garment: each photo is
                          // cut out on its own, so the back may keep its alpha while
                          // the front still has white baked in. Only a white-backed
                          // photo needs multiplying for the tint to show.
                          !currentImage.hasCutout && 'mix-blend-multiply'
                        )}
                        // Two transforms on one element: the turns the user has asked
                        // for that the stored file may not show yet, and the scale
                        // that keeps a hat from filling the frame like a coat. The
                        // turns are this photo's own — every photo can be
                        // straightened, and each is queued under its own key.
                        style={garmentFrameStyle(
                          item.type,
                          currentImage.hasCutout,
                          rotation.turnsFor(currentImage.id)
                        )}
                        sizes="(max-width: 640px) 100vw, 50vw"
                      />
                      {/* Which side you are looking at, said on the photo. A garment
                          with one photo says it too: that is how "esta prenda solo
                          tiene el delante" reads without a sentence about it. */}
                      <span className="absolute left-2 top-2 rounded-full bg-background/90 px-2.5 py-1 text-[12px] font-bold">
                        {viewLabel(currentImage.view)}
                      </span>
                      {photos.length > 1 && (
                        <>
                          <button
                            type="button"
                            aria-label={tc('aria.previousImage')}
                            className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() => stepPhoto(-1)}
                          >
                            <ChevronLeft className="h-5 w-5" strokeWidth={1.75} />
                          </button>
                          <button
                            type="button"
                            aria-label={tc('aria.nextImage')}
                            className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() => stepPhoto(1)}
                          >
                            <ChevronRight className="h-5 w-5" strokeWidth={1.75} />
                          </button>
                          <div className="absolute bottom-1 left-1/2 flex -translate-x-1/2">
                            {photos.map((photo, idx) => (
                              <button
                                key={photo.id}
                                type="button"
                                aria-label={`${t('imageN', { n: idx + 1 })} — ${viewLabel(photo.view)}`}
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
              )}
              {/* Thumbnail strip */}
              {(item.additional_images?.length > 0 || isEditing) && (
                <div className="flex gap-2 overflow-x-auto p-1">
                  <button
                    type="button"
                    className={`relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-[14px] bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${activeImageIndex === 0 ? 'ring-[2.5px] ring-inset ring-signature' : ''}`}
                    onClick={() => setActiveImageIndex(0)}
                    aria-label={`${tc('primary')} — ${viewLabel(item.image_view)}`}
                    aria-current={activeImageIndex === 0 ? 'true' : undefined}
                  >
                    <Image src={imageUrl} alt={tc('primary')} fill className="object-contain p-1" sizes="48px" />
                    <span className="absolute inset-x-0 bottom-0 truncate bg-background/85 px-0.5 text-center text-[9px] font-bold leading-[1.3]">
                      {viewLabel(item.image_view)}
                    </span>
                  </button>
                  {(item.additional_images || []).map((img, idx) => (
                    <div key={img.id} className="relative flex-shrink-0">
                      <button
                        type="button"
                        className={`relative h-12 w-12 overflow-hidden rounded-[14px] bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${activeImageIndex === idx + 1 ? 'ring-[2.5px] ring-inset ring-signature' : ''}`}
                        onClick={() => setActiveImageIndex(idx + 1)}
                        aria-label={`${t('imageN', { n: idx + 2 })} — ${viewLabel(img.image_view)}`}
                        aria-current={activeImageIndex === idx + 1 ? 'true' : undefined}
                      >
                        <Image src={img.thumbnail_url || img.image_url} alt="" fill className="object-contain p-1" sizes="48px" />
                        <span className="absolute inset-x-0 bottom-0 truncate bg-background/85 px-0.5 text-center text-[9px] font-bold leading-[1.3]">
                          {viewLabel(img.image_view)}
                        </span>
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

              {/* Always offered, not hidden behind "editar": the label is the answer
                  to a question the photo itself raises, and a garment with one photo
                  is exactly the one whose owner needs to say "esta es la espalda". */}
              <PhotoViewPicker
                idPrefix={`item-photo-${activeImage?.id ?? 'primary'}`}
                value={activeImage?.view ?? 'front'}
                disabled={savingView}
                onChange={(next) => saveView(next)}
              />
            </div>

            {/* Details */}
            <div className="space-y-4">
              {isEditing ? (
                // Edit form. Ordered by what people actually change: tipo, subtipo,
                // color and estilo first, then the rest. Nombre and marca used to be
                // at the top and are the two fields hardly anyone touches.
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="edit-type" className="font-bold">{t('form.type')}</Label>
                    <Select
                      value={editForm.type}
                      onValueChange={(v) =>
                        setEditForm({
                          ...editForm,
                          type: v,
                          // A subtype belongs to a type: "halter" means nothing on a
                          // pair of boots, so it is dropped unless the new type also
                          // has it.
                          subtype: subtypeAfterTypeChange(v, editForm.subtype) ?? '',
                        })
                      }
                    >
                      <SelectTrigger id="edit-type">
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
                  {/* Buttons rather than the free-text box this used to be: the
                      tagger guesses subtype wrong often enough (a halter top comes
                      back as "wrap") that fixing it has to be one tap, and a typed
                      subtype is invisible to everything that reasons about the
                      vocabulary. "Otro" keeps the escape hatch. */}
                  <SubtypeField
                    type={editForm.type}
                    value={editForm.subtype}
                    onChange={(subtype) => setEditForm({ ...editForm, subtype: subtype ?? '' })}
                    idPrefix="edit-subtype"
                  />
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

                  {/* Below the tags: the fields hardly anyone opens a garment to
                      change. */}
                  <div className="space-y-2">
                    <Label htmlFor="edit-name" className="font-bold">{t('form.name')}</Label>
                    <Input
                      id="edit-name"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      placeholder={t('form.namePlaceholder')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-brand" className="font-bold">{t('form.brand')}</Label>
                    <Input
                      id="edit-brand"
                      value={editForm.brand}
                      onChange={(e) => setEditForm({ ...editForm, brand: e.target.value })}
                      placeholder={t('form.brandPlaceholder')}
                    />
                  </div>

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
                  {/* Kept for a mouse and for anyone who has scrolled here anyway.
                      The header carries the same thing, so nobody on a phone has to
                      reach this far. */}
                  <div className="flex gap-2 pt-2">
                    <Button variant="secondary" className="min-w-0 flex-1" onClick={stopEditing}>
                      <span className="min-w-0 truncate">{t('form.cancel')}</span>
                    </Button>
                    <Button
                      className="min-w-0 flex-1"
                      onClick={handleSave}
                      disabled={updateItem.isPending || !dirty}
                    >
                      {updateItem.isPending ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
                      ) : saved ? (
                        <Check className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                      ) : null}
                      <span className="min-w-0 truncate">
                        {updateItem.isPending
                          ? t('form.saving')
                          : saved && !dirty
                            ? t('form.saved')
                            : t('form.save')}
                      </span>
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
                        <span className="text-muted-foreground">
                          • {tagLabel('subtypes', item.subtype)}
                        </span>
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

            {/* "Eliminar" and "es la espalda de otra prenda" used to be repeated
                down here as well as offered in the header, which is two places to
                look for one thing and one of them a long scroll away. They live in
                "Más opciones" now, with a sentence each. */}
          </div>
        </DialogContent>
      </Dialog>

      <MergeBackDialog
        source={item}
        open={showMergeBack}
        onOpenChange={setShowMergeBack}
        // This garment no longer exists once its photo has moved, so the detail
        // dialog it was opened from has to close with it.
        onMerged={() => onOpenChange(false)}
      />

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

      <AlertDialog
        open={confirmDiscard}
        onOpenChange={(next) => {
          if (!next) {
            setConfirmDiscard(false);
            closeAfterDiscard.current = false;
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('discardConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('discardConfirm.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('discardConfirm.keepEditing')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={discardEdits}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('discardConfirm.discard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Re-analysing is not "refresh": it overwrites whatever the owner typed with
          whatever the model says this time. Asked, therefore, rather than fired. */}
      <AlertDialog open={confirmReanalyze} onOpenChange={setConfirmReanalyze}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('reanalyzeConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('reanalyzeConfirm.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleReanalyze}>
              {t('reanalyzeConfirm.confirm')}
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
