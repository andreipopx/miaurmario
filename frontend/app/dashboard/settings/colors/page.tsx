'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ColorPreferences } from '@/components/settings/color-preferences';
import { SettingsSubpage } from '@/components/settings/subpage';
import { usePreferences, useUpdatePreferences } from '@/lib/hooks/use-preferences';
import { useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes';
import { getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

type Segment = 'favorites' | 'avoid';

/**
 * Colores: one picker, and a «Me gustan / Evito» switch above it that decides
 * which list a tap goes to. A colour can only be in one of the two.
 */
export default function ColorsSettingsPage() {
  const t = useTranslations('settings.colors');
  const tCommon = useTranslations('common');
  const tPrefs = useTranslations('settings.preferences');
  const { data: preferences, isLoading } = usePreferences();
  const updatePreferences = useUpdatePreferences();

  const [segment, setSegment] = useState<Segment>('favorites');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [avoid, setAvoid] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!preferences) return;
    setFavorites(preferences.color_favorites || []);
    setAvoid(preferences.color_avoid || []);
    setDirty(false);
  }, [preferences]);

  useUnsavedChanges(dirty);

  const change = (colors: string[]) => {
    if (segment === 'favorites') {
      setFavorites(colors);
      setAvoid((prev) => prev.filter((c) => !colors.includes(c)));
    } else {
      setAvoid(colors);
      setFavorites((prev) => prev.filter((c) => !colors.includes(c)));
    }
    setDirty(true);
  };

  const save = async () => {
    try {
      await updatePreferences.mutateAsync({ color_favorites: favorites, color_avoid: avoid });
      setDirty(false);
      toast.success(tPrefs('saved'));
    } catch (e) {
      toast.error(getErrorMessage(e, tPrefs('saveError')));
    }
  };

  const segments: { key: Segment; label: string; count: number }[] = [
    { key: 'favorites', label: t('segmentLike'), count: favorites.length },
    { key: 'avoid', label: t('segmentAvoid'), count: avoid.length },
  ];

  return (
    <SettingsSubpage title={t('title')} loading={isLoading || !preferences}>
      <div className="space-y-6">
        <div role="tablist" aria-label={t('title')} className="grid w-full max-w-sm grid-cols-2 gap-1 rounded-full bg-panel p-1">
          {segments.map((s) => {
            const active = segment === s.key;
            return (
              <button
                key={s.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSegment(s.key)}
                className={cn(
                  'inline-flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-semibold transition-colors duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  active ? 'bg-primary text-primary-foreground' : 'bg-transparent text-foreground hover:bg-background'
                )}
              >
                {s.label}
                {s.count > 0 && (
                  <span className={cn('text-xs', active ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                    {s.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <ColorPreferences
          key={segment}
          label={segment === 'favorites' ? t('favorites') : t('avoid')}
          showLabel={false}
          selected={segment === 'favorites' ? favorites : avoid}
          onChange={change}
          tone={segment === 'favorites' ? 'favorite' : 'avoid'}
        />

        <Button onClick={save} disabled={!dirty || updatePreferences.isPending}>
          {updatePreferences.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {tCommon('saving')}
            </>
          ) : (
            tCommon('save')
          )}
        </Button>
      </div>
    </SettingsSubpage>
  );
}
