'use client';

import { useTranslations } from 'next-intl';
import { Droplets, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useCareHintLabel, useCompositionText, localCareHints } from '@/lib/care-labels';
import { CareInfo } from '@/lib/types';

interface CarePanelProps {
  care?: CareInfo | null;
  /** Hint codes from the API; recomputed locally when they are missing. */
  hints?: string[];
}

/** What the care label says: composition and the laundry rules, in plain words. */
export function CarePanel({ care, hints }: CarePanelProps) {
  const t = useTranslations('wardrobe.care');
  const hintLabel = useCareHintLabel();
  const compositionText = useCompositionText();

  if (!care) return null;

  const codes = hints?.length ? hints : localCareHints(care);
  const composition = compositionText(care.composition);
  if (!codes.length && !composition && !care.notes) return null;

  return (
    <div className="space-y-2.5 rounded-lg bg-panel p-4">
      <div className="flex items-center gap-2 text-[15px] font-bold">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-pop-sky text-pop-foreground">
          <Droplets className="h-3.5 w-3.5" strokeWidth={1.75} />
        </span>
        {t('title')}
        {care.source === 'ai' && (
          <Sparkles className="h-3.5 w-3.5 text-signature" strokeWidth={1.75} aria-hidden />
        )}
      </div>

      {composition && <p className="text-sm text-muted-foreground">{composition}</p>}

      {codes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {codes.map((code) => (
            <Badge key={code} variant="outline" className="border-0 bg-background text-xs font-semibold">
              {hintLabel(code)}
            </Badge>
          ))}
        </div>
      )}

      {care.notes && <p className="text-xs text-muted-foreground">{care.notes}</p>}
    </div>
  );
}
