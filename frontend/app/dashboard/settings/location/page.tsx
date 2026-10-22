'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm-provider';
import { Button } from '@/components/ui/button';
import { LocationPicker } from '@/components/settings/location-picker';
import { TimezoneCombobox } from '@/components/settings/timezone-combobox';
import { SettingsSubpage } from '@/components/settings/subpage';
import { useUserProfile, useUpdateUserProfile } from '@/lib/hooks/use-user';
import { useAutoTimezone, useDeleteLocation } from '@/lib/hooks/use-location';
import { useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes';
import type { SavedLocation } from '@/lib/geo';

/** Ubicación: the city Stinky dresses you for, and the zone your alerts follow. */
export default function LocationSettingsPage() {
  const t = useTranslations('settings.location');
  const confirm = useConfirm();
  const { data: userProfile, isLoading } = useUserProfile();
  const updateUserProfile = useUpdateUserProfile();
  const deleteLocation = useDeleteLocation();
  const autoTimezone = useAutoTimezone();

  const [location, setLocation] = useState<SavedLocation>({ name: '', lat: null, lon: null });
  const [timezone, setTimezone] = useState('UTC');
  // Only a tap on the timezone picker counts as choosing one by hand. A zone that
  // merely came along with a city stays "detected", so detection keeps working.
  const [timezoneTouched, setTimezoneTouched] = useState(false);

  useEffect(() => {
    if (!userProfile) return;
    setLocation({
      name: userProfile.location_name || '',
      lat: userProfile.location_lat ?? null,
      lon: userProfile.location_lon ?? null,
    });
    // Not auto-switched to the device zone (that would mark the form dirty);
    // TimezoneCombobox offers it as a one-tap suggestion instead.
    setTimezone(userProfile.timezone || 'UTC');
    setTimezoneTouched(false);
  }, [userProfile]);

  const handleLocationChange = (next: SavedLocation) => {
    setLocation(next);
    // Picking a city brings its timezone along; the user can still override it.
    if (next.timezone) setTimezone(next.timezone);
  };

  const hasChanges =
    !!userProfile &&
    (location.name !== (userProfile.location_name || '') ||
      location.lat !== (userProfile.location_lat ?? null) ||
      location.lon !== (userProfile.location_lon ?? null) ||
      timezone !== (userProfile.timezone || 'UTC'));

  useUnsavedChanges(hasChanges);

  const handleSave = async () => {
    const { lat, lon } = location;
    if (lat === null || lon === null || Number.isNaN(lat) || Number.isNaN(lon)) {
      toast.error(t('invalidLatLon'));
      return;
    }
    if (lat < -90 || lat > 90) {
      toast.error(t('latRange'));
      return;
    }
    if (lon < -180 || lon > 180) {
      toast.error(t('lonRange'));
      return;
    }
    try {
      await updateUserProfile.mutateAsync({
        location_lat: lat,
        location_lon: lon,
        location_name: location.name || undefined,
        // Sending the zone here marks it hand-picked, so only do it when it was.
        ...(timezoneTouched ? { timezone } : {}),
      });
      // A zone that came with the chosen city is still a detected one.
      if (!timezoneTouched && timezone && timezone !== (userProfile?.timezone || 'UTC')) {
        await autoTimezone.mutateAsync(timezone).catch(() => undefined);
      }
      setTimezoneTouched(false);
      toast.success(t('savedToast'));
    } catch {
      toast.error(t('saveError'));
    }
  };

  const handleDelete = async () => {
    if (!(await confirm({ title: t('deleteConfirm'), destructive: true }))) return;
    try {
      await deleteLocation.mutateAsync();
      setLocation({ name: '', lat: null, lon: null });
      toast.success(t('deletedToast'));
    } catch {
      toast.error(t('deleteError'));
    }
  };

  const hasSaved = !!(userProfile?.location_name || userProfile?.location_lat != null);

  return (
    <SettingsSubpage title={t('title')} loading={isLoading || !userProfile}>
      <div className="space-y-6">
        <LocationPicker id="settings-location" value={location} onChange={handleLocationChange} />
        <TimezoneCombobox
          id="settings-timezone"
          value={timezone}
          onChange={(tz) => {
            setTimezone(tz);
            setTimezoneTouched(true);
          }}
          cityTimezone={location.timezone}
          cityName={location.name.split(',')[0]}
          autoDetected={userProfile?.timezone_source === 'auto'}
        />
        <Button onClick={handleSave} disabled={!hasChanges || updateUserProfile.isPending}>
          {updateUserProfile.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {t('saveLocation')}
        </Button>

        {/* What we keep, in one line, next to the button that removes it. */}
        <div className="border-t border-border pt-4">
          <p className="text-[13px] leading-snug text-muted-foreground">{t('privacySummary')}</p>
          {hasSaved && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              disabled={deleteLocation.isPending}
              className="mt-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {deleteLocation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Trash2 className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              )}
              {t('deleteLocation')}
            </Button>
          )}
        </div>
      </div>
    </SettingsSubpage>
  );
}
