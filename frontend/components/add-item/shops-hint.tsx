'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * «¿Qué tiendas?»: the shops whose photo Stinky can fetch, behind a link rather
 * than in a paragraph. Help text after the gesture, not before.
 */
export function ShopsHint({ variant, className }: { variant: 'link' | 'shot'; className?: string }) {
  const t = useTranslations('wardrobe.add.shops');
  const [open, setOpen] = useState(false);
  return (
    <p className={className}>
      {open ? (
        <span className="text-xs text-muted-foreground">{t(variant)}</span>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="hit-44 relative rounded text-xs font-semibold text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('which')}
        </button>
      )}
    </p>
  );
}
