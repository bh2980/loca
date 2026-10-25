import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Box, Inline, Text, Input } from '@loca/ui';
import { AiButton } from '@/components/ai-button';
import { client, unwrap } from '@/lib/api';

export type GeneratedRule =
  | { label: string; kind: 'placeholder' | 'tag'; pattern: string; example: string }
  | { label: string; kind: 'forbidden' | 'preserve' | 'targetRequired'; pattern: string; example: string };

/**
 * 자연어로 정규식 만들기: describe a rule in words and get one back (label, kind, pattern,
 * example) for the caller to add as a row. Nothing is saved here; the caller's own form decides.
 * `target` says which kinds are allowed: 'token' (placeholder/tag) or 'check' (forbidden/preserve/targetRequired).
 */
export function AiRegexInput({ projectId, target, onRule }: { projectId: string; target: 'token' | 'check'; onRule: (rule: GeneratedRule) => void }) {
  const [prompt, setPrompt] = useState('');
  const make = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId']['generate-regex'].$post({ param: { projectId }, json: { prompt: prompt.trim(), target } })),
    onSuccess: (rule) => {
      onRule(rule);
      setPrompt('');
    },
  });
  const run = () => {
    if (prompt.trim() && !make.isPending) make.mutate();
  };
  return (
    <Box spaceY="tight">
      <Inline gap="condensed">
        <Box asChild grow><Input
          placeholder="예: 대괄호 두 개로 감싼 변수 [[ID]]"
          aria-label="AI로 만들 규칙 설명"
          maxLength={500}
          value={prompt}
          disabled={make.isPending}
          onChange={(event) => {
            setPrompt(event.target.value);
            if (make.isError) make.reset();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              run();
            }
          }}
        /></Box>
        <AiButton disabled={!prompt.trim() || make.isPending} onClick={run}>
          {make.isPending ? '만드는 중…' : '만들기'}
        </AiButton>
      </Inline>
      {make.isError && <Text as="p" variant="caption" tone="danger">{make.error.message}</Text>}
    </Box>
  );
}
