// Per-user AI access (free plan / admin grant / bring-your-own-key).
// Pure helpers live here so they can be unit-tested without React.

import { getApiErrorCode } from '@/lib/api';

export type AIAccess = 'none' | 'platform' | 'byok';

export interface AIStatus {
  access: AIAccess;
  stored_access: AIAccess;
  is_admin: boolean;
  byok_configured: boolean;
  byok: {
    provider: string | null;
    base_url: string | null;
    vision_model: string | null;
    text_model: string | null;
    key_last4: string | null;
    updated_at: string | null;
  } | null;
  capabilities: { vision: boolean; text: boolean };
  blocked_reason: string | null;
  monthly_request_cap: number | null;
  usage: { month: string; requests: number; tokens: number; last_used_at: string | null };
  encryption_available: boolean;
  server_ai_enabled: boolean;
}

export interface ByokPayload {
  provider: string;
  base_url: string;
  api_key?: string | null;
  vision_model: string | null;
  text_model: string | null;
}

export interface AICheckResult {
  ok: boolean;
  model: string | null;
  latency_ms: number | null;
  error: string | null;
  error_code: string | null;
}

export interface AITestResponse {
  ok: boolean;
  text: AICheckResult | null;
  vision: AICheckResult | null;
  error: string | null;
  error_code: string | null;
}

export interface AdminUser {
  id: string;
  username: string | null;
  email: string;
  display_name: string;
  created_at: string;
  last_login_at: string | null;
  is_active: boolean;
  is_admin: boolean;
  item_count: number;
  ai_access: AIAccess;
  effective_ai_access: AIAccess;
  byok_configured: boolean;
  monthly_request_cap: number | null;
  requests_this_month: number;
  tokens_this_month: number;
  last_ai_used_at: string | null;
}

export interface ProviderPreset {
  id: 'deepseek' | 'openai' | 'openrouter' | 'groq' | 'custom';
  label: string;
  baseUrl: string;
  visionModel: string;
  textModel: string;
  keyUrl: string | null;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    visionModel: 'deepseek-flash',
    textModel: 'deepseek-flash',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    visionModel: 'gpt-4o',
    textModel: 'gpt-4o-mini',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    visionModel: 'openai/gpt-4o-mini',
    textModel: 'openai/gpt-4o-mini',
    keyUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    visionModel: 'meta-llama/llama-4-scout-17b-16e-instruct',
    textModel: 'llama-3.3-70b-versatile',
    keyUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'custom',
    label: 'Custom',
    baseUrl: '',
    visionModel: '',
    textModel: '',
    keyUrl: null,
  },
];

export const DEEPSEEK_KEY_URL = 'https://platform.deepseek.com/api_keys';

export function getPreset(id: string | null | undefined): ProviderPreset {
  return PROVIDER_PRESETS.find((p) => p.id === id) ?? PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1];
}

export interface ByokFormState {
  provider: string;
  baseUrl: string;
  apiKey: string;
  visionModel: string;
  textModel: string;
}

export function emptyByokForm(): ByokFormState {
  const preset = PROVIDER_PRESETS[0];
  return {
    provider: preset.id,
    baseUrl: preset.baseUrl,
    apiKey: '',
    visionModel: preset.visionModel,
    textModel: preset.textModel,
  };
}

/** Form state from the saved status (the key is never returned, so it stays empty). */
export function formFromStatus(status: AIStatus | undefined): ByokFormState {
  if (!status?.byok) return emptyByokForm();
  return {
    provider: status.byok.provider || 'custom',
    baseUrl: status.byok.base_url || '',
    apiKey: '',
    visionModel: status.byok.vision_model || '',
    textModel: status.byok.text_model || '',
  };
}

/** Switching provider fills URL + models from the preset (custom keeps what's typed). */
export function applyPreset(form: ByokFormState, presetId: string): ByokFormState {
  const preset = getPreset(presetId);
  if (preset.id === 'custom') return { ...form, provider: 'custom' };
  return {
    ...form,
    provider: preset.id,
    baseUrl: preset.baseUrl,
    visionModel: preset.visionModel,
    textModel: preset.textModel,
  };
}

export type ByokValidationError =
  | 'baseUrlRequired'
  | 'httpsRequired'
  | 'invalidUrl'
  | 'keyRequired'
  | 'modelRequired';

export function validateByokForm(
  form: ByokFormState,
  hasSavedKey: boolean
): ByokValidationError | null {
  const url = form.baseUrl.trim();
  if (!url) return 'baseUrlRequired';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'invalidUrl';
  }
  if (parsed.protocol !== 'https:') return 'httpsRequired';
  if (!form.apiKey.trim() && !hasSavedKey) return 'keyRequired';
  if (!form.visionModel.trim() && !form.textModel.trim()) return 'modelRequired';
  return null;
}

/** Payload for PUT /users/me/ai. An empty key field keeps the stored key. */
export function toByokPayload(form: ByokFormState): ByokPayload {
  const key = form.apiKey.trim();
  return {
    provider: form.provider || 'custom',
    base_url: form.baseUrl.trim(),
    api_key: key ? key : null,
    vision_model: form.visionModel.trim() || null,
    text_model: form.textModel.trim() || null,
  };
}

const AI_ERROR_CODES = new Set([
  'ai_not_enabled',
  'ai_quota_exceeded',
  'ai_capability_unavailable',
  'ai_key_unreadable',
  'ai_provider_blocked',
]);

export { getApiErrorCode };

/** The code if this error means "this user can't use AI right now". */
export function getAiAccessErrorCode(err: unknown): string | null {
  const code = getApiErrorCode(err);
  return code && AI_ERROR_CODES.has(code) ? code : null;
}
