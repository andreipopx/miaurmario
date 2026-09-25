'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Loader2,
  Shirt,
  Users,
  MapPin,
  Palette,
  Camera,
  ChevronLeft,
  Check,
  ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { useCreateFamily, useJoinFamily } from '@/lib/hooks/use-family';
import { useUpdatePreferences } from '@/lib/hooks/use-preferences';
import { useCreateItem } from '@/lib/hooks/use-items';
import { useAuth } from '@/lib/hooks/use-auth';
import { api, setAccessToken } from '@/lib/api';
import { CLOTHING_TYPES, StyleProfile } from '@/lib/types';
import type { SavedLocation } from '@/lib/geo';
import { getBrowserTimezone } from '@/lib/timezones';
import { useAutoTimezone } from '@/lib/hooks/use-location';
import { LocationPicker } from '@/components/settings/location-picker';
import { TimezoneCombobox } from '@/components/settings/timezone-combobox';
import { ColorPreferences } from '@/components/settings/color-preferences';
import { useClothingTypeLabel } from '@/lib/clothing-type-label';
import { useTranslations } from 'next-intl';
import { LanguageSwitcher } from '@/components/language-switcher';
import { Wordmark } from '@/components/brand/wordmark';
import { Stinky } from '@/components/stinky/stinky';
import type { StinkyStateInput } from '@/components/stinky/stinky-states';
import { cn } from '@/lib/utils';

const STEPS = [
  { id: 'welcome', icon: Shirt },
  { id: 'family', icon: Users },
  { id: 'location', icon: MapPin },
  { id: 'preferences', icon: Palette },
  { id: 'upload', icon: Camera },
] as const;

/** Stinky in a soft-pink circle — the friendly header used across onboarding. */
function StinkyHeader({ state = 'wave', size = 128 }: { state?: StinkyStateInput; size?: number }) {
  return (
    <div
      className="mx-auto flex items-center justify-center rounded-full bg-signature-soft"
      style={{ width: size, height: size }}
    >
      <Stinky state={state} size={Math.round(size * 0.86)} label="" />
    </div>
  );
}

function StepHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="text-center">
      <h2 className="text-2xl font-extrabold tracking-[-0.02em] sm:text-[28px]">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-md text-[15px] leading-snug text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function StepIndicator({ currentStep }: { currentStep: number }) {
  const t = useTranslations('onboarding');
  return (
    <div
      className="mb-6 flex items-center justify-center gap-1.5"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={STEPS.length}
      aria-valuenow={currentStep + 1}
      aria-label={t('stepOf', { current: currentStep + 1, total: STEPS.length })}
    >
      {STEPS.map((step, index) => {
        const Icon = step.icon;
        const isComplete = index < currentStep;
        const isCurrent = index === currentStep;

        return (
          <div key={step.id} className={cn('flex items-center', index < STEPS.length - 1 && 'min-w-0')}>
            <div
              aria-hidden
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors duration-200',
                isCurrent
                  ? 'bg-signature text-signature-foreground'
                  : isComplete
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-panel text-muted-foreground'
              )}
            >
              {isComplete ? (
                <Check className="h-[18px] w-[18px]" strokeWidth={2.5} />
              ) : (
                <Icon className="h-[18px] w-[18px]" strokeWidth={isCurrent ? 2 : 1.75} />
              )}
            </div>
            {index < STEPS.length - 1 && (
              <div
                aria-hidden
                className={cn(
                  'mx-0.5 h-1 w-4 min-w-1 shrink rounded-full sm:mx-1 sm:w-8',
                  index < currentStep ? 'bg-primary' : 'bg-panel'
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  // Use unified auth hook to get user name (works in both auth modes)
  const { user } = useAuth();
  const t = useTranslations('onboarding');
  const tCommon = useTranslations('common');
  const firstName = user?.display_name ? user.display_name.split(' ')[0] : '';

  const features = [
    { icon: Camera, color: 'bg-pop-amber', title: t('step1Title'), desc: t('step1Desc') },
    { icon: Palette, color: 'bg-pop-sky', title: t('step2Title'), desc: t('step2Desc') },
    { icon: Users, color: 'bg-pop-mint', title: t('step3Title'), desc: t('step3Desc') },
  ];

  return (
    <div className="space-y-6 text-center">
      <StinkyHeader state="wave" size={144} />
      <div>
        <h1 className="text-[28px] font-extrabold leading-tight tracking-[-0.02em] sm:text-3xl">
          {t('welcomeTitle', { name: firstName || tCommon('friend') })}
        </h1>
        <p className="mx-auto mt-2 max-w-md text-[15px] leading-snug text-muted-foreground sm:text-base">
          {t('welcomeSubtitle')}
        </p>
      </div>
      <div className="mx-auto grid grid-cols-1 max-w-md gap-2 text-left">
        {features.map(({ icon: Icon, color, title, desc }) => (
          <div key={title} className="flex items-start gap-3 rounded-quick bg-panel p-3">
            <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-pop-foreground', color)}>
              <Icon className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div>
              <p className="font-bold">{title}</p>
              <p className="text-sm text-muted-foreground">{desc}</p>
            </div>
          </div>
        ))}
      </div>
      <Button size="lg" onClick={onNext} className="w-full max-w-md">
        {t('getStarted')}
        <ArrowRight className="h-5 w-5" />
      </Button>
    </div>
  );
}

function FamilyStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const t = useTranslations('onboarding.family');
  const tCommon = useTranslations('common');
  const [mode, setMode] = useState<'create' | 'join' | null>(null);
  const [familyName, setFamilyName] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  const createFamily = useCreateFamily();
  const joinFamily = useJoinFamily();

  const handleCreate = async () => {
    if (!familyName.trim()) return;
    try {
      await createFamily.mutateAsync(familyName.trim());
      toast.success(t('createdToast'));
      onNext();
    } catch (error) {
      toast.error(t('createError'));
    }
  };

  const handleJoin = async () => {
    if (!inviteCode.trim()) return;
    try {
      await joinFamily.mutateAsync(inviteCode.trim().toUpperCase());
      toast.success(t('joinedToast'));
      onNext();
    } catch (error) {
      toast.error(t('invalidCode'));
    }
  };

  return (
    <div className="space-y-6">
      <StepHeader title={t('title')} subtitle={t('subtitle')} />

      <div className="mx-auto grid grid-cols-1 max-w-2xl gap-3 md:grid-cols-2">
        <Card
          className={cn(
            'transition-colors duration-150',
            mode === 'create' ? 'border-signature bg-signature-soft ring-1 ring-signature' : 'border-0 bg-panel'
          )}
        >
          <button
            type="button"
            onClick={() => setMode('create')}
            aria-expanded={mode === 'create'}
            className="block w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">{t('createCard')}</CardTitle>
              <CardDescription>{t('createDesc')}</CardDescription>
            </CardHeader>
          </button>
          {mode === 'create' && (
            <CardContent>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="family-name">{t('familyNameLabel')}</Label>
                  <Input
                    id="family-name"
                    placeholder={t('familyNamePlaceholder')}
                    value={familyName}
                    onChange={(e) => setFamilyName(e.target.value)}
                  />
                </div>
                <Button
                  className="w-full"
                  onClick={handleCreate}
                  disabled={!familyName.trim() || createFamily.isPending}
                >
                  {createFamily.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t('createButton')}
                </Button>
              </div>
            </CardContent>
          )}
        </Card>

        <Card
          className={cn(
            'transition-colors duration-150',
            mode === 'join' ? 'border-signature bg-signature-soft ring-1 ring-signature' : 'border-0 bg-panel'
          )}
        >
          <button
            type="button"
            onClick={() => setMode('join')}
            aria-expanded={mode === 'join'}
            className="block w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">{t('joinCard')}</CardTitle>
              <CardDescription>{t('joinDesc')}</CardDescription>
            </CardHeader>
          </button>
          {mode === 'join' && (
            <CardContent>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="invite-code">{t('inviteCodeLabel')}</Label>
                  <Input
                    id="invite-code"
                    placeholder={t('inviteCodePlaceholder')}
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                    autoCapitalize="characters"
                  />
                </div>
                <Button
                  className="w-full"
                  onClick={handleJoin}
                  disabled={!inviteCode.trim() || joinFamily.isPending}
                >
                  {joinFamily.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t('joinButton')}
                </Button>
                {joinFamily.isError && (
                  <p role="alert" className="text-sm font-semibold text-destructive">{t('invalidCodeShort')}</p>
                )}
              </div>
            </CardContent>
          )}
        </Card>
      </div>

      <div className="text-center">
        <Button variant="ghost" onClick={onSkip}>
          {tCommon('skip')}
        </Button>
      </div>
    </div>
  );
}

function LocationStep({
  onNext,
  onSkip,
}: {
  onNext: () => void;
  onSkip: () => void;
}) {
  const t = useTranslations('onboarding.location');
  const tCommon = useTranslations('common');
  // Use unified auth hook (token is already set by useAuth)
  const { session } = useAuth();
  const [location, setLocation] = useState<SavedLocation>({ name: '', lat: null, lon: null });
  // New accounts start on the device's zone; picking a city switches to the city's.
  const [timezone, setTimezone] = useState(() => getBrowserTimezone() || 'UTC');
  // Neither of those is a hand-picked zone: only a tap on the picker is.
  const [timezoneTouched, setTimezoneTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const autoTimezone = useAutoTimezone();

  const handleLocationChange = (next: SavedLocation) => {
    setLocation(next);
    if (next.timezone) setTimezone(next.timezone);
  };

  const ready = !!location.name && location.lat !== null && location.lon !== null;

  const handleContinue = async () => {
    if (!ready) return;

    setSaving(true);
    try {
      if (session?.accessToken) {
        setAccessToken(session.accessToken as string);
      }
      await api.patch('/users/me', {
        location_name: location.name,
        location_lat: location.lat,
        location_lon: location.lon,
        // Sending the zone marks it hand-picked; the detected one goes through
        // the auto endpoint instead, so Ajustes can still say "detectada".
        ...(timezoneTouched ? { timezone } : {}),
      });
      if (!timezoneTouched && timezone) {
        await autoTimezone.mutateAsync(timezone).catch(() => undefined);
      }
      toast.success(t('savedToast'));
      onNext();
    } catch (error) {
      toast.error(t('saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-6">
      <StepHeader title={t('title')} subtitle={t('subtitle')} />

      <Card>
        <CardContent className="space-y-5 p-5 sm:p-6">
          <LocationPicker
            id="onboarding-location"
            value={location}
            onChange={handleLocationChange}
            showAdvanced={false}
          />
          <TimezoneCombobox
            id="onboarding-timezone"
            value={timezone}
            onChange={(tz) => {
              setTimezone(tz);
              setTimezoneTouched(true);
            }}
            cityTimezone={location.timezone}
            cityName={location.name.split(',')[0]}
          />
          <Button className="w-full" onClick={handleContinue} disabled={!ready || saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('continue')}
          </Button>
        </CardContent>
      </Card>

      <div className="text-center">
        <Button variant="ghost" onClick={onSkip}>
          {tCommon('skip')}
        </Button>
      </div>
    </div>
  );
}

function PreferencesStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const t = useTranslations('onboarding.preferences');
  const tCommon = useTranslations('common');
  const [favoriteColors, setFavoriteColors] = useState<string[]>([]);
  const [avoidColors, setAvoidColors] = useState<string[]>([]);
  const [styleProfile, setStyleProfile] = useState<StyleProfile>({
    casual: 50,
    formal: 50,
    sporty: 50,
    minimalist: 50,
    bold: 50,
  });
  const [saving, setSaving] = useState(false);
  const updatePreferences = useUpdatePreferences();

  // A colour can't be both a favourite and one to avoid.
  const setFavorites = (colors: string[]) => {
    setFavoriteColors(colors);
    setAvoidColors((prev) => prev.filter((c) => !colors.includes(c)));
  };
  const setAvoid = (colors: string[]) => {
    setAvoidColors(colors);
    setFavoriteColors((prev) => prev.filter((c) => !colors.includes(c)));
  };

  const handleContinue = async () => {
    setSaving(true);
    try {
      await updatePreferences.mutateAsync({
        color_favorites: favoriteColors,
        color_avoid: avoidColors,
        style_profile: styleProfile,
      });
      toast.success(t('savedToast'));
      onNext();
    } catch (error) {
      toast.error(t('saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <StepHeader title={t('title')} subtitle={t('subtitle')} />

      <Card>
        <CardContent className="p-5 sm:p-6">
          <ColorPreferences
            label={t('favoritesTitle')}
            description={t('favoritesDesc')}
            selected={favoriteColors}
            onChange={setFavorites}
            tone="favorite"
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5 sm:p-6">
          <ColorPreferences
            label={t('avoidTitle')}
            description={t('avoidDesc')}
            selected={avoidColors}
            onChange={setAvoid}
            tone="avoid"
          />
        </CardContent>
      </Card>

      <Card className="border-0 bg-panel">
        <CardHeader>
          <CardTitle className="text-lg">{t('profileTitle')}</CardTitle>
          <CardDescription>{t('profileDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {Object.entries(styleProfile).map(([key, value]) => (
            <div key={key} className="space-y-2">
              <div className="flex items-center justify-between">
                <Label id={`style-${key}`} className="font-bold">{t(`style.${key}` as 'style.casual' | 'style.formal' | 'style.sporty' | 'style.minimalist' | 'style.bold')}</Label>
                <span className="text-sm font-semibold tabular-nums text-muted-foreground">{value}%</span>
              </div>
              <Slider
                aria-labelledby={`style-${key}`}
                value={[value]}
                onValueChange={(vals) =>
                  setStyleProfile((prev) => ({ ...prev, [key]: vals[0] }))
                }
                min={0}
                max={100}
                step={10}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3 pt-2">
        <Button variant="ghost" onClick={onSkip}>
          {tCommon('skip')}
        </Button>
        <Button onClick={handleContinue} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {t('continue')}
        </Button>
      </div>
    </div>
  );
}

function UploadStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const t = useTranslations('onboarding.upload');
  const typeLabel = useClothingTypeLabel();
  const tCommon = useTranslations('common');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [itemType, setItemType] = useState('');
  const createItem = useCreateItem();

  // Clean up blob URL on unmount or when preview changes
  useEffect(() => {
    return () => {
      if (preview) {
        URL.revokeObjectURL(preview);
      }
    };
  }, [preview]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      // Revoke previous preview URL if exists
      if (preview) {
        URL.revokeObjectURL(preview);
      }
      setFile(selected);
      setPreview(URL.createObjectURL(selected));
    }
  };

  const clearFile = () => {
    if (preview) {
      URL.revokeObjectURL(preview);
    }
    setFile(null);
    setPreview(null);
  };

  const handleUpload = async () => {
    if (!file || !itemType) return;

    const formData = new FormData();
    formData.append('image', file);
    formData.append('type', itemType);

    try {
      await createItem.mutateAsync(formData);
      toast.success(t('addedToast'));
      onNext();
    } catch (error) {
      toast.error(t('addError'));
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-6">
      <StepHeader title={t('title')} subtitle={t('subtitle')} />

      <Card className="border-0 bg-transparent">
        <CardContent className="space-y-4 p-0 sm:p-0">
          {preview ? (
            <div className="space-y-4">
              <div className="relative aspect-square overflow-hidden rounded-tile bg-panel">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={preview}
                  alt={t('previewAlt')}
                  className="h-full w-full object-contain p-4"
                />
              </div>
              <Button
                variant="secondary"
                className="w-full"
                onClick={clearFile}
              >
                {t('chooseAnother')}
              </Button>
            </div>
          ) : (
            <label className="flex aspect-square w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-panel transition-colors hover:bg-accent focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
              <div className="flex flex-col items-center justify-center px-6 pb-6 pt-5 text-center">
                <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-signature text-signature-foreground">
                  <Camera className="h-7 w-7" strokeWidth={1.75} />
                </span>
                <p className="mb-1 text-[15px] font-bold">{t('clickToUpload')}</p>
                <p className="text-xs text-muted-foreground">{t('acceptedFormats')}</p>
              </div>
              <input
                type="file"
                className="sr-only"
                accept="image/*"
                capture="environment"
                onChange={handleFileChange}
              />
            </label>
          )}

          {file && (
            <div className="space-y-2">
              <Label htmlFor="item-type" className="font-bold">{t('typeLabel')}</Label>
              <Select value={itemType} onValueChange={setItemType}>
                <SelectTrigger id="item-type">
                  <SelectValue placeholder={t('typePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {CLOTHING_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {typeLabel(type.value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Button
            className="w-full"
            onClick={handleUpload}
            disabled={!file || !itemType || createItem.isPending}
          >
            {createItem.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('addButton')}
          </Button>
        </CardContent>
      </Card>

      <div className="text-center">
        <Button variant="ghost" onClick={onSkip}>
          {tCommon('skip')}
        </Button>
      </div>
    </div>
  );
}

function CompleteStep({ onFinish, completing }: { onFinish: () => void; completing: boolean }) {
  const t = useTranslations('onboarding.complete');
  return (
    <div className="space-y-6 text-center">
      <StinkyHeader state="happy" size={144} />
      <div>
        <h1 className="text-[28px] font-extrabold leading-tight tracking-[-0.02em] sm:text-3xl">{t('title')}</h1>
        <p className="mx-auto mt-2 max-w-md text-[15px] leading-snug text-muted-foreground sm:text-base">
          {t('subtitle')}
        </p>
      </div>
      <Button size="lg" onClick={onFinish} disabled={completing} className="w-full max-w-md">
        {completing ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            {t('finishing')}
          </>
        ) : (
          <>
            {t('finish')}
            <ArrowRight className="h-5 w-5" />
          </>
        )}
      </Button>
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, isAuthenticated, isLoading, session } = useAuth();
  const tComplete = useTranslations('onboarding.complete');
  const tCommon = useTranslations('common');
  const [currentStep, setCurrentStep] = useState(0);
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    if (!isLoading && isAuthenticated && user && !user.username) {
      router.replace('/onboarding/username');
    }
  }, [isLoading, isAuthenticated, user, router]);

  const nextStep = () => setCurrentStep((s) => Math.min(s + 1, STEPS.length));
  const prevStep = () => setCurrentStep((s) => Math.max(s - 1, 0));

  const completeOnboarding = async () => {
    setCompleting(true);
    try {
      if (session?.accessToken) {
        setAccessToken(session.accessToken as string);
      }
      await api.post('/users/me/onboarding/complete');
      // Invalidate cached user data so dashboard sees onboarding_completed: true
      await queryClient.invalidateQueries({ queryKey: ['auth-user'] });
      // Redirect to dashboard
      router.push('/dashboard');
    } catch (error) {
      setCompleting(false);
      toast.error(tComplete('finishError'));
    }
  };

  const handleFinish = () => {
    completeOnboarding();
  };

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Redirect to login if not authenticated (API call failed)
  if (!isAuthenticated) {
    router.push('/login');
    return null;
  }

  // If user already completed onboarding, redirect to dashboard
  if (user?.onboarding_completed) {
    router.push('/dashboard');
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar: wordmark + language */}
      <div className="mx-auto flex max-w-4xl items-center justify-between px-4 pt-5 sm:px-6 sm:pt-8">
        <Wordmark className="text-[26px]" />
        <LanguageSwitcher variant="compact" />
      </div>

      <div className="mx-auto max-w-4xl px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
        {currentStep < STEPS.length && <StepIndicator currentStep={currentStep} />}

        <div className="py-4 sm:py-8">
          {currentStep === 0 && <WelcomeStep onNext={nextStep} />}
          {currentStep === 1 && <FamilyStep onNext={nextStep} onSkip={nextStep} />}
          {currentStep === 2 && (
            <LocationStep
              onNext={nextStep}
              onSkip={nextStep}
            />
          )}
          {currentStep === 3 && <PreferencesStep onNext={nextStep} onSkip={nextStep} />}
          {currentStep === 4 && <UploadStep onNext={nextStep} onSkip={nextStep} />}
          {currentStep === STEPS.length && <CompleteStep onFinish={handleFinish} completing={completing} />}
        </div>

        {/* Navigation */}
        {currentStep > 0 && currentStep < STEPS.length && (
          <div className="mt-4 flex justify-center">
            <Button variant="ghost" onClick={prevStep} className="text-muted-foreground hover:text-foreground">
              <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
              {tCommon('back')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
