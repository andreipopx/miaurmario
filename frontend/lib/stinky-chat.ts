// "Habla con Stinky": types, the Server-Sent Events parser and the streaming client.
// Pure helpers live here so they can be unit-tested without React.

import { ApiError, NetworkError, getAccessToken } from '@/lib/api';

export interface ChatCardItem {
  id: string;
  name: string | null;
  type: string | null;
  thumbnail_url: string | null;
  image_url: string | null;
}

export interface ChatOutfitCard {
  kind: 'created' | 'proposed';
  outfit_id: string | null;
  name: string | null;
  occasion: string | null;
  scheduled_for: string | null;
  items: ChatCardItem[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  cards: ChatOutfitCard[];
  created_at?: string;
  /** Client-only: the reply is still streaming. */
  streaming?: boolean;
  /** Client-only: the turn ended with an error. */
  error?: boolean;
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface ConversationDetail {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  messages: ChatMessage[];
}

export type ChatStreamEvent =
  | { event: 'meta'; data: { conversation_id: string; title: string | null } }
  | { event: 'status'; data: { phase: 'thinking' | 'tool'; tool?: string } }
  | { event: 'delta'; data: { text: string } }
  | { event: 'outfit'; data: { card: ChatOutfitCard } }
  | {
      event: 'done';
      data: { message_id: string; outfit_created: boolean; tool_rounds?: number; tokens?: number };
    }
  | { event: 'error'; data: { code: string; message: string } };

export const MAX_MESSAGE_CHARS = 1000;

const KNOWN_EVENTS = new Set(['meta', 'status', 'delta', 'outfit', 'done', 'error']);

/**
 * Incremental SSE parser. Feed it arbitrary text chunks (they may split lines or
 * events anywhere); it calls `onEvent` for every complete, known event with JSON data.
 * Comment lines (": ping") and unknown events are ignored.
 */
export function createSSEParser(onEvent: (event: ChatStreamEvent) => void) {
  let buffer = '';
  let eventName = 'message';
  let dataLines: string[] = [];

  const dispatch = () => {
    if (dataLines.length > 0 && KNOWN_EVENTS.has(eventName)) {
      const raw = dataLines.join('\n');
      try {
        onEvent({ event: eventName, data: JSON.parse(raw) } as ChatStreamEvent);
      } catch {
        // malformed JSON: skip the event
      }
    }
    eventName = 'message';
    dataLines = [];
  };

  const processLine = (line: string) => {
    if (line === '') {
      dispatch();
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') eventName = value;
    else if (field === 'data') dataLines.push(value);
  };

  return {
    push(chunk: string) {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.search(/\r\n|\r|\n/)) !== -1) {
        const line = buffer.slice(0, idx);
        const sepLen = buffer.startsWith('\r\n', idx) ? 2 : 1;
        // A lone '\r' at the very end may be the first half of '\r\n': wait for more.
        if (buffer[idx] === '\r' && idx === buffer.length - 1) break;
        buffer = buffer.slice(idx + sepLen);
        processLine(line);
      }
    },
    /** Flush a trailing event that was not terminated by a blank line. */
    end() {
      if (buffer) {
        processLine(buffer);
        buffer = '';
      }
      dispatch();
    },
  };
}

export interface StreamChatOptions {
  message: string;
  conversationId?: string | null;
  locale?: string;
  signal?: AbortSignal;
  onEvent: (event: ChatStreamEvent) => void;
}

/** POST /api/v1/stinky/chat and dispatch the streamed events. Throws ApiError on HTTP errors. */
export async function streamChat({
  message,
  conversationId,
  locale,
  signal,
  onEvent,
}: StreamChatOptions): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch('/api/v1/stinky/chat', {
      method: 'POST',
      headers,
      credentials: 'include',
      signal,
      body: JSON.stringify({
        message,
        conversation_id: conversationId || null,
        locale: locale === 'en' ? 'en' : 'es',
      }),
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new NetworkError();
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const detail = (data as { detail?: unknown }).detail;
    const msg =
      typeof detail === 'string'
        ? detail
        : (detail as { message?: string } | undefined)?.message || 'An error occurred';
    throw new ApiError(msg, response.status, data);
  }

  const parser = createSSEParser(onEvent);
  if (!response.body) {
    parser.push(await response.text());
    parser.end();
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.end();
}

/** Split "**bold**" markup into segments (the only markdown Stinky is allowed to use). */
export function splitBold(text: string): { text: string; bold: boolean }[] {
  const out: { text: string; bold: boolean }[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false });
  return out;
}

/** Apply one stream event to the in-progress assistant message (pure). */
export function applyStreamEvent(message: ChatMessage, event: ChatStreamEvent): ChatMessage {
  switch (event.event) {
    case 'delta':
      return { ...message, content: message.content + event.data.text };
    case 'outfit':
      return { ...message, cards: [...message.cards, event.data.card] };
    case 'done':
      return { ...message, id: event.data.message_id || message.id, streaming: false };
    case 'error':
      return {
        ...message,
        streaming: false,
        error: true,
      };
    default:
      return message;
  }
}
