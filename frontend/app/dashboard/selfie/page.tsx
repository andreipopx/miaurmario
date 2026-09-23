'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Camera, ImagePlus, Loader2, ShieldCheck, X } from 'lucide-react';

import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AIUnavailableNotice } from '@/components/ai/ai-unavailable-notice';
import { LazyStinky } from '@/components/native/lazy-stinky';
import { OccasionChips } from '@/components/shared/occasion-chips';
import { ItemPicker } from '@/components/shared/item-picker';
import { SelfieGarmentCard } from '@/components/selfie/selfie-garment-card';
import { useAIStatus } from '@/lib/hooks/use-ai-access';
import { MAX_SELFIE_BYTES, useAnalyzeSelfie, useCreateItemFromSelfie } from '@/lib/hooks/use-selfie';
import { useCreateStudioOutfit } from '@/lib/hooks/use-studio';
import { getAiAccessErrorCode } from '@/lib/ai-access';
import { ApiError, getErrorMessage } from '@/lib/api';
import { formatDateLocalized } from '@/lib/date-locale';
import { useGarmentWord } from '@/lib/garment-words';
import {
  chosenItemIds,
  initialPicks,
  itemsById,
  optionsFor,
  setPick,
  type SelfieAnalysis,
  type SelfieGarment,
  type SelfieItemSummary,
  type SelfiePicks,
} from '@/lib/selfie';
import type { Item } from '@/lib/types';

/** Today's date as the backend wants it (local day, not UTC). */
function todayISO(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function toSummary(item: Item): SelfieItemSummary {
  return {
    id: item.id,
    name: item.name ?? null,
    type: item.type,
    subtype: item.subtype ?? null,
    primary_color: item.primary_color ?? null,
    colors: item.colors ?? [],
    pattern: item.tags?.pattern ?? null,
    thumbnail_url: item.thumbnail_url ?? null,
    image_url: item.image_url ?? null,
  };
}

export default function SelfiePage() {
  const t = useTranslations('selfie');
  const locale = useLocale();
  const router = useRouter();
  const garmentWord = useGarmentWord();

  const { data: aiStatus } = useAIStatus();
  const noVisionAi = Boolean(aiStatus && aiStatus.server_ai_enabled && !aiStatus.capabilities.vision);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<SelfieAnalysis | null>(null);
  const [picks, setPicks] = useState<SelfiePicks>({});
  const [extraItems, setExtraItems] = useState<SelfieItemSummary[]>([]);
  const [addedIndexes, setAddedIndexes] = useState<number[]>([]);
  const [addingIndex, setAddingIndex] = useState<number | null>(null);
  const [browsing, setBrowsing] = useState<SelfieGarment | null>(null);
  const [occasion, setOccasion] = useState('casual');
  const [aiBlocked, setAiBlocked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analyze = useAnalyzeSelfie();
  const addItem = useCreateItemFromSelfie();
  const createOutfit = useCreateStudioOutfit();

  const previewRef = useRef<string | null>(null);
  const revokePreview = useCallback(() => {
    if (previewRef.current) {
      URL.revokeObjectURL(previewRef.current);
      previewRef.current = null;
    }
  }, []);
  useEffect(() => revokePreview, [revokePreview]);

  const garments = useMemo(() => analysis?.garments ?? [], [analysis]);
  const known = useMemo(() => itemsById(garments, extraItems), [garments, extraItems]);
  const chosen = useMemo(() => chosenItemIds(garments, picks), [garments, picks]);

  const handleFile = (selected: File | null) => {
    setError(null);
    setAiBlocked(null);
    if (!selected) return;
    if (!selected.type.startsWith('image/')) {
      setError(t('notAnImage'));
      return;
    }
    if (selected.size > MAX_SELFIE_BYTES) {
      setError(t('tooLarge', { max: Math.round(MAX_SELFIE_BYTES / (1024 * 1024)) }));
      return;
    }
    revokePreview();
    const url = URL.createObjectURL(selected);
    previewRef.current = url;
    setPreviewUrl(url);
    setFile(selected);
    setAnalysis(null);
    setPicks({});
    setAddedIndexes([]);
  };

  const reset = () => {
    revokePreview();
    setPreviewUrl(null);
    setFile(null);
    setAnalysis(null);
    setPicks({});
    setExtraItems([]);
    setAddedIndexes([]);
    setError(null);
    setAiBlocked(null);
  };

  const handleAnalyze = async () => {
    if (!file) return;
    setError(null);
    setAiBlocked(null);
    try {
      const result = await analyze.mutateAsync(file);
      setAnalysis(result);
      setPicks(initialPicks(result.garments));
      setAddedIndexes([]);
      // The photo has done its job: drop it here too, so nothing lingers.
      revokePreview();
      setPreviewUrl(null);
      setFile(null);
    } catch (err) {
      const code = getAiAccessErrorCode(err);
      if (code) setAiBlocked(code);
      else setError(getErrorMessage(err, t('analyzeFailed')));
    }
  };

  const handleAdd = async (garment: SelfieGarment) => {
    setAddingIndex(garment.index);
    try {
      const created = await addItem.mutateAsync({
        type: garment.type,
        subtype: garment.subtype,
        primary_color: garment.primary_color,
        colors: garment.colors,
        pattern: garment.pattern,
        material: garment.material,
      });
      const summary = toSummary(created);
      setExtraItems((prev) => [...prev, summary]);
      setPicks((prev) => setPick(prev, garment.index, summary.id));
      setAddedIndexes((prev) => [...prev, garment.index]);
      toast.success(t('addedToast', { name: summary.name ?? garmentWord(summary.type) }));
    } catch (err) {
      toast.error(getErrorMessage(err, t('addFailed')));
    } finally {
      setAddingIndex(null);
    }
  };

  const save = async (markWorn: boolean) => {
    if (chosen.length === 0) {
      toast.error(t('needItems'));
      return;
    }
    try {
      const outfit = await createOutfit.mutateAsync({
        items: chosen,
        occasion,
        mark_worn: markWorn,
        scheduled_for: markWorn ? todayISO() : null,
        name: markWorn ? undefined : t('defaultLookName', { date: formatDateLocalized(new Date(), 'short', locale) }),
      });
      toast.success(markWorn ? t('savedWorn') : t('savedLook'));
      router.push(markWorn ? '/dashboard/history' : `/dashboard/outfits/${outfit.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) toast.error(t('tooManySaves'));
      else toast.error(getErrorMessage(err, t('saveFailed')));
    }
  };

  const pickFor = (garment: SelfieGarment): SelfieItemSummary | null => {
    const id = picks[garment.index];
    return id ? (known.get(id) ?? null) : null;
  };

  return (
    <div className="space-y-6 py-2 sm:py-4">
      <PageHeader title={t('title')} description={t('subtitle')} />

      <section className="flex items-start gap-3 rounded-lg bg-panel p-4" role="note">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="text-[15px] font-bold leading-snug">{t('privacy.title')}</p>
          <p className="text-sm leading-snug text-muted-foreground">{t('privacy.body')}</p>
        </div>
      </section>

      {(noVisionAi || aiBlocked) && (
        <AIUnavailableNotice feature="selfie" reason={aiBlocked ?? aiStatus?.blocked_reason} />
      )}

      {!analysis && (
        <section className="space-y-3">
          {previewUrl ? (
            <div className="space-y-3">
              <div className="relative mx-auto aspect-[3/4] w-full max-w-xs overflow-hidden rounded-lg bg-panel">
                <Image src={previewUrl} alt={t('photoReady')} fill className="object-contain" unoptimized />
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  aria-label={t('removePhoto')}
                  onClick={reset}
                  className="absolute right-2 top-2"
                >
                  <X className="h-5 w-5" strokeWidth={2} aria-hidden />
                </Button>
              </div>
              <Button
                type="button"
                variant="signature"
                size="lg"
                className="w-full"
                onClick={handleAnalyze}
                disabled={analyze.isPending || noVisionAi}
              >
                {analyze.isPending ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                    {t('analyzing')}
                  </>
                ) : (
                  t('analyze')
                )}
              </Button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex min-h-[132px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-panel p-4 text-center focus-within:ring-2 focus-within:ring-ring">
                <Camera className="h-7 w-7" strokeWidth={1.75} aria-hidden />
                <span className="text-[15px] font-bold">{t('takePhoto')}</span>
                <input
                  type="file"
                  className="sr-only"
                  accept="image/*"
                  capture="user"
                  onChange={(e) => {
                    handleFile(e.target.files?.[0] ?? null);
                    e.target.value = '';
                  }}
                />
              </label>
              <label className="flex min-h-[132px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-panel p-4 text-center focus-within:ring-2 focus-within:ring-ring">
                <ImagePlus className="h-7 w-7" strokeWidth={1.75} aria-hidden />
                <span className="text-[15px] font-bold">{t('choosePhoto')}</span>
                <input
                  type="file"
                  className="sr-only"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/*"
                  onChange={(e) => {
                    handleFile(e.target.files?.[0] ?? null);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          )}

          {analyze.isPending && (
            <div className="flex items-center justify-center gap-3 rounded-lg bg-panel p-4">
              <LazyStinky state="thinking" size={40} label="" />
              <p className="text-sm font-semibold">{t('analyzing')}</p>
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm font-semibold text-destructive">
              {error}
            </p>
          )}
        </section>
      )}

      {analysis && garments.length === 0 && (
        <EmptyState
          state="sad"
          title={t('nothingFound.title')}
          description={t('nothingFound.description')}
          action={<Button onClick={reset}>{t('startOver')}</Button>}
        />
      )}

      {analysis && garments.length > 0 && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-extrabold tracking-tight">{t('resultTitle')}</h2>
            <Button type="button" variant="outline" size="sm" onClick={reset}>
              {t('startOver')}
            </Button>
          </div>

          <ul className="space-y-3">
            {garments.map((garment) => (
              <SelfieGarmentCard
                key={garment.index}
                garment={garment}
                picked={pickFor(garment)}
                options={optionsFor(garment, pickFor(garment))}
                onPick={(itemId) => setPicks((prev) => setPick(prev, garment.index, itemId))}
                onBrowse={() => setBrowsing(garment)}
                onAdd={() => handleAdd(garment)}
                isAdding={addingIndex === garment.index}
                wasAdded={addedIndexes.includes(garment.index)}
              />
            ))}
          </ul>

          <div className="space-y-3 rounded-lg bg-panel p-4">
            <p className="text-sm font-semibold">{t('selectedCount', { count: chosen.length })}</p>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('occasionLabel')}
              </p>
              <OccasionChips selected={occasion} onSelect={setOccasion} scroll />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="signature"
                className="w-full sm:flex-1"
                onClick={() => save(true)}
                disabled={createOutfit.isPending || chosen.length === 0}
              >
                {createOutfit.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {t('wearToday')}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full sm:flex-1"
                onClick={() => save(false)}
                disabled={createOutfit.isPending || chosen.length === 0}
              >
                {t('saveLook')}
              </Button>
            </div>
          </div>
        </section>
      )}

      <Dialog open={browsing !== null} onOpenChange={(open) => !open && setBrowsing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('pickerTitle')}</DialogTitle>
            <DialogDescription>{t('pickerDescription')}</DialogDescription>
          </DialogHeader>
          {browsing && (
            <ItemPicker
              selectedIds={new Set(picks[browsing.index] ? [picks[browsing.index] as string] : [])}
              onToggle={(item) => {
                setExtraItems((prev) =>
                  prev.some((i) => i.id === item.id) ? prev : [...prev, toSummary(item)]
                );
                setPicks((prev) => setPick(prev, browsing.index, item.id));
                setBrowsing(null);
              }}
              hideNeedsWash={false}
              emptyMessage={t('pickerEmpty')}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
