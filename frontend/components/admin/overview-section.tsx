'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/empty-state';
import { SectionCard, StatTile, useAdminErrorMessage } from '@/components/admin/shared';
import {
  type AdminOverview,
  type AIPricing,
  barHeights,
  formatCompact,
  formatEur,
  parseDecimal,
} from '@/lib/admin';
import { getErrorMessage } from '@/lib/api';
import { useAdminOverview, useSaveAIPricing } from '@/lib/hooks/use-admin';

function SignupsChart({ days }: { days: AdminOverview['signups_by_day'] }) {
  const t = useTranslations('admin.summary');
  const format = useFormatter();
  const heights = barHeights(days.map((d) => d.count));
  const label = (iso: string) => format.dateTime(new Date(`${iso}T12:00:00Z`), { day: 'numeric', month: 'short' });
  return (
    <figure>
      <div className="flex h-28 items-end gap-[2px]" aria-hidden>
        {days.map((d, i) => (
          <div key={d.date} className="group relative flex h-full flex-1 items-end">
            <div
              className="w-full rounded-t-[4px] bg-foreground transition-colors group-hover:bg-signature"
              style={{ height: d.count ? `${Math.max(heights[i] * 100, 6)}%` : '2px' }}
            />
            <span className="pointer-events-none absolute -top-7 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-full bg-foreground px-2 py-0.5 text-[11px] font-semibold text-background group-hover:block">
              {label(d.date)} · {d.count}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground" aria-hidden>
        <span>{label(days[0].date)}</span>
        <span>{label(days[days.length - 1].date)}</span>
      </div>
      <table className="sr-only">
        <caption>{t('signupsChart')}</caption>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <th scope="row">{label(d.date)}</th>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function PricingForm({ pricing }: { pricing: AIPricing }) {
  const t = useTranslations('admin.summary.pricing');
  const tAdmin = useTranslations('admin');
  const errorMessage = useAdminErrorMessage();
  const save = useSaveAIPricing();
  const [values, setValues] = useState({
    input: String(pricing.input_usd_per_m),
    output: String(pricing.output_usd_per_m),
    rate: String(pricing.usd_eur_rate),
    budget: pricing.monthly_budget_eur != null ? String(pricing.monthly_budget_eur) : '',
  });

  useEffect(() => {
    setValues({
      input: String(pricing.input_usd_per_m),
      output: String(pricing.output_usd_per_m),
      rate: String(pricing.usd_eur_rate),
      budget: pricing.monthly_budget_eur != null ? String(pricing.monthly_budget_eur) : '',
    });
  }, [pricing]);

  const parsed = {
    input: parseDecimal(values.input),
    output: parseDecimal(values.output),
    rate: parseDecimal(values.rate),
    budget: parseDecimal(values.budget),
  };
  const invalid =
    parsed.input == null || Number.isNaN(parsed.input) ||
    parsed.output == null || Number.isNaN(parsed.output) ||
    parsed.rate == null || Number.isNaN(parsed.rate) || parsed.rate <= 0 ||
    Number.isNaN(parsed.budget as number);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    try {
      await save.mutateAsync({
        input_usd_per_m: parsed.input as number,
        output_usd_per_m: parsed.output as number,
        usd_eur_rate: parsed.rate as number,
        monthly_budget_eur: parsed.budget,
      });
      toast.success(tAdmin('saved'));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const field = (key: keyof typeof values, label: string, hint?: string) => (
    <div className="space-y-1">
      <Label htmlFor={`pricing-${key}`} className="text-[13px]">{label}</Label>
      <Input
        id={`pricing-${key}`}
        inputMode="decimal"
        value={values[key]}
        onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
        placeholder={hint}
        className="h-11"
      />
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {field('input', t('input'))}
        {field('output', t('output'))}
        {field('rate', t('rate'))}
        {field('budget', t('budget'), t('noBudget'))}
      </div>
      <p className="text-xs text-muted-foreground">{t('hint')}</p>
      <Button type="submit" size="sm" disabled={invalid || save.isPending}>
        {t('save')}
      </Button>
    </form>
  );
}

export function OverviewSection() {
  const t = useTranslations('admin.summary');
  const locale = useLocale();
  const { data, isLoading, error } = useAdminOverview(true);

  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-quick" />
          ))}
        </div>
        <Skeleton className="h-48 rounded-lg" />
      </div>
    );
  }
  if (error || !data) {
    return <EmptyState state="sad" title={getErrorMessage(error, t('loadError'))} />;
  }

  const ai = data.ai;
  const n = (v: number) => formatCompact(v, locale);
  const budget = ai.pricing.monthly_budget_eur;

  return (
    <div className="space-y-4">
      {ai.budget_level !== 'ok' && (
        <Alert variant={ai.budget_level === 'exceeded' ? 'destructive' : 'signature'} role="status">
          <AlertTriangle className="h-5 w-5" aria-hidden />
          <AlertTitle>{t(ai.budget_level === 'exceeded' ? 'budgetExceededTitle' : 'budgetWarningTitle')}</AlertTitle>
          <AlertDescription className="text-foreground/80">
            {t('budgetBody', {
              cost: formatEur(ai.cost_eur, locale),
              budget: formatEur(budget ?? 0, locale),
              pct: Math.round(ai.budget_used_pct ?? 0),
            })}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label={t('users')} value={n(data.users_total)} hint={t('newThisWeek', { count: data.new_7d })} />
        <StatTile
          label={t('active')}
          value={`${n(data.active_7d)} · ${n(data.active_30d)}`}
          hint={t('activeHint')}
        />
        <StatTile
          label={t('onboarding')}
          value={`${Math.round(data.onboarding_pct)}%`}
          hint={t('onboardingHint', { count: data.onboarding_completed })}
        />
        <StatTile label={t('content')} value={n(data.items_total)} hint={t('contentHint', { outfits: data.outfits_total })} />
      </div>

      <SectionCard title={t('signupsTitle')} description={t('signupsBody', { count: data.new_7d })}>
        <SignupsChart days={data.signups_by_day} />
      </SectionCard>

      <SectionCard
        title={t('aiTitle')}
        description={t('aiMonth', { month: ai.month })}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label={t('requests')} value={n(ai.requests)} />
          <StatTile label={t('tokensIn')} value={n(ai.input_tokens)} />
          <StatTile label={t('tokensOut')} value={n(ai.output_tokens)} hint={ai.unsplit_tokens ? t('unsplit', { count: n(ai.unsplit_tokens) }) : undefined} />
          <StatTile
            label={t('cost')}
            value={<span>≈ {formatEur(ai.cost_eur, locale)}</span>}
            hint={t('approx')}
            className="bg-signature-soft"
          />
        </div>

        {budget ? (
          <div className="mt-4 space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="font-semibold">{t('budgetLabel')}</span>
              <span className="tabular-nums text-muted-foreground">
                {formatEur(ai.cost_eur, locale)} / {formatEur(budget, locale)}
              </span>
            </div>
            <Progress value={Math.min(ai.budget_used_pct ?? 0, 100)} aria-label={t('budgetLabel')} />
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">{t('noBudgetSet')}</p>
        )}

        <h3 className="mb-2 mt-5 text-[15px] font-bold">{t('topUsers')}</h3>
        {ai.top_users.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noUsage')}</p>
        ) : (
          <ol className="divide-y divide-border">
            {ai.top_users.map((u, i) => (
              <li key={u.id} className="flex items-start gap-3 py-2.5 text-sm">
                <span className="w-5 shrink-0 tabular-nums text-muted-foreground">{i + 1}.</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    <span className="font-semibold">{u.display_name}</span>
                    {u.username && <span className="text-muted-foreground"> @{u.username}</span>}
                  </span>
                  <span className="block tabular-nums text-[13px] text-muted-foreground">
                    {t('topUserUsage', { requests: u.requests, tokens: n(u.tokens) })}
                  </span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">≈ {formatEur(u.cost_eur, locale)}</span>
              </li>
            ))}
          </ol>
        )}
      </SectionCard>

      <SectionCard title={t('pricing.title')} description={t('pricing.description')}>
        <PricingForm pricing={ai.pricing} />
      </SectionCard>
    </div>
  );
}
