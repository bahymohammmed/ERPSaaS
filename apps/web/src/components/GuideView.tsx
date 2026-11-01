'use client';

import { List, Stack, Text, Title } from '@mantine/core';
import type { Guide } from '@/help/guides';
import { useI18n } from '@/i18n/i18n';

/** One guide in the current language. */
export const GuideView = ({ guide, headingOrder = 4 }: { guide: Guide; headingOrder?: 3 | 4 }) => {
  const { t, locale } = useI18n();
  const text = guide[locale];
  return (
    <Stack gap="xs">
      <Title order={headingOrder}>{text.title}</Title>
      <Text size="sm">{text.summary}</Text>
      <Text fw={600} size="sm" mt="xs">
        {t('guideSteps')}
      </Text>
      <List type="ordered" size="sm" spacing={4}>
        {text.steps.map((step) => (
          <List.Item key={step}>{step}</List.Item>
        ))}
      </List>
      {text.tips.length > 0 && (
        <>
          <Text fw={600} size="sm" mt="xs">
            {t('guideTips')}
          </Text>
          <List size="sm" spacing={4}>
            {text.tips.map((tip) => (
              <List.Item key={tip}>{tip}</List.Item>
            ))}
          </List>
        </>
      )}
    </Stack>
  );
};
