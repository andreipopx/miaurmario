'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Stinky } from '@/components/stinky/stinky';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { useGeneratePairings } from '@/lib/hooks/use-pairings';
import { Item, Pairing } from '@/lib/types';
import Image from 'next/image';
import { useRouter } from 'next/navigation';

interface GeneratePairingsDialogProps {
  item: Item | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Images now use signed URLs from backend (item.image_url, item.thumbnail_url)

export function GeneratePairingsDialog({
  item,
  open,
  onOpenChange,
}: GeneratePairingsDialogProps) {
  const t = useTranslations('generatePairings');
  const [numPairings, setNumPairings] = useState(3);
  const [generatedPairings, setGeneratedPairings] = useState<Pairing[] | null>(null);
  const generatePairings = useGeneratePairings();
  const router = useRouter();

  const handleGenerate = async () => {
    if (!item) return;

    try {
      const result = await generatePairings.mutateAsync({
        itemId: item.id,
        numPairings,
      });
      setGeneratedPairings(result.pairings);
      toast.success(t('successToast', { count: result.generated }));
    } catch (error) {
      const message = error instanceof Error ? error.message : t('errorToast');
      toast.error(message);
    }
  };

  const handleViewPairings = () => {
    onOpenChange(false);
    setGeneratedPairings(null);
    router.push('/dashboard/pairings');
  };

  const handleClose = () => {
    onOpenChange(false);
    setGeneratedPairings(null);
  };

  if (!item) return null;

  const imageUrl = item.thumbnail_url || item.image_url || item.image_path;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-signature text-signature-foreground">
              <Sparkles className="h-4 w-4" strokeWidth={1.75} />
            </span>
            {t('dialogTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('description')}
          </DialogDescription>
        </DialogHeader>

        {!generatedPairings ? (
          // Generation form
          <div className="min-w-0 space-y-6 py-4">
            {/* Source item preview */}
            <div className="flex items-center gap-4 rounded-[18px] bg-panel p-2 pr-4">
              <div className="relative h-16 w-16 overflow-hidden rounded-[14px] bg-background">
                <Image
                  src={imageUrl}
                  alt={item.name || item.type}
                  fill
                  className="object-contain p-1.5"
                  sizes="64px"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{item.name || item.type}</p>
                {item.primary_color && (
                  <p className="text-sm text-muted-foreground capitalize">
                    {t('colorTypeSubtitle', { color: item.primary_color, type: item.type })}
                  </p>
                )}
              </div>
            </div>

            {/* Number of pairings selector */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label id="num-pairings-label" className="font-bold">{t('numberOfOutfits')}</Label>
                <span className="flex h-8 min-w-8 items-center justify-center rounded-full bg-signature px-2 text-sm font-bold text-signature-foreground">
                  {numPairings}
                </span>
              </div>
              <Slider
                value={[numPairings]}
                onValueChange={([value]) => setNumPairings(value)}
                min={1}
                max={5}
                step={1}
                className="w-full"
                aria-labelledby="num-pairings-label"
              />
              <p className="text-xs text-muted-foreground">
                {t('helpMore')}
              </p>
            </div>
          </div>
        ) : (
          // Success state
          <div className="space-y-4 py-4 text-center">
            <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-full bg-signature-soft">
              <Stinky state="happy" size={96} label="" />
            </div>
            <div>
              <p className="text-lg font-extrabold">
                {t('createdHeadline', { count: generatedPairings.length })}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('viewInPairings')}
              </p>
            </div>

            {/* Preview of generated pairings */}
            <div className="flex flex-wrap justify-center gap-2">
              {generatedPairings.slice(0, 3).map((pairing) => (
                <div
                  key={pairing.id}
                  className="flex gap-1 rounded-[14px] bg-panel p-1.5"
                >
                  {pairing.items.slice(0, 3).map((pairingItem) => (
                    <div
                      key={pairingItem.id}
                      className="relative h-9 w-9 overflow-hidden rounded-[10px] bg-background"
                    >
                      {pairingItem.thumbnail_url ? (
                        <Image
                          src={pairingItem.thumbnail_url}
                          alt={pairingItem.type}
                          fill
                          className="object-contain p-0.5"
                          sizes="36px"
                        />
                      ) : (
                        <div className="h-full w-full bg-muted" />
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {!generatedPairings ? (
            <>
              <Button variant="secondary" onClick={handleClose}>
                {t('cancel')}
              </Button>
              <Button
                onClick={handleGenerate}
                disabled={generatePairings.isPending}
                aria-busy={generatePairings.isPending}
              >
                {generatePairings.isPending ? (
                  <>
                    <Stinky state="thinking" size={28} label="" className="-my-1" />
                    {t('generating')}
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" strokeWidth={1.75} />
                    {t('generate')}
                  </>
                )}
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={handleClose}>
                {t('close')}
              </Button>
              <Button onClick={handleViewPairings}>
                {t('viewPairings')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
