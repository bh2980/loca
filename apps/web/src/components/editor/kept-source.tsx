import { Lock } from 'lucide-react';
import { Icon, Inline, Text } from '@loca/ui';
import { TokenText } from './source-text';

/**
 * A 번역 제외 line's place for a translation: what goes into the game, its source as it is (shippedText), muted and
 * marked so it reads as decided, not as a line still to translate.
 */
export function KeptSource({ source, pattern }: { source: string; pattern: RegExp | null }) {
  return (
    <Inline gap="tight" align="start" minWidth={0} tone="muted" title="번역 제외 · 원문 그대로 나갑니다">
      <Icon icon={Lock} size="xs" shrink={false} aria-label="원문 그대로" />
      <Text minWidth={0} preserveLines><TokenText text={source} source={source} pattern={pattern} /></Text>
    </Inline>
  );
}
