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
import { PageHeader } from '@/components/page-header';
import { StinkyTip } from '@/components/stinky-tip';
import { Stinky } from '@/components/stinky/stinky';
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
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
      ) : (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
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
    <div className="mx-auto max-w-3xl space-y-6 py-2 sm:py-4">
      <Button variant="ghost" asChild className="-ml-3 text-muted-foreground hover:text-foreground">
        <Link href="/dashboard/settings">{t('backToSettings')}</Link>
      </Button>

      <PageHeader title={t('title')} description={t('subtitle')} />

      {/* Current access */}
      <Card className="border-0 bg-panel">
        <CardContent className="flex items-start gap-4 p-5 sm:p-6">
          <div
            aria-hidden
            className="hidden h-20 w-20 shrink-0 items-center justify-center rounded-full bg-signature-soft sm:flex"
          >
            <Stinky
              state={status?.access === 'none' ? 'sleepy' : 'happy'}
              size={68}
              label=""
            />
          </div>
          <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <p className="eyebrow">{t('current.title')}</p>
            <p className="text-sm text-muted-foreground">{t('current.description')}</p>
          </div>
          {isLoading || !status ? (
            <Skeleton className="h-8 w-48 rounded-full" />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={status.access === 'none' ? 'secondary' : 'signature'}>
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
          </div>
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
          <StinkyTip className="bg-panel text-foreground">
            <ShieldCheck className="mr-1 inline h-4 w-4 align-[-3px]" strokeWidth={1.75} aria-hidden />
            {t('explainer.privacy')}
          </StinkyTip>
        </CardContent>
      </Card>

      {/* Bring your own key */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" strokeWidth={1.75} aria-hidden />
            {t('form.title')}
          </CardTitle>
          <CardDescription>
            {t('form.description')}{' '}
            <a
              href={DEEPSEEK_KEY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-foreground underline underline-offset-4"
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                    className="font-semibold text-foreground underline underline-offset-4"
                  >
                    {t('form.getKeyFrom', { provider: preset.label })}
                  </a>
                </>
              )}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            <div className="space-y-2 rounded-lg bg-panel p-4" aria-live="polite">
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
                className="text-destructive hover:text-destructive"
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
              <Button variant="secondary" onClick={handleTest} disabled={testByok.isPending}>
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
            <Button variant="signature" asChild>
              <Link href="/dashboard/admin">{t('adminCard.cta')}</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
