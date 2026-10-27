import { createFileRoute } from '@tanstack/react-router';
import { Monitor, Moon, Sun } from 'lucide-react';
import { PageBody, RadioGroup, RadioGroupItem, Field, Inline, Section } from '@loca/ui';
import { Page } from '@/components/page';
import { setTheme, useTheme, type ThemeChoice } from '@/lib/theme';

export const Route = createFileRoute('/settings/appearance')({ component: Appearance });

const THEMES: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: '밝게', icon: Sun },
  { value: 'dark', label: '어둡게', icon: Moon },
  { value: 'system', label: '시스템 설정', icon: Monitor },
];

function Appearance() {
  const theme = useTheme();
  return (
    <Page title="테마" flush>
      <PageBody>
        <Section variant="page" title="테마" description="이 브라우저에만 저장됩니다. 프로젝트 화면 사이드바의 메뉴와 같은 설정입니다.">
          <RadioGroup value={theme} onValueChange={(value) => setTheme(value as ThemeChoice)} aria-label="테마">
            {THEMES.map((entry) => (
              <Field.Label key={entry.value} variant="choice">
                <RadioGroupItem value={entry.value} />
                <Inline as="span" gap="tight"><entry.icon /> {entry.label}</Inline>
              </Field.Label>
            ))}
          </RadioGroup>
        </Section>
      </PageBody>
    </Page>
  );
}
