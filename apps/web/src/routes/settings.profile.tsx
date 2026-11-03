import { useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Box, Field, HistoryEntry, Inline, Input, PageBody, PersonAvatar, Section, Stack, Text } from '@loca/ui';
import { Page } from '@/components/page';
import { Swatches } from '@/components/settings/swatches';
import { saveAppDefaults, useProfile } from '@/lib/app-data';

export const Route = createFileRoute('/settings/profile')({ component: Profile });

const save = (patch: { displayName?: string; avatarColor?: string }, done: string) =>
  void saveAppDefaults(patch).then(() => toast.success(done), (error: Error) => toast.error(error.message));

/**
 * 프로필: the person's name and avatar colour, as the sidebar and a line's 이력 show them, with a preview of an 이력 entry.
 * The name is saved when the field is left (Enter too), the colour when it is picked.
 */
function Profile() {
  const profile = useProfile();
  const [name, setName] = useState(profile.name);
  useEffect(() => setName(profile.name), [profile.name]);
  const typed = name.trim();
  const saveName = () => typed !== profile.name && save({ displayName: typed }, typed ? '이름을 저장했습니다.' : '이름을 지웠습니다.');
  // The preview follows what is typed, before it is saved.
  const mark = [...(typed || '사람')][0]!;
  return (
    <Page title="프로필" flush>
      <PageBody>
        <Section variant="page" title="프로필" description="대사 이력과 사이드바에 나오는 나입니다. 이름을 비워 두면 '사람'으로 나옵니다. 프로젝트에 복사되지 않습니다.">
          <Stack gap="comfortable">
            <Inline gap="comfortable" align="start">
              <PersonAvatar mark={mark} color={profile.color} size="lg" />
              <Stack gap="normal" grow minWidth={0}>
                <Field label="표시 이름" description="32자까지">
                  <Input value={name} maxLength={32} disabled={!profile.loaded} placeholder="사람" onChange={(event) => setName(event.target.value)} onBlur={saveName} onKeyDown={(event) => event.key === 'Enter' && saveName()} />
                </Field>
                <Field label="색">
                  <Swatches value={profile.color ?? ''} onChange={(color) => save({ avatarColor: color }, '색을 저장했습니다.')} onClear={() => save({ avatarColor: '' }, '기본 색으로 되돌렸습니다.')} />
                </Field>
              </Stack>
            </Inline>
            <Box spaceY="condensed">
              <Text as="p" variant="caption" tone="muted">미리보기 · 대사 이력</Text>
              <Box as="ul" border="all" radius="md" padding="normal">
                <HistoryEntry actor="person" mark={mark} markColor={profile.color} title={typed || '사람'} meta="직접 고침" time="09:02">
                  <p>안녕하세요. 오늘도 잘 부탁드립니다.</p>
                </HistoryEntry>
              </Box>
            </Box>
          </Stack>
        </Section>
      </PageBody>
    </Page>
  );
}
