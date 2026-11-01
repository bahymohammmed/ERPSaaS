'use client';

import { Anchor, Container, Divider, Group, NavLink, Paper, SimpleGrid, Stack, TextInput, Title } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { GuideView } from '@/components/GuideView';
import { LanguageToggle } from '@/components/LanguageToggle';
import { GUIDES, type GuideSection, SECTION_TITLES } from '@/help/guides';
import { useI18n } from '@/i18n/i18n';

const SECTIONS = Object.keys(SECTION_TITLES) as GuideSection[];

/** The whole user guide, grouped by area, searchable in the current language. */
const HelpPage = () => {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GUIDES;
    return GUIDES.filter((g) => {
      const text = g[locale];
      return [text.title, text.summary, ...text.steps, ...text.tips].some((s) => s.toLowerCase().includes(q));
    });
  }, [query, locale]);

  return (
    <Container size="lg" py="md">
      <Group justify="space-between" mb="md">
        <Title order={2}>{t('userGuide')}</Title>
        <Group>
          <Anchor component={Link} href="/" size="sm">
            {t('backToApp')}
          </Anchor>
          <LanguageToggle />
        </Group>
      </Group>
      <SimpleGrid cols={{ base: 1, md: 4 }} spacing="lg">
        <Stack gap={0} visibleFrom="md" style={{ position: 'sticky', top: 16, alignSelf: 'start', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}>
          {SECTIONS.map((section) => (
            <div key={section}>
              <NavLink label={SECTION_TITLES[section][locale]} fw={700} />
              {GUIDES.filter((g) => g.section === section).map((g) => (
                <NavLink key={g.id} component="a" href={`#${g.id}`} label={g[locale].title} ps="lg" />
              ))}
            </div>
          ))}
        </Stack>
        <Stack style={{ gridColumn: 'span 3' }}>
          <TextInput leftSection={<IconSearch size={16} />} placeholder={t('guideSearch')} value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
          {SECTIONS.map((section) => {
            const guides = visible.filter((g) => g.section === section);
            if (!guides.length) return null;
            return (
              <Stack key={section}>
                <Divider label={SECTION_TITLES[section][locale]} labelPosition="left" />
                {guides.map((g) => (
                  <Paper key={g.id} id={g.id} withBorder p="md" style={{ scrollMarginTop: 16 }}>
                    <GuideView guide={g} headingOrder={3} />
                  </Paper>
                ))}
              </Stack>
            );
          })}
        </Stack>
      </SimpleGrid>
    </Container>
  );
};

export default HelpPage;
