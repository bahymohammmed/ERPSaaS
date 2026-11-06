'use client';

import { ActionIcon, Alert, Badge, Button, Card, Checkbox, Group, Modal, NumberInput, Paper, SimpleGrid, Stack, Switch, Text, Textarea, TextInput, Title, Tooltip } from '@mantine/core';
import { dependentsOf, FEATURES, type FeatureKey, featureDef, withDependencies, withoutFeature } from '@erp/shared';
import { IconInfoCircle, IconLock, IconPencil, IconPlus, IconStarFilled, IconTrash } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/common';
import { notifyError, notifySuccess } from '@/components/notify';
import { EmptyState } from '@/components/states';
import { useI18n } from '@/i18n/i18n';
import { api } from '@/lib/api';

export type Plan = {
  code: string;
  name_ar: string;
  name_en: string;
  description_ar: string;
  description_en: string;
  features: FeatureKey[];
  max_companies: number;
  max_users: number;
  price_monthly: string | null;
  price_currency: string;
  is_active: boolean;
  is_default: boolean;
  sort_order: number;
  tenant_count: number;
};

type Form = Omit<Plan, 'tenant_count' | 'price_monthly'> & { price_monthly: string; original?: string };

const blank = (): Form => ({
  code: '',
  name_ar: '',
  name_en: '',
  description_ar: '',
  description_en: '',
  features: withDependencies([]),
  max_companies: 1,
  max_users: 5,
  price_monthly: '',
  price_currency: 'KWD',
  is_active: true,
  is_default: false,
  sort_order: 50,
});

/** Subscription plans: which modules each tenant on the plan can open, and default limits. */
const PlansPage = () => {
  const { t, locale, errorText } = useI18n();
  const plans = useQuery({ queryKey: ['platform-plans'], queryFn: () => api<Plan[]>('/platform/plans') });
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const text = (v: { ar: string; en: string }) => (locale === 'ar' ? v.ar : v.en);
  const planName = (p: { name_ar: string; name_en: string }) => (locale === 'ar' ? p.name_ar || p.name_en : p.name_en || p.name_ar);

  const toggle = (key: FeatureKey, on: boolean) =>
    setForm((f) => (f ? { ...f, features: on ? withDependencies([...f.features, key]) : withoutFeature(f.features, key) } : f));

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const { original, ...body } = form;
      await api(original ? `/platform/plans/${original}` : '/platform/plans', {
        method: original ? 'PUT' : 'POST',
        body: { ...body, price_monthly: body.price_monthly === '' ? null : body.price_monthly },
      });
      notifySuccess(t('saved'));
      setForm(null);
      await plans.refetch();
    } catch (error) {
      notifyError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (plan: Plan) => {
    if (!window.confirm(`${t('confirmDelete')}\n${planName(plan)}`)) return;
    try {
      await api(`/platform/plans/${plan.code}`, { method: 'DELETE' });
      notifySuccess(t('deleted'));
      await plans.refetch();
    } catch (error) {
      notifyError(errorText(error));
    }
  };

  return (
    <>
      <PageHeader
        title={t('subscriptionPlans')}
        subtitle={t('subscriptionPlansSubtitle')}
        actions={
          <Button leftSection={<IconPlus size={16} />} onClick={() => setForm(blank())}>
            {t('newPlan')}
          </Button>
        }
      />
      {plans.data?.length === 0 && <EmptyState />}
      <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} className="stagger">
        {(plans.data ?? []).map((plan) => (
          <Card key={plan.code} padding="lg" className="lift" style={{ opacity: plan.is_active ? 1 : 0.6 }}>
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <div>
                <Group gap={6}>
                  <Title order={4}>{planName(plan)}</Title>
                  {plan.is_default && (
                    <Tooltip label={t('defaultPlanHint')}>
                      <Badge variant="light" leftSection={<IconStarFilled size={10} />}>
                        {t('defaultPlan')}
                      </Badge>
                    </Tooltip>
                  )}
                  {!plan.is_active && (
                    <Badge variant="light" color="gray">
                      {t('inactive')}
                    </Badge>
                  )}
                </Group>
                <Text size="xs" c="dimmed" className="ltr">
                  {plan.code}
                </Text>
              </div>
              <Group gap={4} wrap="nowrap">
                <ActionIcon
                  variant="subtle"
                  aria-label={t('edit')}
                  onClick={() => setForm({ ...plan, price_monthly: plan.price_monthly == null ? '' : String(Number(plan.price_monthly)), original: plan.code })}
                >
                  <IconPencil size={16} />
                </ActionIcon>
                {!plan.is_default && plan.tenant_count === 0 && (
                  <ActionIcon variant="subtle" color="red" aria-label={t('delete')} onClick={() => remove(plan)}>
                    <IconTrash size={16} />
                  </ActionIcon>
                )}
              </Group>
            </Group>
            <Text size="sm" c="dimmed" mt={6} lineClamp={2} mih={40}>
              {locale === 'ar' ? plan.description_ar : plan.description_en}
            </Text>
            <Group gap="lg" mt="sm">
              <div>
                <Text size="xs" c="dimmed">{t('priceMonthly')}</Text>
                <Text fw={700} className="num">
                  {plan.price_monthly == null ? '—' : `${Number(plan.price_monthly)} ${plan.price_currency}`}
                </Text>
              </div>
              <div>
                <Text size="xs" c="dimmed">{t('maxCompanies')}</Text>
                <Text fw={700} className="num">{plan.max_companies}</Text>
              </div>
              <div>
                <Text size="xs" c="dimmed">{t('maxUsers')}</Text>
                <Text fw={700} className="num">{plan.max_users}</Text>
              </div>
              <div>
                <Text size="xs" c="dimmed">{t('tenants')}</Text>
                <Text fw={700} className="num">{plan.tenant_count}</Text>
              </div>
            </Group>
            <Group gap={6} mt="md">
              {FEATURES.filter((f) => plan.features.includes(f.key)).map((f) => (
                <Badge key={f.key} variant="dot" size="sm">
                  {text(f.name)}
                </Badge>
              ))}
            </Group>
          </Card>
        ))}
      </SimpleGrid>

      <Modal opened={!!form} onClose={() => setForm(null)} title={form?.original ? t('editPlan') : t('newPlan')} size="xl">
        {form && (
          <Stack>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <TextInput label={t('code')} required value={form.code} onChange={(e) => setForm({ ...form, code: e.currentTarget.value.toLowerCase() })} classNames={{ input: 'ltr' }} />
              <TextInput label={t('nameAr')} dir="rtl" value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.currentTarget.value })} />
              <TextInput label={t('nameEn')} dir="ltr" value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.currentTarget.value })} />
            </SimpleGrid>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <Textarea label={t('descriptionAr')} dir="rtl" autosize minRows={2} value={form.description_ar} onChange={(e) => setForm({ ...form, description_ar: e.currentTarget.value })} />
              <Textarea label={t('descriptionEn')} dir="ltr" autosize minRows={2} value={form.description_en} onChange={(e) => setForm({ ...form, description_en: e.currentTarget.value })} />
            </SimpleGrid>
            <SimpleGrid cols={{ base: 2, sm: 5 }}>
              <TextInput label={t('priceMonthly')} value={form.price_monthly} onChange={(e) => setForm({ ...form, price_monthly: e.currentTarget.value })} classNames={{ input: 'num' }} inputMode="decimal" />
              <TextInput label={t('currency')} value={form.price_currency} maxLength={3} onChange={(e) => setForm({ ...form, price_currency: e.currentTarget.value.toUpperCase() })} classNames={{ input: 'ltr' }} />
              <NumberInput label={t('maxCompanies')} min={1} max={1000} value={form.max_companies} onChange={(v) => setForm({ ...form, max_companies: Number(v) || 1 })} />
              <NumberInput label={t('maxUsers')} min={1} max={10000} value={form.max_users} onChange={(v) => setForm({ ...form, max_users: Number(v) || 1 })} />
              <NumberInput label={t('sortOrder')} min={0} max={10000} value={form.sort_order} onChange={(v) => setForm({ ...form, sort_order: Number(v) || 0 })} />
            </SimpleGrid>
            <Group>
              <Switch label={t('active')} checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.currentTarget.checked })} />
              <Switch label={t('defaultPlan')} description={t('defaultPlanHint')} checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.currentTarget.checked })} />
            </Group>

            <Title order={5} mt="xs">
              {t('planModules')}
            </Title>
            <Alert variant="light" icon={<IconInfoCircle size={18} />}>
              {t('planModulesHint')}
            </Alert>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
              {FEATURES.map((f) => {
                const on = form.features.includes(f.key);
                const needs = f.requires.map((r) => featureDef(r)).filter(Boolean);
                const dependents = dependentsOf(f.key).filter((d) => form.features.includes(d));
                return (
                  <Paper key={f.key} withBorder p="sm" radius="md" style={{ borderColor: on ? 'var(--mantine-color-brand-5)' : undefined }}>
                    <Checkbox
                      checked={on}
                      disabled={f.core}
                      onChange={(e) => toggle(f.key, e.currentTarget.checked)}
                      label={
                        <Group gap={6}>
                          <Text fw={600} size="sm">{text(f.name)}</Text>
                          {f.core && (
                            <Badge size="xs" variant="light" color="gray" leftSection={<IconLock size={10} />}>
                              {t('alwaysIncluded')}
                            </Badge>
                          )}
                        </Group>
                      }
                      description={
                        <>
                          <Text size="xs" c="dimmed" component="span" display="block">
                            {text(f.description)}
                          </Text>
                          <Text size="xs" c="dimmed" component="span" display="block" mt={4} className="ltr">
                            {[...f.screens, ...f.reports.map((r) => `/reports/${r}`)].join(' · ')}
                          </Text>
                          {needs.length > 0 && (
                            <Text size="xs" c="brand" component="span" display="block" mt={4}>
                              {t('moduleRequires')}: {needs.map((n) => n && text(n.name)).join('، ')}
                            </Text>
                          )}
                          {on && dependents.length > 0 && (
                            <Text size="xs" c="orange" component="span" display="block" mt={2}>
                              {t('moduleRemovesAlso')}: {dependents.map((d) => text(featureDef(d)!.name)).join('، ')}
                            </Text>
                          )}
                        </>
                      }
                    />
                  </Paper>
                );
              })}
            </SimpleGrid>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setForm(null)}>
                {t('cancel')}
              </Button>
              <Button onClick={save} loading={busy} disabled={!form.code || (!form.name_ar && !form.name_en)}>
                {t('save')}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
};

export default PlansPage;
