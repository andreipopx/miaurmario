import { describe, expect, it } from 'vitest';

import {
  applyPreset,
  emptyByokForm,
  formFromStatus,
  getAiAccessErrorCode,
  getApiErrorCode,
  getPreset,
  toByokPayload,
  validateByokForm,
  type AIStatus,
} from '@/lib/ai-access';
import { ApiError } from '@/lib/api';

const baseStatus: AIStatus = {
  access: 'byok',
  stored_access: 'byok',
  is_admin: false,
  byok_configured: true,
  byok: {
    provider: 'openai',
    base_url: 'https://api.openai.com/v1',
    vision_model: 'gpt-4o',
    text_model: 'gpt-4o-mini',
    key_last4: 'abcd',
    updated_at: null,
  },
  capabilities: { vision: true, text: true },
  blocked_reason: null,
  monthly_request_cap: null,
  usage: { month: '2026-09', requests: 0, tokens: 0, last_used_at: null },
  encryption_available: true,
  server_ai_enabled: true,
};

describe('provider presets', () => {
  it('defaults to DeepSeek with deepseek-flash for both models', () => {
    const form = emptyByokForm();
    expect(form.provider).toBe('deepseek');
    expect(form.baseUrl).toBe('https://api.deepseek.com');
    expect(form.visionModel).toBe('deepseek-flash');
    expect(form.textModel).toBe('deepseek-flash');
    expect(form.apiKey).toBe('');
  });

  it('applying a preset fills url and models but keeps the typed key', () => {
    const form = { ...emptyByokForm(), apiKey: 'sk-typed' };
    const next = applyPreset(form, 'openai');
    expect(next).toMatchObject({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      visionModel: 'gpt-4o',
      textModel: 'gpt-4o-mini',
      apiKey: 'sk-typed',
    });
  });

  it('custom keeps whatever the user already typed', () => {
    const form = { ...emptyByokForm(), baseUrl: 'https://my.proxy/v1', textModel: 'x' };
    const next = applyPreset(form, 'custom');
    expect(next.provider).toBe('custom');
    expect(next.baseUrl).toBe('https://my.proxy/v1');
    expect(next.textModel).toBe('x');
  });

  it('unknown preset ids fall back to custom', () => {
    expect(getPreset('nope').id).toBe('custom');
    expect(getPreset(undefined).id).toBe('custom');
  });
});

describe('form <-> status', () => {
  it('never pre-fills the key from the saved status', () => {
    const form = formFromStatus(baseStatus);
    expect(form.apiKey).toBe('');
    expect(form.provider).toBe('openai');
    expect(form.textModel).toBe('gpt-4o-mini');
  });

  it('no saved config gives the default form', () => {
    expect(formFromStatus({ ...baseStatus, byok: null })).toEqual(emptyByokForm());
  });
});

describe('validateByokForm', () => {
  const valid = { ...emptyByokForm(), apiKey: 'sk-123456789' };

  it('accepts a complete https form', () => {
    expect(validateByokForm(valid, false)).toBeNull();
  });

  it('requires https', () => {
    expect(validateByokForm({ ...valid, baseUrl: 'http://api.deepseek.com' }, false)).toBe(
      'httpsRequired'
    );
  });

  it('rejects garbage and empty urls', () => {
    expect(validateByokForm({ ...valid, baseUrl: 'not a url' }, false)).toBe('invalidUrl');
    expect(validateByokForm({ ...valid, baseUrl: '  ' }, false)).toBe('baseUrlRequired');
  });

  it('needs a key only when none is saved', () => {
    const noKey = { ...valid, apiKey: '' };
    expect(validateByokForm(noKey, false)).toBe('keyRequired');
    expect(validateByokForm(noKey, true)).toBeNull();
  });

  it('needs at least one model', () => {
    expect(validateByokForm({ ...valid, visionModel: '', textModel: ' ' }, false)).toBe(
      'modelRequired'
    );
    expect(validateByokForm({ ...valid, visionModel: '' }, false)).toBeNull();
  });
});

describe('toByokPayload', () => {
  it('sends null for an empty key so the saved one is kept', () => {
    const payload = toByokPayload({ ...emptyByokForm(), apiKey: '   ' });
    expect(payload.api_key).toBeNull();
  });

  it('trims values and nulls empty models', () => {
    const payload = toByokPayload({
      provider: 'custom',
      baseUrl: ' https://x.test/v1 ',
      apiKey: ' sk-1 ',
      visionModel: '',
      textModel: ' m ',
    });
    expect(payload).toEqual({
      provider: 'custom',
      base_url: 'https://x.test/v1',
      api_key: 'sk-1',
      vision_model: null,
      text_model: 'm',
    });
  });
});

describe('error codes', () => {
  it('extracts codes from structured API errors', () => {
    const err = new ApiError('nope', 403, {
      detail: { code: 'ai_not_enabled', message: 'nope' },
    });
    expect(getApiErrorCode(err)).toBe('ai_not_enabled');
    expect(getAiAccessErrorCode(err)).toBe('ai_not_enabled');
  });

  it('ignores non-AI codes and plain errors', () => {
    const other = new ApiError('x', 400, { detail: { code: 'ai_url_https_required' } });
    expect(getApiErrorCode(other)).toBe('ai_url_https_required');
    expect(getAiAccessErrorCode(other)).toBeNull();
    expect(getAiAccessErrorCode(new ApiError('x', 503, { detail: 'down' }))).toBeNull();
    expect(getAiAccessErrorCode(new Error('x'))).toBeNull();
  });

  it('recognises quota errors', () => {
    const err = new ApiError('x', 429, { detail: { code: 'ai_quota_exceeded' } });
    expect(getAiAccessErrorCode(err)).toBe('ai_quota_exceeded');
  });
});
