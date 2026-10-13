import { useEffect, useState } from 'react';
import { Keyboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
      ['↑ ↓', '줄 이동 (편집기 밖에서)'],
      ['Alt+Up Alt+Down', '줄 이동 (어디서나) · 찾아가기 중에는 이전·다음 해당 줄'],
      ['Enter', '고른 줄의 편집기로'],
    ],
  },
  {
    title: '번역 편집기',
    keys: [
      ['Mod+S', '저장'],
      ['Mod+Enter', '저장하고 다음 상태로, 다음 줄로'],
      ['Esc', '편집기에서 나가기 (초안은 남음)'],
      ['Mod+1…9', '원문의 n번째 서식 넣기 (쌍은 고른 글자를 감쌈)'],
      ['Alt+1…3', '제안 가져오기'],
      ['Mod+Shift+S', '원문 복사'],
      ['Mod+Shift+T', '빠진 서식 넣기 (흐린 칩, Tab으로 받기)'],
      ['Alt+/', 'AI 자동완성 부르기 (설정에서 켰을 때)'],
      ['Tab', '흐린 글씨 받기 (서식 칩·자동완성)'],
      ['Mod+ArrowRight', '자동완성 한 낱말만 받기'],
    ],
  },
  {
    title: '대사 그래프',
    keys: [
      ['Enter', '고른 노드 옆에 번역 카드'],
      ['Alt+Up Alt+Down', '카드에서 흐름을 따라 앞·다음 줄'],
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
      <PopoverContent align="end" className="max-h-[80vh] w-96 overflow-auto p-0">
        {SECTIONS.map((section) => (
          <section key={section.title} className="border-b px-4 py-3 last:border-b-0">
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">{section.title}</h3>
            <dl className="space-y-1.5 text-sm">
              {section.keys.map(([keys, what]) => (
                <div key={keys + what} className="flex items-start justify-between gap-3">
                  <dt className="min-w-0">{what}</dt>
                  <dd className="flex shrink-0 gap-1">
                    {shown(keys).map((key) => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </PopoverContent>
    </Popover>
  );
}
