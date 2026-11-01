'use client';

import { Group, Text } from '@mantine/core';
import { useMemo, useState } from 'react';
import { useI18n } from '@/i18n/i18n';

export type MonthPoint = { period_id: string; start_date: string; revenue: string; expense: string };

const W = 720;
const H = 260;
const PAD = { top: 16, bottom: 32, side: 56 };

/** Compact axis label: 12,500 → 12.5k. */
const compact = (value: number, locale: 'ar' | 'en') =>
  new Intl.NumberFormat(locale === 'ar' ? 'ar-KW-u-nu-latn' : 'en-GB', { notation: 'compact', maximumFractionDigits: 1 }).format(value);

/**
 * Revenue vs expense columns per month. Plain SVG (no chart library): bars grow in one after
 * another, and the axis runs right-to-left in Arabic.
 */
export const RevenueChart = ({ months, minorUnits }: { months: MonthPoint[]; minorUnits: number }) => {
  const { t, locale, amount } = useI18n();
  const [hover, setHover] = useState<number | null>(null);
  const rtl = locale === 'ar';
  const data = useMemo(() => (rtl ? [...months].reverse() : months), [months, rtl]);
  const max = Math.max(1, ...data.flatMap((m) => [Number(m.revenue), Number(m.expense)]));
  const nice = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / nice) * nice;
  const plotW = W - PAD.side * 2;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / Math.max(1, data.length);
  const barW = Math.min(16, slot * 0.28);
  const y = (v: number) => PAD.top + plotH - (Math.max(0, v) / top) * plotH;
  const monthName = (date: string) => new Intl.DateTimeFormat(rtl ? 'ar-KW' : 'en-GB', { month: 'short' }).format(new Date(`${date}T00:00:00`));
  const hovered = hover === null ? null : data[hover];

  return (
    <div>
      <Group justify="space-between" mb="xs" wrap="wrap">
        <Group gap="md">
          <Group gap={6}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--mantine-primary-color-filled)' }} />
            <Text size="xs" c="dimmed">
              {t('revenue')}
            </Text>
          </Group>
          <Group gap={6}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--mantine-color-orange-5)' }} />
            <Text size="xs" c="dimmed">
              {t('expenses')}
            </Text>
          </Group>
        </Group>
        <Text size="xs" c="dimmed" className="num" style={{ minHeight: 18 }}>
          {hovered
            ? `${monthName(hovered.start_date)} · ${t('revenue')} ${amount(hovered.revenue, minorUnits)} · ${t('expenses')} ${amount(hovered.expense, minorUnits)}`
            : ''}
        </Text>
      </Group>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={t('revenueVsExpenses')} style={{ display: 'block', direction: 'ltr' }}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const gy = PAD.top + plotH - f * plotH;
          return (
            <g key={f}>
              <line x1={PAD.side} x2={W - PAD.side} y1={gy} y2={gy} stroke="var(--app-muted-border)" strokeDasharray={f === 0 ? undefined : '3 4'} />
              <text x={rtl ? W - 2 : 2} y={gy + 4} fontSize="11" textAnchor={rtl ? 'end' : 'start'} fill="var(--mantine-color-dimmed)">
                {compact(top * f, locale)}
              </text>
            </g>
          );
        })}
        {data.map((m, i) => {
          const cx = PAD.side + slot * i + slot / 2;
          const rev = Number(m.revenue);
          const exp = Number(m.expense);
          return (
            <g key={m.period_id} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: 'default' }}>
              <rect x={cx - slot / 2} y={PAD.top} width={slot} height={plotH} fill={hover === i ? 'var(--app-subtle)' : 'transparent'} rx={6} />
              <rect
                className="bar"
                x={cx - barW - 2}
                y={y(rev)}
                width={barW}
                height={PAD.top + plotH - y(rev)}
                rx={4}
                fill="var(--mantine-primary-color-filled)"
                style={{ animationDelay: `${i * 45}ms` }}
              />
              <rect
                className="bar"
                x={cx + 2}
                y={y(exp)}
                width={barW}
                height={PAD.top + plotH - y(exp)}
                rx={4}
                fill="var(--mantine-color-orange-5)"
                style={{ animationDelay: `${i * 45 + 25}ms` }}
              />
              <text x={cx} y={H - 10} fontSize="11" textAnchor="middle" fill="var(--mantine-color-dimmed)">
                {monthName(m.start_date)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};
