'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Camera, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CareDraft, useCareLabel } from '@/lib/hooks/use-intake';
import { CareInfo } from '@/lib/types';
import { useAIStatus } from '@/lib/hooks/use-ai-access';
import { useCompositionText } from '@/lib/care-labels';
import { getErrorMessage } from '@/lib/api';

const NONE = 'none';

interface CareLabelFieldProps {
  value: CareDraft | null;
  onChange: (care: CareDraft | null) => void;
  idPrefix?: string;
  /** Care already stored on the item, to edit rather than start from scratch. */
  initialValue?: CareInfo | null;
}

/** Map stored care onto the four fields this form shows. */
function fieldsFrom(care: CareInfo | CareDraft | null | undefined, composition: string) {
  return {
    composition,
    wash: care?.wash?.do_not_wash
      ? 'never'
      : care?.wash?.hand_wash
        ? 'hand'
        : care?.wash?.max_temp_c
          ? String(care.wash.max_temp_c)
          : NONE,
    tumble:
      care?.dry?.tumble_dry === true ? 'yes' : care?.dry?.tumble_dry === false ? 'no' : NONE,
    iron: care?.iron?.allowed === false
      ? 'never'
      : care?.iron?.max_temp_c
        ? String(care.iron.max_temp_c)
        : NONE,
  };
}

/**
 * Care label capture: photograph the washing label and let vision AI read it,
 * or type the same four things in by hand. Both paths produce the same object,
 * so a wardrobe with no AI is never a second-class one.
 */
export function CareLabelField({
  value,
  onChange,
  idPrefix = 'care',
  initialValue,
}: CareLabelFieldProps) {
  const t = useTranslations('wardrobe.care');
  const compositionText = useCompositionText();
  const fileRef = useRef<HTMLInputElement>(null);
  const readCareLabel = useCareLabel();
  const { data: aiStatus } = useAIStatus();
  const canScan = Boolean(aiStatus?.server_ai_enabled && aiStatus?.capabilities?.vision);

  const seed = fieldsFrom(initialValue, compositionText(initialValue?.composition));
  const [composition, setComposition] = useState(seed.composition);
  const [wash, setWash] = useState(seed.wash);
  const [tumble, setTumble] = useState(seed.tumble);
  const [iron, setIron] = useState(seed.iron);

  // Clear the visible fields when the form drops the care object (e.g. the
  // dialog was reset after saving) — but never on mount, where the fields may
  // have been seeded from care the item already carries.
  const previousValue = useRef(value);
  useEffect(() => {
    if (previousValue.current !== null && value === null) {
      setComposition('');
      setWash(NONE);
      setTumble(NONE);
      setIron(NONE);
    }
    previousValue.current = value;
  }, [value]);

  const emit = (next: {
    composition?: string;
    wash?: string;
    tumble?: string;
    iron?: string;
  }) => {
    const compositionValue = next.composition ?? composition;
    const washValue = next.wash ?? wash;
    const tumbleValue = next.tumble ?? tumble;
    const ironValue = next.iron ?? iron;

    const draft: CareDraft = { source: 'manual' };
    if (compositionValue.trim()) draft.composition = compositionValue.trim();
    if (washValue === 'hand') draft.wash = { hand_wash: true, machine: false };
    else if (washValue === 'never') draft.wash = { do_not_wash: true };
    else if (washValue !== NONE) draft.wash = { machine: true, max_temp_c: Number(washValue) };
    if (tumbleValue !== NONE) draft.dry = { tumble_dry: tumbleValue === 'yes' };
    if (ironValue === 'never') draft.iron = { allowed: false };
    else if (ironValue !== NONE) draft.iron = { allowed: true, max_temp_c: Number(ironValue) };

    const empty = !draft.composition && !draft.wash && !draft.dry && !draft.iron;
    onChange(empty ? null : draft);
  };

  const handleScan = async (file: File) => {
    try {
      const result = await readCareLabel.mutateAsync(file);
      if (!result.read) {
        toast.warning(t('scanUnreadable'));
        return;
      }
      const care = result.care;
      const nextComposition = compositionText(care.composition);
      const next = fieldsFrom(care, nextComposition);

      setComposition(next.composition);
      setWash(next.wash);
      setTumble(next.tumble);
      setIron(next.iron);
      // Keep everything the model read (bleach, cycle, notes…), not just the
      // four fields the form shows, but let the user's edits win afterwards.
      onChange({
        ...care,
        composition: nextComposition || undefined,
        source: 'ai',
      });
      toast.success(t('scanDone'));
    } catch (error) {
      toast.error(getErrorMessage(error, t('scanFailed')));
    }
  };

  return (
    <div className="space-y-3 rounded-lg bg-panel p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-foreground">{t('title')}</p>
          <p className="text-xs text-muted-foreground">
            {canScan ? t('subtitleAi') : t('subtitleManual')}
          </p>
        </div>
        {canScan && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={readCareLabel.isPending}
          >
            {readCareLabel.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
            ) : (
              <Camera className="h-4 w-4" strokeWidth={1.75} />
            )}
            {t('scan')}
          </Button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void handleScan(file);
          }}
        />
      </div>

      {value?.source === 'ai' && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-signature" strokeWidth={1.75} />
          {t('readByStinky')}
        </p>
      )}

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-composition`} className="font-bold">
          {t('compositionLabel')}
        </Label>
        <Input
          id={`${idPrefix}-composition`}
          value={composition}
          onChange={(event) => {
            setComposition(event.target.value);
            emit({ composition: event.target.value });
          }}
          placeholder={t('compositionPlaceholder')}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-wash`} className="font-bold">
            {t('washLabel')}
          </Label>
          <Select
            value={wash}
            onValueChange={(next) => {
              setWash(next);
              emit({ wash: next });
            }}
          >
            <SelectTrigger id={`${idPrefix}-wash`}>
              <SelectValue placeholder={t('unset')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('unset')}</SelectItem>
              <SelectItem value="30">{t('hints.washTemp', { temp: '30' })}</SelectItem>
              <SelectItem value="40">{t('hints.washTemp', { temp: '40' })}</SelectItem>
              <SelectItem value="60">{t('hints.washTemp', { temp: '60' })}</SelectItem>
              <SelectItem value="hand">{t('hints.hand_wash')}</SelectItem>
              <SelectItem value="never">{t('hints.do_not_wash')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-dry`} className="font-bold">
            {t('dryLabel')}
          </Label>
          <Select
            value={tumble}
            onValueChange={(next) => {
              setTumble(next);
              emit({ tumble: next });
            }}
          >
            <SelectTrigger id={`${idPrefix}-dry`}>
              <SelectValue placeholder={t('unset')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('unset')}</SelectItem>
              <SelectItem value="yes">{t('tumbleYes')}</SelectItem>
              <SelectItem value="no">{t('hints.no_tumble')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-iron`} className="font-bold">
            {t('ironLabel')}
          </Label>
          <Select
            value={iron}
            onValueChange={(next) => {
              setIron(next);
              emit({ iron: next });
            }}
          >
            <SelectTrigger id={`${idPrefix}-iron`}>
              <SelectValue placeholder={t('unset')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('unset')}</SelectItem>
              <SelectItem value="110">{t('hints.ironTemp', { temp: '110' })}</SelectItem>
              <SelectItem value="150">{t('hints.ironTemp', { temp: '150' })}</SelectItem>
              <SelectItem value="200">{t('hints.ironTemp', { temp: '200' })}</SelectItem>
              <SelectItem value="never">{t('hints.no_iron')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
