import { Monitor, Moon, Sun } from 'lucide-react';
import { DropdownMenuRadioGroup, DropdownMenuRadioItem, MenuLabel } from '@loca/ui';
import { setTheme, useTheme, type ThemeChoice } from '@/lib/theme';

const THEMES: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: '밝게', icon: Sun }, { value: 'dark', label: '어둡게', icon: Moon }, { value: 'system', label: '시스템 설정', icon: Monitor },
];

/** The 화면 테마 choices at the end of a settings menu (the project sidebar's and the home's). */
export function ThemeMenuItems() {
  const theme = useTheme();
  return <>
    <MenuLabel>화면 테마</MenuLabel>
    <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as ThemeChoice)}>
      {THEMES.map((entry) => <DropdownMenuRadioItem key={entry.value} value={entry.value} compact><entry.icon /> {entry.label}</DropdownMenuRadioItem>)}
    </DropdownMenuRadioGroup>
  </>;
}
