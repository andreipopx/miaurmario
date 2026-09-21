import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, setAccessToken } from '@/lib/api';
import {
  applyStreamEvent,
  createSSEParser,
  splitBold,
  streamChat,
  type ChatMessage,
  type ChatStreamEvent,
} from '@/lib/stinky-chat';

function collect(chunks: string[]) {
  const events: ChatStreamEvent[] = [];
  const parser = createSSEParser((e) => events.push(e));
  for (const c of chunks) parser.push(c);
  parser.end();
  return events;
}

const STREAM =
  ': stinky\n\n' +
  'event: meta\ndata: {"conversation_id":"c1","title":"Hola"}\n\n' +
  'event: status\ndata: {"phase":"thinking"}\n\n' +
  ': ping\n\n' +
  'event: delta\ndata: {"text":"Miau, "}\n\n' +
  'event: delta\ndata: {"text":"¡qué look!"}\n\n' +
  'event: outfit\ndata: {"card":{"kind":"created","outfit_id":"o1","name":"Lunes","occasion":"office","scheduled_for":null,"items":[]}}\n\n' +
  'event: done\ndata: {"message_id":"m1","outfit_created":true}\n\n';

describe('createSSEParser', () => {
  it('parses a whole stream, skipping comments and keep-alives', () => {
    const events = collect([STREAM]);
    expect(events.map((e) => e.event)).toEqual(['meta', 'status', 'delta', 'delta', 'outfit', 'done']);
    expect(events[2]).toEqual({ event: 'delta', data: { text: 'Miau, ' } });
  });

  it('handles chunks split at arbitrary positions (incl. inside multi-byte text)', () => {
    const whole = collect([STREAM]);
    for (const size of [1, 2, 3, 7, 13]) {
      const chunks: string[] = [];
      for (let i = 0; i < STREAM.length; i += size) chunks.push(STREAM.slice(i, i + size));
      expect(collect(chunks)).toEqual(whole);
    }
  });

  it('accepts CRLF line endings and a final event without a blank line', () => {
    const crlf = 'event: delta\r\ndata: {"text":"a"}\r\n\r\nevent: done\r\ndata: {"message_id":"m","outfit_created":false}';
    const events = collect([crlf.slice(0, 20), crlf.slice(20)]);
    expect(events.map((e) => e.event)).toEqual(['delta', 'done']);
  });

  it('ignores unknown events, reasoning-like events and malformed JSON', () => {
    const events = collect([
      'event: reasoning\ndata: {"text":"secret"}\n\n',
      'event: delta\ndata: {not json\n\n',
      'data: {"text":"no event name"}\n\n',
      'event: delta\ndata: {"text":"ok"}\n\n',
    ]);
    expect(events).toEqual([{ event: 'delta', data: { text: 'ok' } }]);
  });

  it('joins multi-line data fields', () => {
    const events = collect(['event: delta\ndata: {"text":\ndata: "x"}\n\n']);
    expect(events).toEqual([{ event: 'delta', data: { text: 'x' } }]);
  });
});

describe('applyStreamEvent', () => {
  const base: ChatMessage = { id: 'local', role: 'assistant', content: '', cards: [], streaming: true };

  it('accumulates text, cards and the final id', () => {
    let msg = base;
    for (const e of collect([STREAM])) msg = applyStreamEvent(msg, e);
    expect(msg.content).toBe('Miau, ¡qué look!');
    expect(msg.cards).toHaveLength(1);
    expect(msg.id).toBe('m1');
    expect(msg.streaming).toBe(false);
  });

  it('marks errors', () => {
    const msg = applyStreamEvent(base, { event: 'error', data: { code: 'provider_error', message: 'x' } });
    expect(msg.error).toBe(true);
    expect(msg.streaming).toBe(false);
  });
});

describe('splitBold', () => {
  it('splits **bold** segments', () => {
    expect(splitBold('Usa tu **blazer negro** hoy')).toEqual([
      { text: 'Usa tu ', bold: false },
      { text: 'blazer negro', bold: true },
      { text: ' hoy', bold: false },
    ]);
    expect(splitBold('sin negrita')).toEqual([{ text: 'sin negrita', bold: false }]);
  });
});

describe('streamChat', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setAccessToken(null);
  });

  function streamBody(chunks: string[]) {
    const enc = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(enc.encode(c));
        controller.close();
      },
    });
  }

  it('posts the message with the bearer token and dispatches events', async () => {
    setAccessToken('tok');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(streamBody([STREAM.slice(0, 50), STREAM.slice(50)]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const events: ChatStreamEvent[] = [];
    await streamChat({ message: 'hola', conversationId: 'c1', locale: 'en', onEvent: (e) => events.push(e) });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/stinky/chat');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({ message: 'hola', conversation_id: 'c1', locale: 'en' });
    expect(events.map((e) => e.event)).toEqual(['meta', 'status', 'delta', 'delta', 'outfit', 'done']);
  });

  it('throws an ApiError carrying the AI access code on 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: { code: 'ai_not_enabled', message: 'no' } }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    const err = await streamChat({ message: 'hola', onEvent: () => {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(err.data.detail.code).toBe('ai_not_enabled');
  });
});
