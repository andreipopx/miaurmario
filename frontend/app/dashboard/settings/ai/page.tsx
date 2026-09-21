'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  ShieldCheck,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  applyPreset,
  type AICheckResult,
  type AITestResponse,
  type ByokFormState,
  DEEPSEEK_KEY_URL,
  formFromStatus,
  getApiErrorCode,
  getPreset,
  PROVIDER_PRESETS,
  toByokPayload,
  validateByokForm,
} from '@/lib/ai-access';
import { getErrorMessage } from '@/lib/api';
import {
  useAIStatus,
  useDeleteByok,
  useSaveByok,
  useTestByok,
} from '@/lib/hooks/use-ai-access';

function CheckLine({ label, result }: { label: string; result: AICheckResult }) {
  const t = useTranslations('aiAccess.test');
  return (
    <div className="flex items-start gap-2 text-sm">
      {result.ok ? (
        <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
      ) : (
        <XCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
      )}
      <div className="min-w-0">
        <p className="font-medium">
          {label}
          {result.model ? (
            <span className="text-muted-foreground font-normal"> · {result.model}</span>
          ) : null}
        </p>
        <p className="text-muted-foreground break-words">
          {result.ok
            ? t('okLatency', { ms: result.latency_ms ?? 0 })
            : result.error || t('failed')}
        </p>
      </div>
    </div>
  );
}

export default function AISettingsPage() {
  const t = useTranslations('aiAccess');
  const { data: status, isLoading } = useAIStatus();
  const saveByok = useSaveByok();
  const deleteByok = useDeleteByok();
  const testByok = useTestByok();

  const [form, setForm] = useState<ByokFormState>(() => formFromStatus(undefined));
  const [formError, setFormError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<AITestResponse | null>(null);

  useEffect(() => {
    if (status) setForm(formFromStatus(status));
  }, [status]);

  const hasSavedKey = Boolean(status?.byok_configured);
  const preset = getPreset(form.provider);

  const update = (patch: Partial<ByokFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setFormError(null);
    setTestResult(null);
  };

  const handleSave = async () => {
    const err = validateByokForm(form, hasSavedKey);
    if (err) {
      setFormError(t(`form.errors.${err}`));
      return;
    }
    try {
      await saveByok.mutateAsync(toByokPayload(form));
      setForm((prev) => ({ ...prev, apiKey: '' }));
      toast.success(t('form.saved'));
    } catch (e) {
      const code = getApiErrorCode(e);
      setFormError(code && t.has(`apiErrors.${code}`) ? t(`apiErrors.${code}`) : getErrorMessage(e, t('form.saveError')));
    }
  };

  const handleTest = async () => {
    const err = validateByokForm(form, hasSavedKey);
    if (err) {
      setFormError(t(`form.errors.${err}`));
      return;
    }
    setTestResult(null);
    try {
      const payload = toByokPayload(form);
      const result = await testByok.mutateAsync({
        ...payload,
        // Empty = use the saved key server-side.
        api_key: payload.api_key ?? undefined,
        vision_model: payload.vision_model ?? '',
        text_model: payload.text_model ?? '',
      });
      setTestResult(result);
    } catch (e) {
      setTestResult({
        ok: false,
        text: null,
        vision: null,
        error: getErrorMessage(e, t('test.failed')),
        error_code: null,
      });
    }
  };

  const handleRemove = async () => {
    try {
      await deleteByok.mutateAsync();
      setTestResult(null);
      toast.success(t('form.removed'));
    } catch (e) {
      toast.error(getErrorMessage(e, t('form.saveError')));
    }
  };

  const accessLabel = status ? t(`access.${status.access}`) : '';

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-10 py-8 sm:py-12 space-y-6">
      <header className="space-y-2">
        <Link
          href="/dashboard/settings"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          {t('backToSettings')}
        </Link>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Sparkles className="h-7 w-7 text-primary" />
          {t('title')}
        </h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </header>

      {/* Current access */}
      <Card>
        <CardHeader>
          <CardTitle>{t('current.title')}</CardTitle>
          <CardDescription>{t('current.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading || !status ? (
            <Skeleton className="h-8 w-48" />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={status.access === 'none' ? 'outline' : 'default'}>
                  {accessLabel}
                </Badge>
                {status.access !== 'none' && (
                  <span className="text-sm text-muted-foreground">
                    {t('current.capabilities', {
                      vision: status.capabilities.vision ? t('yes') : t('no'),
                      text: status.capabilities.text ? t('yes') : t('no'),
                    })}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{t(`current.explain.${status.access}`)}</p>
              {status.blocked_reason && t.has(`apiErrors.${status.blocked_reason}`) && (
                <p className="text-sm text-destructive">{t(`apiErrors.${status.blocked_reason}`)}</p>
              )}
              {status.access !== 'none' && (
                <p className="text-sm text-muted-foreground">
                  {status.monthly_request_cap != null && status.access === 'platform'
                    ? t('current.usageWithCap', {
                        requests: status.usage.requests,
                        cap: status.monthly_request_cap,
                        tokens: status.usage.tokens,
                      })
                    : t('current.usage', {
                        requests: status.usage.requests,
                        tokens: status.usage.tokens,
                      })}
                </p>
              )}
              {!status.server_ai_enabled && (
                <p className="text-sm text-muted-foreground">{t('current.serverDisabled')}</p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* What AI does */}
      <Card>
        <CardHeader>
          <CardTitle>{t('explainer.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ul className="list-disc pl-5 space-y-1">
            <li>{t('explainer.tagging')}</li>
            <li>{t('explainer.suggest')}</li>
            <li>{t('explainer.pairings')}</li>
          </ul>
          <p>{t('explainer.withoutAi')}</p>
          <p className="flex items-start gap-2">
            <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
            <span>{t('explainer.privacy')}</span>
          </p>
        </CardContent>
      </Card>

      {/* Bring your own key */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            {t('form.title')}
          </CardTitle>
          <CardDescription>
            {t('form.description')}{' '}
            <a
              href={DEEPSEEK_KEY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
            >
              {t('form.getDeepseekKey')}
              <ExternalLink className="h-3 w-3" />
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status && !status.encryption_available && (
            <p className="text-sm text-destructive">{t('apiErrors.ai_encryption_unavailable')}</p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ai-provider">{t('form.provider')}</Label>
              <Select value={preset.id} onValueChange={(v) => update(applyPreset(form, v))}>
                <SelectTrigger id="ai-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_PRESETS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.id === 'custom' ? t('form.custom') : p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai-base-url">{t('form.baseUrl')}</Label>
              <Input
                id="ai-base-url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={form.baseUrl}
                onChange={(e) => update({ baseUrl: e.target.value })}
                placeholder="https://api.example.com/v1"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-key">{t('form.apiKey')}</Label>
            <Input
              id="ai-key"
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              value={form.apiKey}
              onChange={(e) => update({ apiKey: e.target.value })}
              placeholder={
                hasSavedKey && status?.byok?.key_last4
                  ? t('form.keySavedPlaceholder', { last4: status.byok.key_last4 })
                  : t('form.keyPlaceholder')
              }
            />
            <p className="text-xs text-muted-foreground">
              {hasSavedKey ? t('form.keyHintSaved') : t('form.keyHint')}
              {preset.keyUrl && preset.id !== 'deepseek' && (
                <>
                  {' '}
                  <a
                    href={preset.keyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {t('form.getKeyFrom', { provider: preset.label })}
                  </a>
                </>
              )}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ai-vision-model">{t('form.visionModel')}</Label>
              <Input
                id="ai-vision-model"
                autoComplete="off"
                spellCheck={false}
                value={form.visionModel}
                onChange={(e) => update({ visionModel: e.target.value })}
                placeholder={t('form.optional')}
              />
              <p className="text-xs text-muted-foreground">{t('form.visionHint')}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai-text-model">{t('form.textModel')}</Label>
              <Input
                id="ai-text-model"
                autoComplete="off"
                spellCheck={false}
                value={form.textModel}
                onChange={(e) => update({ textModel: e.target.value })}
                placeholder={t('form.optional')}
              />
              <p className="text-xs text-muted-foreground">{t('form.textHint')}</p>
            </div>
          </div>

          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}

          {testResult && (
            <div className="rounded-md border border-border p-3 space-y-2" aria-live="polite">
              <p className="text-sm font-medium">
                {testResult.ok ? t('test.allOk') : t('test.someFailed')}
              </p>
              {testResult.error && (
                <p className="text-sm text-destructive">{testResult.error}</p>
              )}
              {testResult.text && <CheckLine label={t('test.text')} result={testResult.text} />}
              {testResult.vision && (
                <CheckLine label={t('test.vision')} result={testResult.vision} />
              )}
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            {hasSavedKey ? (
              <Button
                variant="ghost"
                onClick={handleRemove}
                disabled={deleteByok.isPending}
                className="text-destructive"
              >
                {deleteByok.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                {t('form.remove')}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" onClick={handleTest} disabled={testByok.isPending}>
                {testByok.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {t('form.test')}
              </Button>
              <Button
                onClick={handleSave}
                disabled={saveByok.isPending || (status && !status.encryption_available)}
              >
                {saveByok.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {hasSavedKey ? t('form.update') : t('form.save')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {status?.is_admin && (
        <Card>
          <CardHeader>
            <CardTitle>{t('adminCard.title')}</CardTitle>
            <CardDescription>{t('adminCard.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" asChild>
              <Link href="/dashboard/admin">{t('adminCard.cta')}</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
