'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, Loader2, Pencil, Pin, PinOff, Trash2, X } from 'lucide-react';

import { PageHeader } from '@/components/page-header';
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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { LazyStinky } from '@/components/native/lazy-stinky';
import {
  groupByKind,
  useClearStinkyMemory,
  useDeleteStinkyMemory,
  useSetStinkyCallName,
  useStinkyMemory,
  useUpdateStinkyMemory,
  type StinkyMemory,
} from '@/lib/hooks/use-stinky-memory';
import { cn } from '@/lib/utils';

/** One note: read it, rewrite it, pin it or throw it away. */
function MemoryRow({
  memory,
  maxChars,
  onSaved,
}: {
  memory: StinkyMemory;
  maxChars: number;
  onSaved: () => void;
}) {
  const t = useTranslations('stinkyMemory');
  const update = useUpdateStinkyMemory();
  const remove = useDeleteStinkyMemory();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memory.text);

  useEffect(() => {
    if (!editing) setDraft(memory.text);
  }, [editing, memory.text]);

  const save = () => {
    const text = draft.trim();
    if (!text) return;
    if (text === memory.text) {
      setEditing(false);
      return;
    }
    update.mutate(
      { id: memory.id, text },
      {
        onSuccess: () => {
          setEditing(false);
          onSaved();
        },
        onError: () => toast.error(t('saveError')),
      }
    );
  };

  const togglePin = () =>
    update.mutate(
      { id: memory.id, pinned: !memory.pinned },
      { onError: () => toast.error(t('saveError')) }
    );

  return (
    <li
      className="rounded-tile bg-panel px-3 py-2.5"
      data-testid={`memory-${memory.id}`}
      data-pinned={memory.pinned ? 'true' : 'false'}
    >
      {editing ? (
        <div className="space-y-2">
          <Label htmlFor={`memory-edit-${memory.id}`} className="sr-only">
            {t('editLabel')}
          </Label>
          <Textarea
            id={`memory-edit-${memory.id}`}
            value={draft}
            maxLength={maxChars}
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            data-testid="memory-edit-input"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="signature"
              onClick={save}
              disabled={update.isPending}
              data-testid="memory-edit-save"
            >
              {update.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden />
              )}
              {t('save')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t('cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-start gap-x-2 gap-y-1.5">
          <p className="min-w-0 flex-1 break-words [overflow-wrap:anywhere] text-sm leading-snug">
            {memory.text}
          </p>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={togglePin}
              aria-label={memory.pinned ? t('unpin') : t('pin')}
              data-testid="memory-pin"
            >
              {memory.pinned ? (
                <PinOff className="h-4 w-4" strokeWidth={2} aria-hidden />
              ) : (
                <Pin className="h-4 w-4" strokeWidth={2} aria-hidden />
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={() => setEditing(true)}
              aria-label={t('edit')}
              data-testid="memory-edit"
            >
              <Pencil className="h-4 w-4" strokeWidth={2} aria-hidden />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={() =>
                remove.mutate(memory.id, { onError: () => toast.error(t('deleteError')) })
              }
              disabled={remove.isPending}
              aria-label={t('delete')}
              data-testid="memory-delete"
            >
              <Trash2 className="h-4 w-4" strokeWidth={2} aria-hidden />
            </Button>
          </div>
          <p className="w-full text-[12px] leading-snug text-muted-foreground">
            {memory.pinned && <span className="mr-1 font-bold">{t('pinnedTag')}</span>}
            {memory.source === 'user' ? t('sourceUser') : t('sourceChat')}
          </p>
        </div>
      )}
    </li>
  );
}

/**
 * Ajustes → Stinky recuerda: the notebook Stinky writes while you chat with
 * him, in plain Spanish, with the user in control of every line.
 *
 * Taste and routine only — nothing here is ever about the person's body or
 * health, and nothing is shared with friends or family.
 */
export default function StinkyMemoryPage() {
  const t = useTranslations('stinkyMemory');

  const { data, isLoading } = useStinkyMemory();
  const setName = useSetStinkyCallName();
  const clearAll = useClearStinkyMemory();

  const [nameDraft, setNameDraft] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  // Follow the server while the user is not typing in the field.
  useEffect(() => {
    if (!nameTouched) setNameDraft(data?.call_name ?? '');
  }, [nameTouched, data?.call_name]);

  const groups = groupByKind(data?.memories ?? []);
  const total = data?.memories.length ?? 0;

  const saveName = () => {
    setName.mutate(nameDraft.trim(), {
      onSuccess: () => {
        setNameTouched(false);
        toast.success(t('name.saved'));
      },
      onError: () => toast.error(t('saveError')),
    });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-2 sm:py-4">
      <Button variant="ghost" asChild className="-ml-3 text-muted-foreground hover:text-foreground">
        <Link href="/dashboard/settings">{t('backToSettings')}</Link>
      </Button>

      <PageHeader title={t('pageTitle')} description={t('pageDescription')} />

      {/* --- How this works ------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle>{t('how.title')}</CardTitle>
          <CardDescription>{t('how.body')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5 text-sm leading-snug text-muted-foreground">
            <li className="rounded-quick bg-panel px-3 py-2">{t('how.point1')}</li>
            <li className="rounded-quick bg-panel px-3 py-2">{t('how.point2')}</li>
            <li className="rounded-quick bg-panel px-3 py-2">{t('how.point3')}</li>
          </ul>
        </CardContent>
      </Card>

      {/* --- ¿Cómo quieres que te llame? ----------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>{t('name.title')}</CardTitle>
          <CardDescription>{t('name.body')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="stinky-call-name">{t('name.label')}</Label>
            <Input
              id="stinky-call-name"
              value={nameDraft}
              maxLength={40}
              placeholder={t('name.placeholder')}
              onChange={(e) => {
                setNameTouched(true);
                setNameDraft(e.target.value);
              }}
              data-testid="call-name-input"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="signature"
              onClick={saveName}
              disabled={setName.isPending || !nameTouched}
              data-testid="call-name-save"
            >
              {setName.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden />
              )}
              {t('save')}
            </Button>
            {nameTouched && (
              <Button
                variant="ghost"
                onClick={() => {
                  setNameTouched(false);
                  setNameDraft(data?.call_name ?? '');
                }}
              >
                {t('cancel')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* --- The notebook -------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>{t('list.title')}</CardTitle>
          <CardDescription>
            {total > 0 ? t('list.count', { count: total, max: data?.max_entries ?? 60 }) : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t('loading')}</p>
          ) : total === 0 ? (
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <LazyStinky state="sleepy" settleTo="idle" size={96} interactive={false} label="" />
              <p className="max-w-sm text-sm leading-snug text-muted-foreground">
                {t('list.empty')}
              </p>
              <Button variant="outline" asChild>
                <Link href="/dashboard/stinky">{t('list.emptyCta')}</Link>
              </Button>
            </div>
          ) : (
            groups.map(([kind, rows]) => (
              <section key={kind} data-testid={`memory-group-${kind}`}>
                <p className="eyebrow">{t(`kinds.${kind}` as never)}</p>
                <ul className="mt-2 space-y-2">
                  {rows.map((memory) => (
                    <MemoryRow
                      key={memory.id}
                      memory={memory}
                      maxChars={data?.max_text_chars ?? 200}
                      onSaved={() => toast.success(t('saved'))}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </CardContent>
      </Card>

      {/* --- Borrar todo ---------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>{t('clear.title')}</CardTitle>
          <CardDescription>{t('clear.body')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            className={cn('text-destructive hover:text-destructive')}
            onClick={() => setConfirmClear(true)}
            disabled={clearAll.isPending || (total === 0 && !data?.call_name)}
            data-testid="memory-clear-all"
          >
            <Trash2 className="h-4 w-4" strokeWidth={2} aria-hidden />
            {t('clear.cta')}
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('clear.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('clear.confirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <X className="h-4 w-4" strokeWidth={2} aria-hidden />
              {t('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmClear(false);
                clearAll.mutate(undefined, {
                  onSuccess: () => toast.success(t('clear.done')),
                  onError: () => toast.error(t('deleteError')),
                });
              }}
              data-testid="confirm-clear-all"
            >
              {t('clear.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
