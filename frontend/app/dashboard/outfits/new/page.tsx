'use client';

import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { EmptyState } from '@/components/empty-state';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CanvasPanel } from '@/components/studio/canvas-panel';
import { DetailsPanel } from '@/components/studio/details-panel';
import { ItemPicker } from '@/components/shared/item-picker';
import { CloneToLookbookDialog } from '@/components/shared/clone-to-lookbook-dialog';
import { ApiError, getErrorMessage } from '@/lib/api';
import { useItems } from '@/lib/hooks/use-items';
import { useOutfit } from '@/lib/hooks/use-outfits';
import { useCreateStudioOutfit, usePatchOutfit } from '@/lib/hooks/use-studio';
import {
  INITIAL_STUDIO_STATE,
  studioReducer,
  type StudioItem,
} from '@/lib/studio/editor-state';
import {
  clearDraft,
  draftItemsFrom,
  loadDraft,
  saveDraft,
  type StudioDraft,
} from '@/lib/studio/draft-storage';
import type { Item } from '@/lib/types';
import { isWornImmutableError } from '@/lib/studio/errors';
import { computeEditLoadPhase } from '@/lib/studio/edit-load';

export default function StudioEditorPage() {
  const t = useTranslations('outfitNew');
  const tSocial = useTranslations('social.shareLook');
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get('edit') || undefined;
  const isEditMode = !!editId;

  const [state, dispatch] = useReducer(studioReducer, INITIAL_STUDIO_STATE);
  const [draftPrompted, setDraftPrompted] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<StudioDraft | null>(null);
  const [editLoaded, setEditLoaded] = useState(false);
  const [wornConflictOpen, setWornConflictOpen] = useState(false);
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const [shareWithFriends, setShareWithFriends] = useState(false);

  const createMutation = useCreateStudioOutfit();
  const patchMutation = usePatchOutfit();

  const {
    data: editOutfit,
    isLoading: editLoading,
    isError: editIsError,
    error: editError,
    refetch: refetchEdit,
  } = useOutfit(editId);

  const editErrorStatus =
    editError instanceof ApiError ? editError.status : null;
  const editOutfitIsWorn = !!editOutfit?.feedback?.worn_at;

  useEffect(() => {
    if (!isEditMode || editLoaded || !editOutfit) return;
    if (editOutfit.feedback?.worn_at) return;
    const items: StudioItem[] = editOutfit.items.map((item) => ({
      id: item.id,
      type: item.type,
      name: item.name ?? null,
      thumbnail_url: item.thumbnail_url ?? null,
      image_url: item.image_url ?? null,
      primary_color: item.primary_color ?? null,
      pos_x: item.pos_x ?? null,
      pos_y: item.pos_y ?? null,
      scale: item.scale,
      rotation: item.rotation,
      z_index: item.z_index,
    }));
    dispatch({
      type: 'LOAD',
      state: {
        items,
        name: editOutfit.name ?? '',
        occasion: editOutfit.occasion ?? null,
      },
    });
    setEditLoaded(true);
    setDraftPrompted(true);
  }, [editOutfit, editLoaded, isEditMode]);

  useEffect(() => {
    if (isEditMode || draftPrompted) return;
    const draft = loadDraft();
    if (draft && draft.items.length > 0) {
      setPendingDraft(draft);
    }
    setDraftPrompted(true);
  }, [draftPrompted, isEditMode]);

  const draftItemCount = pendingDraft?.items.length ?? 0;
  const draftIdsJoined = pendingDraft
    ? pendingDraft.items.map((d) => d.id).join(',')
    : '';
  const { data: draftItemsData } = useItems(
    pendingDraft
      ? { ids: draftIdsJoined, is_archived: false }
      : { is_archived: false },
    1,
    draftItemCount > 0 ? draftItemCount : 50
  );

  const handleResumeDraft = useCallback(() => {
    if (!pendingDraft || !draftItemsData?.items) return;
    const byId = new Map(draftItemsData.items.map((i) => [i.id, i]));
    const resumedItems: StudioItem[] = pendingDraft.items
      .map((draftItem): StudioItem | null => {
        const wardrobe = byId.get(draftItem.id);
        if (!wardrobe) return null;
        return {
          id: wardrobe.id,
          type: wardrobe.type,
          name: wardrobe.name ?? null,
          thumbnail_url: wardrobe.thumbnail_url ?? null,
          image_url: wardrobe.image_url ?? null,
          primary_color: wardrobe.primary_color ?? null,
          pos_x: draftItem.pos_x ?? null,
          pos_y: draftItem.pos_y ?? null,
          scale: draftItem.scale,
          rotation: draftItem.rotation,
          z_index: draftItem.z_index,
        };
      })
      .filter((item): item is StudioItem => item !== null);
    dispatch({
      type: 'LOAD',
      state: {
        items: resumedItems,
        name: pendingDraft.name,
        occasion: pendingDraft.occasion,
      },
    });
    setPendingDraft(null);
  }, [pendingDraft, draftItemsData]);

  const handleDiscardDraft = useCallback(() => {
    clearDraft();
    setPendingDraft(null);
  }, []);

  useEffect(() => {
    if (isEditMode) return;
    if (!state.isDirty) return;
    const timer = setTimeout(() => {
      saveDraft({
        items: draftItemsFrom(state.items),
        name: state.name,
        occasion: state.occasion,
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [state.isDirty, state.items, state.name, state.occasion, isEditMode]);

  const selectedIds = useMemo(
    () => new Set(state.items.map((i) => i.id)),
    [state.items]
  );

  const handleToggle = useCallback((item: Item) => {
    const existing = state.items.find((i) => i.id === item.id);
    if (existing) {
      dispatch({ type: 'REMOVE_ITEM', itemId: item.id });
      return;
    }
    dispatch({
      type: 'ADD_ITEM',
      item: {
        id: item.id,
        type: item.type,
        name: item.name ?? null,
        thumbnail_url: item.thumbnail_url ?? null,
        image_url: item.image_url ?? null,
        primary_color: item.primary_color ?? null,
      },
    });
  }, [state.items]);

  const handleSave = async (markWorn: boolean) => {
    if (state.items.length === 0) {
      toast.error(t('toast.pickAtLeastOne'));
      return;
    }
    if (!state.occasion) {
      toast.error(t('toast.pickOccasion'));
      return;
    }

    if (isEditMode && editId) {
      try {
        await patchMutation.mutateAsync({
          id: editId,
          payload: {
            name: state.name.trim() || undefined,
            items: state.items.map((i) => i.id),
            items_layout: state.items.map((i) => ({
              item_id: i.id,
              pos_x: i.pos_x ?? null,
              pos_y: i.pos_y ?? null,
              scale: i.scale,
              rotation: i.rotation,
              z_index: i.z_index,
            })),
          },
        });
        toast.success(t('toast.outfitUpdated'));
        router.push(`/dashboard/outfits/${editId}`);
      } catch (error) {
        if (isWornImmutableError(error)) {
          setWornConflictOpen(true);
          return;
        }
        toast.error(getErrorMessage(error, t('toast.outfitSaveFailed')));
      }
      return;
    }

    if (!markWorn && !state.name.trim()) {
      toast.error(t('toast.nameRequired'));
      return;
    }

    try {
      await createMutation.mutateAsync({
        items: state.items.map((i) => i.id),
        items_layout: state.items.map((i) => ({
          item_id: i.id,
          pos_x: i.pos_x ?? null,
          pos_y: i.pos_y ?? null,
          scale: i.scale,
          rotation: i.rotation,
          z_index: i.z_index,
        })),
        occasion: state.occasion,
        name: state.name.trim() || undefined,
        scheduled_for: markWorn
          ? new Date().toISOString().slice(0, 10)
          : null,
        mark_worn: markWorn,
        ...(shareWithFriends ? { visibility: 'friends' as const } : {}),
      });
      clearDraft();
      toast.success(markWorn ? t('toast.savedAndWorn') : t('toast.savedToLookbook'));
      router.push(
        markWorn
          ? '/dashboard/outfits?filter=worn'
          : '/dashboard/outfits?filter=my-looks'
      );
    } catch (error) {
      toast.error(getErrorMessage(error, t('toast.outfitSaveFailed')));
    }
  };

  const mutationPending = isEditMode ? patchMutation.isPending : createMutation.isPending;
  const canSave =
    state.items.length > 0 && state.occasion !== null && !mutationPending;

  const editPhase = isEditMode
    ? computeEditLoadPhase({
        isLoading: editLoading,
        isError: editIsError,
        errorStatus: editErrorStatus,
        hasData: !!editOutfit,
        isWorn: editOutfitIsWorn,
        editLoaded,
      })
    : 'ready';

  if (isEditMode && editPhase === 'loading') {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isEditMode && editPhase === 'missing') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <EmptyState
          state="sleepy"
          title={t('notFoundTitle')}
          description={t('notFoundBody')}
          action={
            <Button asChild>
              <Link href="/dashboard/outfits">{t('back')}</Link>
            </Button>
          }
        />
      </div>
    );
  }

  if (isEditMode && editPhase === 'error') {
    const isAuthError = editErrorStatus === 401 || editErrorStatus === 403;
    const headline = isAuthError ? t('authErrorTitle') : t('loadErrorTitle');
    const body = isAuthError ? t('authErrorBody') : t('loadErrorBody');
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <EmptyState
          state="sad"
          title={headline}
          description={body}
          action={
            <>
              {!isAuthError && (
                <Button variant="secondary" onClick={() => refetchEdit()}>
                  {t('tryAgain')}
                </Button>
              )}
              <Button asChild>
                <Link href="/dashboard/outfits">{t('back')}</Link>
              </Button>
            </>
          }
        />
      </div>
    );
  }

  if (isEditMode && editPhase === 'wornImmutable' && editOutfit && editId) {
    return (
      <>
        <div className="flex min-h-[60vh] items-center justify-center">
          <EmptyState
            state="sleepy"
            title={t('wornImmutableTitle')}
            description={t('wornImmutableBody')}
            action={
              <>
                <Button variant="secondary" asChild>
                  <Link href={`/dashboard/outfits/${editId}`}>{t('backToOutfit')}</Link>
                </Button>
                <Button onClick={() => setCloneDialogOpen(true)}>{t('saveAsNew')}</Button>
              </>
            }
          />
        </div>
        <CloneToLookbookDialog
          open={cloneDialogOpen}
          sourceOutfitId={editId}
          sourceOccasion={editOutfit.occasion}
          onClose={() => setCloneDialogOpen(false)}
          onSuccess={(newId) => router.push(`/dashboard/outfits/${newId}`)}
        />
      </>
    );
  }

  const cancelHref = isEditMode && editId ? `/dashboard/outfits/${editId}` : '/dashboard/outfits';

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:mx-0 lg:px-0">
        <div className="flex min-w-0 items-center gap-1">
          <Button variant="ghost" size="icon" asChild className="-ml-2 shrink-0">
            <Link href={cancelHref} aria-label={t('cancel')}>
              <ChevronLeft className="h-5 w-5" strokeWidth={1.75} />
            </Link>
          </Button>
          <h1 className="truncate text-[22px] font-extrabold tracking-[-0.02em] sm:text-2xl">
            {isEditMode ? t('editTitle') : t('studioTitle')}
          </h1>
        </div>
        <div className="flex flex-col items-end">
          <div className="flex gap-2">
            {!isEditMode && (
              <Button
                variant="secondary"
                disabled={!canSave}
                onClick={() => handleSave(true)}
              >
                {mutationPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t('wearToday')
                )}
              </Button>
            )}
            <Button disabled={!canSave} onClick={() => handleSave(false)}>
              {mutationPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isEditMode ? (
                t('saveChanges')
              ) : (
                t('saveToLookbook')
              )}
            </Button>
          </div>
          {!isEditMode && (
            <label className="mt-1.5 flex min-h-[32px] cursor-pointer items-center gap-2 text-xs font-semibold">
              <Switch
                checked={shareWithFriends}
                onCheckedChange={setShareWithFriends}
                aria-label={tSocial('shareToggle')}
              />
              {tSocial('shareToggle')}
            </label>
          )}
          {!canSave && !mutationPending && (
            <p className="mt-1 text-right text-xs text-muted-foreground">
              {state.items.length === 0 && state.occasion === null
                ? t('pickAtLeastOneOrOccasion')
                : state.items.length === 0
                  ? t('pickAtLeastOne')
                  : state.occasion === null
                    ? t('pickOccasion')
                    : ''}
            </p>
          )}
        </div>
      </div>

      {pendingDraft && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-signature-soft px-4 py-3">
          <p className="text-sm font-medium text-foreground">
            {t('draftBanner')}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleDiscardDraft}>
              {t('startFresh')}
            </Button>
            <Button size="sm" onClick={handleResumeDraft}>
              {t('resume')}
            </Button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto pt-4">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section>
              <h2 className="mb-2 text-lg font-bold">
                {t('canvas')}
              </h2>
              <CanvasPanel
                items={state.items}
                onRemove={(id) => dispatch({ type: 'REMOVE_ITEM', itemId: id })}
                onMove={(id, pos_x, pos_y) =>
                  dispatch({ type: 'MOVE_ITEM', itemId: id, pos_x, pos_y })
                }
                onBringToFront={(id) =>
                  dispatch({ type: 'BRING_TO_FRONT', itemId: id })
                }
                onSendToBack={(id) =>
                  dispatch({ type: 'SEND_TO_BACK', itemId: id })
                }
              />
            </section>
            <section>
              <h2 className="mb-2 text-lg font-bold">
                {t('details')}
              </h2>
              <DetailsPanel
                items={state.items}
                name={state.name}
                occasion={state.occasion}
                onNameChange={(n) => dispatch({ type: 'SET_NAME', name: n })}
                onOccasionChange={(o) =>
                  dispatch({ type: 'SET_OCCASION', occasion: o })
                }
                onAiMerge={(merged) =>
                  dispatch({ type: 'REPLACE_CANVAS', items: merged })
                }
              />
            </section>
          </div>

          <section>
            <h2 className="mb-2 text-lg font-bold">
              {t('yourWardrobe')}
            </h2>
            <ItemPicker
              selectedIds={selectedIds}
              onToggle={handleToggle}
              hideNeedsWash={true}
              emptyMessage={t('emptyWardrobe')}
              heightClass="h-[280px]"
            />
          </section>
        </div>
      </div>

      <AlertDialog open={wornConflictOpen} onOpenChange={setWornConflictOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('wornConflictTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('wornConflictBody')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('discardChanges')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setWornConflictOpen(false);
                setCloneDialogOpen(true);
              }}
            >
              {t('saveAsNew')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isEditMode && editId && editOutfit && (
        <CloneToLookbookDialog
          open={cloneDialogOpen}
          sourceOutfitId={editId}
          sourceOccasion={editOutfit.occasion}
          onClose={() => setCloneDialogOpen(false)}
          onSuccess={(newId) => router.push(`/dashboard/outfits/${newId}`)}
        />
      )}
    </div>
  );
}
