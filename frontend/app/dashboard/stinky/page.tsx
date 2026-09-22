'use client';

import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowUp, History, Loader2, SquarePen, Square } from 'lucide-react';

import { Stinky } from '@/components/stinky/stinky';
import { StinkyAvatar } from '@/components/brand/stinky-avatar';
import { AIUnavailableNotice } from '@/components/ai/ai-unavailable-notice';
import { ChatOutfitCardView, cardKey } from '@/components/stinky-chat/chat-outfit-card';
import { ConversationSheet } from '@/components/stinky-chat/conversation-sheet';
import { POP_BG, popColorAt } from '@/components/chip';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, NetworkError } from '@/lib/api';
import { getAiAccessErrorCode } from '@/lib/ai-access';
import { useAIStatus } from '@/lib/hooks/use-ai-access';
import {
  STINKY_CONVERSATIONS_KEY,
  useSaveStinkyOutfit,
  useStinkyConversation,
} from '@/lib/hooks/use-stinky-chat';
import {
  MAX_MESSAGE_CHARS,
  applyStreamEvent,
  splitBold,
  streamChat,
  type ChatMessage,
  type ChatOutfitCard,
} from '@/lib/stinky-chat';
import { cn } from '@/lib/utils';
import { useKeyboard } from '@/lib/native/keyboard';

type Mood = 'idle' | 'thinking' | 'happy';

const TOOL_KEYS = new Set([
  'get_wardrobe',
  'get_weather',
  'get_recent_outfits',
  'get_listening_mood',
  'get_user_preferences',
  'show_outfit',
  'create_outfit',
  'suggest_outfit',
]);

let localIdSeq = 0;
const localId = (prefix: string) => `${prefix}-${Date.now()}-${++localIdSeq}`;

// -- Pieces ---------------------------------------------------------------------------

function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i, lines) => (
        <span key={i}>
          {splitBold(line).map((seg, j) =>
            seg.bold ? (
              <strong key={j} className="font-bold">
                {seg.text}
              </strong>
            ) : (
              <span key={j}>{seg.text}</span>
            )
          )}
          {i < lines.length - 1 && <br />}
        </span>
      ))}
    </>
  );
}

function TypingDots({ label }: { label: string | null }) {
  return (
    <span className="inline-flex items-center gap-2 text-muted-foreground">
      <span aria-hidden className="inline-flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-current motion-reduce:animate-none"
            style={{ animationDelay: `${i * 140}ms` }}
          />
        ))}
      </span>
      {label && <span className="text-[13px]">{label}</span>}
    </span>
  );
}

function Bubble({
  message,
  statusLabel,
  savingKey,
  onSaveCard,
}: {
  message: ChatMessage;
  statusLabel: string | null;
  savingKey: string | null;
  onSaveCard: (message: ChatMessage, card: ChatOutfitCard, index: number) => void;
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-[22px] rounded-br-lg bg-primary px-4 py-2.5 text-[15px] leading-snug text-primary-foreground">
          {message.content}
        </p>
      </div>
    );
  }
  const empty = !message.content && message.cards.length === 0;
  return (
    <div className="flex items-end gap-2">
      <StinkyAvatar size={30} className="mb-0.5 bg-signature-soft" />
      <div className="flex min-w-0 max-w-[85%] flex-col items-start">
        {(message.content || empty) && (
          <div
            className={cn(
              'break-words [overflow-wrap:anywhere] rounded-[22px] rounded-bl-lg bg-panel px-4 py-2.5 text-[15px] leading-snug',
              message.error && 'text-muted-foreground'
            )}
          >
            {empty && message.streaming ? <TypingDots label={statusLabel} /> : <RichText text={message.content} />}
          </div>
        )}
        {message.cards.map((card, i) => (
          <ChatOutfitCardView
            key={cardKey(card, i)}
            card={card}
            saving={savingKey === `${message.id}:${i}`}
            onSave={message.streaming ? undefined : () => onSaveCard(message, card, i)}
          />
        ))}
        {message.streaming && !empty && statusLabel && (
          <span className="mt-1 px-2 text-xs text-muted-foreground">{statusLabel}</span>
        )}
      </div>
    </div>
  );
}

// -- Page ---------------------------------------------------------------------------------

function StinkyChat() {
  const t = useTranslations('stinkyChat');
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const cParam = searchParams.get('c');

  const [conversationId, setConversationId] = useState<string | null>(cParam);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [mood, setMood] = useState<Mood>('idle');
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const loadedIdRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // iOS/Android keyboard: lift the composer onto the keyboard (the dock hides meanwhile).
  const keyboard = useKeyboard();

  const aiStatus = useAIStatus();
  const conversation = useStinkyConversation(cParam);
  const saveOutfit = useSaveStinkyOutfit();

  const aiUnavailable =
    blockedReason !== null || (aiStatus.data !== undefined && !aiStatus.data.capabilities.text);
  const unavailableReason = blockedReason ?? aiStatus.data?.blocked_reason ?? null;

  // Load a conversation from the URL (?c=...) unless we're the ones streaming into it.
  useEffect(() => {
    if (!cParam) {
      if (!streaming && loadedIdRef.current !== null) {
        loadedIdRef.current = null;
        setConversationId(null);
        setMessages([]);
      }
      return;
    }
    const data = conversation.data;
    if (!data || data.id !== cParam || loadedIdRef.current === cParam || streaming) return;
    loadedIdRef.current = cParam;
    setConversationId(cParam);
    setMessages(data.messages.map((m) => ({ ...m, cards: m.cards ?? [] })));
  }, [cParam, conversation.data, streaming]);

  useEffect(() => {
    if (conversation.isError && cParam) toast.error(t('loadError'));
  }, [conversation.isError, cParam, t]);

  // Stop streaming when leaving the page.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Keep the newest message in view (also when the keyboard opens and the room shrinks).
  useLayoutEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, statusLabel, keyboard.open]);

  const toolLabel = useCallback(
    (tool?: string) => (tool && TOOL_KEYS.has(tool) ? t(`statusTool.${tool}` as never) : t('statusTool.default')),
    [t]
  );

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || streaming || aiUnavailable) return;
      if (text.length > MAX_MESSAGE_CHARS) {
        toast.error(t('tooLong', { max: MAX_MESSAGE_CHARS }));
        return;
      }
      const userMsg: ChatMessage = { id: localId('user'), role: 'user', content: text, cards: [] };
      const botId = localId('bot');
      let currentBotId = botId;
      setMessages((ms) => [
        ...ms,
        userMsg,
        { id: botId, role: 'assistant', content: '', cards: [], streaming: true },
      ]);
      setInput('');
      setStreaming(true);
      setMood('thinking');
      setStatusLabel(t('statusThinking'));

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let outfitCreated = false;
      let failed = false;

      const patchBot = (fn: (m: ChatMessage) => ChatMessage) =>
        setMessages((ms) => ms.map((m) => (m.id === currentBotId ? fn(m) : m)));

      try {
        await streamChat({
          message: text,
          conversationId,
          locale,
          signal: ctrl.signal,
          onEvent: (ev) => {
            switch (ev.event) {
              case 'meta':
                if (ev.data.conversation_id !== conversationId) {
                  loadedIdRef.current = ev.data.conversation_id;
                  setConversationId(ev.data.conversation_id);
                  router.replace(`/dashboard/stinky?c=${ev.data.conversation_id}`, { scroll: false });
                }
                return;
              case 'status':
                setStatusLabel(ev.data.phase === 'tool' ? toolLabel(ev.data.tool) : t('statusThinking'));
                return;
              case 'delta':
                setStatusLabel(null);
                break;
              case 'outfit':
                if (ev.data.card.kind === 'created') outfitCreated = true;
                break;
              case 'done':
                outfitCreated = outfitCreated || ev.data.outfit_created;
                break;
              case 'error':
                failed = true;
                patchBot((m) => ({
                  ...m,
                  content: m.content ? m.content : ev.data.message || t('errorGeneric'),
                }));
                break;
            }
            patchBot((m) => applyStreamEvent(m, ev));
            if (ev.event === 'done' && ev.data.message_id) currentBotId = ev.data.message_id;
          },
        });
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          patchBot((m) => ({ ...m, streaming: false }));
        } else {
          failed = true;
          const code = getAiAccessErrorCode(err);
          if (code) {
            setBlockedReason(code);
            setMessages((ms) => ms.filter((m) => m.id !== botId && m.id !== userMsg.id));
            setInput(text);
          } else {
            const msg =
              err instanceof ApiError && err.status === 429
                ? t('rateLimited')
                : err instanceof NetworkError
                  ? t('offline')
                  : t('errorGeneric');
            patchBot((m) => ({ ...m, content: msg, streaming: false, error: true }));
          }
        }
      } finally {
        patchBot((m) => (m.streaming ? { ...m, streaming: false } : m));
        abortRef.current = null;
        setStreaming(false);
        setStatusLabel(null);
        setMood(outfitCreated && !failed ? 'happy' : 'idle');
        queryClient.invalidateQueries({ queryKey: STINKY_CONVERSATIONS_KEY });
        if (outfitCreated) queryClient.invalidateQueries({ queryKey: ['outfits'] });
      }
    },
    [aiUnavailable, conversationId, locale, queryClient, router, streaming, t, toolLabel]
  );

  const onSaveCard = useCallback(
    (message: ChatMessage, card: ChatOutfitCard, index: number) => {
      const key = `${message.id}:${index}`;
      setSavingKey(key);
      saveOutfit.mutate(
        {
          item_ids: card.items.map((i) => i.id),
          name: card.name,
          occasion: card.occasion,
          message_id: message.id.startsWith('bot-') ? null : message.id,
          card_index: message.id.startsWith('bot-') ? null : index,
        },
        {
          onSuccess: ({ card: saved }) => {
            setMessages((ms) =>
              ms.map((m) =>
                m.id === message.id
                  ? { ...m, cards: m.cards.map((c, i) => (i === index ? saved : c)) }
                  : m
              )
            );
            if (conversationId) queryClient.removeQueries({ queryKey: ['stinky-conversation', conversationId] });
            setMood('happy');
            toast.success(t('savedToast'));
          },
          onError: () => toast.error(t('saveError')),
          onSettled: () => setSavingKey(null),
        }
      );
    },
    [conversationId, queryClient, saveOutfit, t]
  );

  const startNew = () => {
    abortRef.current?.abort();
    loadedIdRef.current = null;
    setConversationId(null);
    setMessages([]);
    setSheetOpen(false);
    setMood('idle');
    router.replace('/dashboard/stinky', { scroll: false });
    inputRef.current?.focus();
  };

  const selectConversation = (id: string) => {
    setSheetOpen(false);
    if (id === conversationId) return;
    abortRef.current?.abort();
    loadedIdRef.current = null;
    setMessages([]);
    queryClient.removeQueries({ queryKey: ['stinky-conversation', id] });
    router.replace(`/dashboard/stinky?c=${id}`, { scroll: false });
  };

  const onDeleted = (id: string) => {
    if (id === conversationId) startNew();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  };

  // Auto-grow the textarea (up to ~5 lines).
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [input]);

  const loadingConversation = !!cParam && conversation.isLoading && messages.length === 0;
  const isEmpty = messages.length === 0 && !loadingConversation;
  const suggestions = [t('suggestion1'), t('suggestion2'), t('suggestion3'), t('suggestion4')];
  const headerStatus = streaming ? statusLabel || t('statusThinking') : t('subtitle');

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      {/* Chat header: fixed under the app header (<main> clips overflow, so sticky can't work). */}
      <div className="fixed inset-x-0 top-[calc(4rem+env(safe-area-inset-top))] z-30 bg-background/95 lg:left-64 lg:top-20">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-2 sm:px-6 lg:px-0">
          <div className="no-callout flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-signature-soft">
            <Stinky
              state={mood}
              size={52}
              interactive
              onDone={() => setMood((m) => (m === 'happy' ? 'idle' : m))}
              label={t('title')}
            />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-extrabold leading-tight tracking-tight">{t('title')}</h1>
            <p className="truncate text-[13px] text-muted-foreground" aria-live="polite">
              {headerStatus}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-label={t('history')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-panel text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <History className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          </button>
          <button
            type="button"
            onClick={startNew}
            aria-label={t('newChat')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-panel text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <SquarePen className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </div>
      <div aria-hidden className="h-[72px] shrink-0" />

      <div className="flex flex-col gap-3 pt-3" role="log" aria-live="polite" aria-relevant="additions">
        {loadingConversation && (
          <div className="space-y-3">
            <Skeleton className="ml-auto h-10 w-2/3 rounded-[22px]" />
            <Skeleton className="h-16 w-3/4 rounded-[22px]" />
          </div>
        )}

        {isEmpty && (
          <div className="flex flex-col items-center px-2 pb-2 pt-6 text-center">
            <p className="text-2xl font-extrabold tracking-tight">{t('emptyTitle')}</p>
            <p className="mt-1.5 max-w-xs text-[15px] text-muted-foreground">{t('emptyBody')}</p>
            {!aiUnavailable && (
              <div className="mt-6 flex w-full flex-col gap-2 sm:grid sm:grid-cols-2">
                {suggestions.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    disabled={streaming}
                    className="flex min-h-[48px] items-center gap-3 rounded-full border-[1.5px] border-border bg-background px-4 text-left text-[15px] font-medium transition-colors hover:bg-accent active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    <span aria-hidden className={cn('h-2.5 w-2.5 shrink-0 rounded-full', POP_BG[popColorAt(i)])} />
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((m) => (
          <Bubble
            key={m.id}
            message={m}
            statusLabel={m.streaming ? statusLabel : null}
            savingKey={savingKey}
            onSaveCard={onSaveCard}
          />
        ))}

        {aiUnavailable && (
          <AIUnavailableNotice reason={unavailableReason} feature="chat" className="mt-2" />
        )}

        {/* Room for the composer above the dock. */}
        <div
          ref={bottomRef}
          className={cn(aiUnavailable ? 'h-4' : 'h-[calc(172px+env(safe-area-inset-bottom))] lg:h-24')}
        />
      </div>

      {!aiUnavailable && (
        <div
          className={cn(
            'fixed inset-x-0 z-[45] px-4 lg:left-64',
            !keyboard.open && 'bottom-[calc(100px+env(safe-area-inset-bottom))] lg:bottom-6'
          )}
          style={keyboard.open ? { bottom: keyboard.inset + 8 } : undefined}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="mx-auto flex max-w-3xl items-end gap-2 rounded-[28px] border-[1.5px] border-border bg-background p-1.5 pl-4 shadow-[0_8px_30px_rgba(0,0,0,0.12)] focus-within:border-foreground lg:max-w-[calc(48rem)]"
          >
            <label htmlFor="stinky-input" className="sr-only">
              {t('placeholder')}
            </label>
            <textarea
              id="stinky-input"
              ref={inputRef}
              rows={1}
              value={input}
              maxLength={MAX_MESSAGE_CHARS}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t('placeholder')}
              {...({ enterKeyHint: 'send' } as Record<string, string>)}
              autoComplete="off"
              className="max-h-[132px] min-h-[40px] flex-1 resize-none bg-transparent py-2 text-base leading-6 outline-none placeholder:text-muted-foreground"
            />
            {streaming ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                aria-label={t('stop')}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                aria-label={t('send')}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:bg-panel disabled:text-muted-foreground"
              >
                <ArrowUp className="h-5 w-5" strokeWidth={2.25} aria-hidden />
              </button>
            )}
          </form>
        </div>
      )}

      <ConversationSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        activeId={conversationId}
        onSelect={selectConversation}
        onNew={startNew}
        onDeleted={onDeleted}
      />
    </div>
  );
}

export default function StinkyChatPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
        </div>
      }
    >
      <StinkyChat />
    </Suspense>
  );
}
