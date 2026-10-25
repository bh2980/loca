import { useEffect, useState } from 'react';
import { Keyboard } from 'lucide-react';
import { Box, Button, Heading, Kbd, Popover, PopoverTrigger, ShortcutSection, Stack, PopoverContent } from '@loca/ui';
import { keyLabel } from '@/lib/keys';

/** Every shortcut of the app, by where it works. Keys are written once and shown for the user's platform. */
const SECTIONS: { title: string; keys: [string, string][] }[] = [
  {
    title: '어디서나',
    keys: [
      ['Mod+K', '장면·용어·인물·자료·대사 검색'],
      ['Mod+I', '에이전트 채팅 열기·닫기'],
      ['?', '이 단축키 목록'],
    ],
  },
  {
    title: '번역 화면',
    keys: [
      ['↑ ↓', '줄 이동'],
      ['Alt+Up Alt+Down', '줄 이동 (편집 중에도)'],
      ['Enter', '편집 시작'],
    ],
  },
  {
    title: '번역 편집기',
    keys: [
      ['Mod+S', '저장'],
      ['Mod+Enter', '확정하고 다음 줄'],
      ['Esc', '편집 끝내기'],
      ['Alt+1…9', '서식 넣기'],
      ['Alt+T', '빠진 서식 제자리에'],
      ['Alt+Shift+1…3', '제안 넣기'],
      ['Mod+Shift+S', '원문 복사'],
      ['Alt+.', '다듬기 / AI 번역'],
      ['Alt+/', 'AI 자동완성'],
      ['Tab', '흐린 글씨 받기'],
    ],
  },
  {
    title: '경로',
    keys: [
      ['↑ ↓', '목록의 줄 이동'],
      ['Alt+Up Alt+Down', '편집 중에는 줄 이동, 편집 칸 밖에서는 이전·다음 갈림'],
      ['Alt+N', '다음 미번역 줄'],
      ['Alt+Shift+N', '이전 미번역 줄'],
    ],
  },
  {
    title: '대사 그래프',
    keys: [
      ['Enter', '고른 노드 옆에 번역 카드'],
      ['Alt+Up Alt+Down', '흐름을 따라 앞·다음 줄'],
      ['f', '전체 맞춤'],
      ['+ -', '확대·축소'],
    ],
  },
];

/** "Alt+Up Alt+Down" → each combination in the platform's words. */
const shown = (keys: string) => keys.split(' ').map((combo) => (combo.length > 1 && combo.includes('+') ? keyLabel(combo) : combo));

/**
 * The shortcut list, from the header's keyboard button or `?` anywhere outside a text field. A
 * popover, not a page: it is glanced at and closed.
 */
export function ShortcutHelp() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if (event.key === '?' && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="단축키 (?)" title="단축키 (?)">
          <Keyboard />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" width="popover-lg" padding="none" maxHeight="dialog">
        {SECTIONS.map((section) => (
          <ShortcutSection key={section.title}>
            <Heading as="h3" variant="section" minWidth={0} marginBottom="condensed">{section.title}</Heading>
            <Box as="dl" spaceY="condensed" variant="body">
              {section.keys.map(([keys, what]) => (
                <Stack key={keys + what} direction="row" align="start" justify="between" gap="normal">
                  <Box as="dt" minWidth={0}>{what}</Box>
                  <Stack as="dd" direction="row" shrink={false} gap="tight">
                    {shown(keys).map((key) => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                  </Stack>
                </Stack>
              ))}
            </Box>
          </ShortcutSection>
        ))}
      </PopoverContent>
    </Popover>
  );
}
