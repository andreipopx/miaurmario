'use client';

import { useState } from 'react';
import { AlertTriangle, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OccasionChips } from '@/components/shared/occasion-chips';
import { Stinky } from '@/components/stinky/stinky';
import { api, getErrorMessage } from '@/lib/api';
import { ITEM_ROLE } from '@/lib/studio/canonical-order';
import { mergeAiAssist } from '@/lib/studio/ai-assist-merge';
import type { StudioItem } from '@/lib/studio/editor-state';
import type { Outfit, OutfitItem } from '@/lib/hooks/use-outfits';

interface DetailsPanelProps {
  items: StudioItem[];
  name: string;
  occasion: string | null;
  onNameChange: (name: string) => void;
  onOccasionChange: (occasion: string) => void;
  onAiMerge: (merged: StudioItem[]) => void;
}

type WarningKey = 'noBottoms' | 'noTop' | 'multiBottoms' | 'noFootwear';

function computeWarnings(items: StudioItem[]): WarningKey[] {
  const warnings: WarningKey[] = [];
  const roles = items.map((i) => ITEM_ROLE[i.type] ?? '');

  const hasFullBody = roles.includes('full_body');
  const hasTop = roles.includes('base_top');
  const hasBottom = roles.includes('bottom');
  const hasFootwear = roles.includes('footwear');

  if (!hasFullBody) {
    if (hasTop && !hasBottom) {
      warnings.push('noBottoms');
    }
    if (hasBottom && !hasTop) {
      warnings.push('noTop');
    }
  }

  const bottomCount = roles.filter((r) => r === 'bottom').length;
  if (bottomCount > 1) {
    warnings.push('multiBottoms');
  }

  if (items.length >= 3 && !hasFootwear) {
    warnings.push('noFootwear');
  }

  return warnings;
}

function toStudioItem(item: OutfitItem): StudioItem {
  return {
    id: item.id,
    type: item.type,
    name: item.name,
    thumbnail_url: item.thumbnail_url ?? null,
    image_url: item.image_url ?? null,
    primary_color: item.primary_color,
  };
}

export function DetailsPanel({
  items,
  name,
  occasion,
  onNameChange,
  onOccasionChange,
  onAiMerge,
}: DetailsPanelProps) {
  const t = useTranslations('detailsPanel');
  const [aiLoading, setAiLoading] = useState(false);
  const warnings = computeWarnings(items);

  const handleAiAssist = async () => {
    if (items.length === 0 || !occasion) {
      toast.error(t('pickAtLeastOne'));
      return;
    }
    setAiLoading(true);
    try {
      const result = await api.post<Outfit>('/outfits/suggest', {
        occasion,
        include_items: items.map((i) => i.id),
      });

      const aiStudioItems = result.items.map(toStudioItem);
      const { merged, skipped } = mergeAiAssist(items, aiStudioItems);

      onAiMerge(merged);

      if (skipped.length > 0) {
        for (const { item, reason } of skipped) {
          toast.info(t('aiSkipped', { label: item.name || item.type, reason }));
        }
      } else if (merged.length > items.length) {
        toast.success(t('aiAdded', { count: merged.length - items.length }));
      } else {
        toast.info(t('aiNoNew'));
      }
    } catch (error) {
      toast.error(getErrorMessage(error, t('aiFailed')));
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="studio-name" className="flex items-center gap-1 font-bold">
          {t('nameLabel')}
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            {t('nameLabelHelp')}
          </span>
        </Label>
        <Input
          id="studio-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={t('namePlaceholder')}
          maxLength={100}
        />
      </div>

      <div className="space-y-2">
        <Label className="flex items-center gap-1 font-bold">
          {t('occasionLabel')}
          <span className="text-destructive" aria-hidden>*</span>
          <span className="sr-only">{t('required')}</span>
        </Label>
        <OccasionChips selected={occasion} onSelect={onOccasionChange} />
        {!occasion && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t('occasionRequiredHint')}
          </p>
        )}
      </div>

      {warnings.length > 0 && (
        <Alert className="bg-pop-amber/25">
          <AlertTriangle className="h-4 w-4" strokeWidth={1.75} />
          <AlertDescription className="text-foreground">
            <ul className="list-disc space-y-1 pl-4">
              {warnings.map((w) => (
                <li key={w} className="text-[13px]">
                  {t(`warnings.${w}`)}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Button
        type="button"
        variant="signature"
        className="w-full"
        disabled={items.length === 0 || !occasion || aiLoading}
        onClick={handleAiAssist}
        aria-busy={aiLoading}
      >
        {aiLoading ? (
          <>
            <Stinky state="thinking" size={28} label="" className="-my-1" />
            {t('aiThinking')}
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" />
            {t('aiAssist')}
          </>
        )}
      </Button>
    </div>
  );
}
