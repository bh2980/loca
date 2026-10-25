import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PROMPT_TARGET, savedPromptSchema, savedPromptsSchema, type SavedPrompt } from '@tw/shared';
import { Box, Button, Inline, PromptNameInput, PromptTextarea, SavedPromptColumn, SettingsSection, Stack, Text } from '@loca/ui';
import { client, unwrap } from '@/lib/api';
import { q } from '@/lib/queries';

/** 저장한 지시: prompts kept for the project and called as /name in the chat box. Edited in place, saved whole. */
export function SavedPromptsSection({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const prompts = useQuery(q.prompts(projectId));
  const list = prompts.data ?? [];
  // `index` -1: a new one at the end.
  const [editing, setEditing] = useState<{ index: number; name: string; text: string } | null>(null);

  const save = useMutation({
    mutationFn: (next: SavedPrompt[]) => unwrap(client.projects[':projectId'].prompts.$put({ param: { projectId }, json: { prompts: next } })),
    onMutate: (next) => {
      queryClient.setQueryData(q.prompts(projectId).queryKey, next);
    },
    onSuccess: () => toast.success('저장한 지시를 저장했습니다.'),
    onError: (error) => toast.error(error.message),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: q.prompts(projectId).queryKey }),
  });

  const draft = editing && savedPromptSchema.safeParse({ name: editing.name, text: editing.text });
  const next = editing && draft?.success ? list.map((item, index) => (index === editing.index ? draft.data : item)) : null;
  const candidate = editing && draft?.success ? (editing.index === -1 ? [...list, draft.data] : next!) : null;
  const problem = editing && (!draft?.success ? (editing.name || editing.text ? draft?.error?.issues[0]?.message : null) : (savedPromptsSchema.safeParse(candidate).error?.issues[0]?.message ?? null));

  const commit = () => {
    if (!candidate || !savedPromptsSchema.safeParse(candidate).success) return;
    save.mutate(candidate);
    setEditing(null);
  };

  return (
    <SettingsSection title="저장한 지시" description={`채팅 입력창에서 /를 눌러 워크플로 아래 목록에서 고릅니다. 입력창에 채워질 뿐 보내지지는 않아, 고쳐서 보낼 수 있습니다. 지시문에 ${PROMPT_TARGET}를 쓰면 고를 때 그 자리에서 @ 첨부 목록이 열리고, 고른 항목의 짧은 이름이 들어갑니다.`}>
      <SavedPromptColumn>
        {list.length === 0 && editing === null && <Text as="p" variant="body" tone="muted">저장한 지시가 없습니다.</Text>}
        {list.map((prompt, index) =>
          editing?.index === index ? null : (
            <Stack key={prompt.name} direction="row" align="start" gap="condensed" radius="md" border="all" background="background" paddingX="normal" paddingY="condensed">
              <Box minWidth={0} grow>
                <Text as="p" variant="label">/{prompt.name}</Text>
                <Text as="p" variant="caption" tone="muted" lines={2} preserveLines>{prompt.text}</Text>
              </Box>
              <Button variant="ghost" size="icon-xs" aria-label={`/${prompt.name} 고치기`} onClick={() => setEditing({ index, name: prompt.name, text: prompt.text })}>
                <Pencil />
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label={`/${prompt.name} 지우기`} disabled={save.isPending} onClick={() => save.mutate(list.filter((_, at) => at !== index))}>
                <Trash2 />
              </Button>
            </Stack>
          ),
        )}
        {editing && (
          <Box spaceY="condensed" radius="md" border="all" background="background" padding="normal">
            <Inline gap="snug">
              <Text variant="body" tone="muted">/</Text>
              <PromptNameInput value={editing.name} placeholder="이름" aria-label="지시 이름" autoFocus onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
            </Inline>
            <PromptTextarea value={editing.text} placeholder="입력창에 채울 내용" aria-label="지시 내용" onChange={(event) => setEditing({ ...editing, text: event.target.value })} />
            {problem && <Text as="p" variant="caption" tone="danger">{problem}</Text>}
            <Stack direction="row" gap="condensed">
              <Button disabled={!candidate || Boolean(problem) || save.isPending} onClick={commit}>저장</Button>
              <Button variant="ghost" onClick={() => setEditing(null)}>취소</Button>
            </Stack>
          </Box>
        )}
        {editing === null && (
          <Button variant="outline" onClick={() => setEditing({ index: -1, name: '', text: '' })}>
            <Plus /> 지시 추가
          </Button>
        )}
      </SavedPromptColumn>
    </SettingsSection>
  );
}
