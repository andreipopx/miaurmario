'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, Loader2, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PersonAvatar } from '@/components/social/person-avatar';
import { AvatarCropper, type CropResult } from '@/components/settings/avatar-cropper';
import { ApiError } from '@/lib/api';
import { avatarFileError } from '@/lib/avatar-crop';
import { useDeleteAvatar, useUploadAvatar, type UserProfile } from '@/lib/hooks/use-user';

const SERVER_ERRORS: Record<string, 'type' | 'size' | 'invalid'> = {
  unsupported_image_type: 'type',
  image_too_large: 'size',
  invalid_image: 'invalid',
};

/** Map a failed upload to a key under settings.avatar.errors. */
export function avatarErrorKey(error: unknown): 'type' | 'size' | 'invalid' | 'rateLimited' | 'generic' {
  if (error instanceof ApiError) {
    if (error.status === 429) return 'rateLimited';
    if (error.status === 413) return 'size';
    const key = SERVER_ERRORS[error.message];
    if (key) return key;
  }
  return 'generic';
}

/**
 * Settings → profile photo: pick (camera or gallery on phones), circle-crop, upload,
 * or remove. Without a photo the social surfaces show the @handle's initial.
 */
export function AvatarSettings({ user }: { user: UserProfile | undefined }) {
  const t = useTranslations('settings.avatar');
  const tCommon = useTranslations('common');
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [crop, setCrop] = useState<CropResult | null>(null);
  const upload = useUploadAvatar();
  const remove = useDeleteAvatar();

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = ''; // picking the same file again must still fire change
    if (!picked) return;
    const err = avatarFileError(picked);
    if (err) {
      toast.error(t(`errors.${err}`));
      return;
    }
    setFile(picked);
  };

  const close = () => {
    if (upload.isPending) return;
    setFile(null);
    setCrop(null);
  };

  const save = () => {
    if (!file) return;
    upload.mutate(
      { file, crop },
      {
        onSuccess: () => {
          toast.success(t('saved'));
          setFile(null);
          setCrop(null);
        },
        onError: (error) => toast.error(t(`errors.${avatarErrorKey(error)}`)),
      }
    );
  };

  const onRemove = () => {
    remove.mutate(undefined, {
      onSuccess: () => toast.success(t('removed')),
      onError: () => toast.error(t('errors.generic')),
    });
  };

  const hasPhoto = !!user?.has_avatar_photo;
  const handle = user?.username || '';

  return (
    <div className="flex items-center gap-4">
      <PersonAvatar
        user={{
          username: handle,
          display_name: handle,
          avatar_url: hasPhoto ? user?.avatar_url ?? null : null,
          avatar_thumb_url: hasPhoto ? user?.avatar_thumb_url ?? null : null,
        }}
        size={72}
      />
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <p className="text-sm font-bold">{t('title')}</p>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => input.current?.click()}>
            <Camera className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            {hasPhoto ? t('change') : t('add')}
          </Button>
          {hasPhoto && (
            <Button type="button" size="sm" variant="ghost" onClick={onRemove} disabled={remove.isPending}>
              {remove.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden />
              ) : (
                <Trash2 className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              )}
              {t('remove')}
            </Button>
          )}
        </div>
        {/* No `capture`: phones then offer both the camera and the photo library. */}
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={onPick}
        />
      </div>

      <Dialog open={!!file} onOpenChange={(open) => !open && close()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('cropTitle')}</DialogTitle>
            <DialogDescription>{t('cropHint')}</DialogDescription>
          </DialogHeader>
          {preview && <AvatarCropper src={preview} onChange={setCrop} />}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={close} disabled={upload.isPending}>
              {tCommon('cancel')}
            </Button>
            <Button type="button" onClick={save} disabled={upload.isPending}>
              {upload.isPending && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden />}
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
