'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCloneToLookbook } from '@/lib/hooks/use-studio';
import { getErrorMessage } from '@/lib/api';
import { formatDateLocalized } from '@/lib/date-locale';

interface CloneToLookbookDialogProps {
  open: boolean;
  sourceOutfitId: string;
  sourceOccasion: string;
  onClose: () => void;
  onSuccess?: (newOutfitId: string) => void;
}

function defaultCloneName(occasion: string, locale: string): string {
  const occasionTitle = occasion.charAt(0).toLocaleUpperCase() + occasion.slice(1);
  return `${occasionTitle} — ${formatDateLocalized(new Date(), 'short', locale)}`;
}

export function CloneToLookbookDialog({
  open,
  sourceOutfitId,
  sourceOccasion,
  onClose,
  onSuccess,
}: CloneToLookbookDialogProps) {
  const t = useTranslations('cloneToLookbook');
  const tOccasions = useTranslations('suggest.occasions');
  const locale = useLocale();
  const [name, setName] = useState(() =>
    defaultCloneName(
      tOccasions.has(sourceOccasion as never)
        ? tOccasions(sourceOccasion as never)
        : sourceOccasion,
      locale
    )
  );
  const clone = useCloneToLookbook(sourceOutfitId);

  const handleConfirm = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error(t('toast.nameRequired'));
      return;
    }
    try {
      const result = await clone.mutateAsync({ name: trimmed });
      toast.success(t('toast.saved'));
      onSuccess?.(result.id);
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error, t('toast.failed')));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('dialogTitle')}</DialogTitle>
          <DialogDescription>
            {t('dialogDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="lookbook-name">{t('nameLabel')}</Label>
          <Input
            id="lookbook-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            placeholder={t('namePlaceholder')}
            autoFocus
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="secondary" onClick={onClose} disabled={clone.isPending}>
            {t('cancel')}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={clone.isPending || !name.trim()}
          >
            {clone.isPending ? t('saving') : t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
