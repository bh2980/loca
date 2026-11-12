/** The 상태·태그 settings screen of one target: a project's statuses and tags, or the home's defaults for new projects. */
import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { AUTO_MARK_IDS, TAG_SCOPES } from '@tw/shared';
import { Box, Button, PageBody, Section, SplitPane, Text } from '@loca/ui';
import { Page } from '@/components/page';
import { StatusPane } from '@/components/settings/status-pane';
import { StatusDeleteDialog, StatusTable } from '@/components/settings/status-table';
import { TagDeleteDialog } from '@/components/settings/tag-delete-dialog';
import { TagPane } from '@/components/settings/tag-pane';
import { AutoTagTable, autoTagsOn, ProjectMarkPane, TagTable } from '@/components/settings/tag-table';
import type { StatusRow, TagRow, TaxonomySource } from '@/components/settings/taxonomy-source';
import type { StatusForm, TagForm } from '@/components/settings/status-types';
import { useListScreen } from '@/lib/list-screen';
import { param, type SearchOf } from '@/lib/search';
import type { SettingsTarget } from '@/lib/settings-target';

/**
 * The screen's URL: the open status, tag or automatic tag (`new` while one is being added; one pane at a time) and
 * the tag tables' 붙는 곳 filter. Both routes read these; the defaults have no automatic tags, so `mark` stays unset there.
 */
export const taxonomySearchParams = { status: param.text, tag: param.text, mark: param.oneOf(AUTO_MARK_IDS), on: param.oneOf(TAG_SCOPES) };
export type TaxonomySearch = SearchOf<typeof taxonomySearchParams>;

/** What differs between the two targets besides the rows: the words. */
const WORDS = {
  project: { title: '상태·태그', pane: 'settings-statuses', report: 'statuses', status: '상태', tag: '태그', intro: undefined, tags: '모두 보통 태그입니다. 검사·검수 워크플로는 태그 붙이기 노드에서 고른 태그를 붙이고 떼며, 번역을 고쳐도 저절로 떨어지지 않습니다.' },
  app: { title: '기본 상태·태그', pane: 'settings-default-statuses', report: 'settings-default-statuses', status: '기본 상태', tag: '기본 태그', intro: '새 프로젝트가 처음 가지는 상태와 태그입니다. 바꿔도 이미 있는 프로젝트는 그대로입니다. 시작·최종 상태가 하나씩은 있어야 합니다.', tags: '사람이 만든 태그만 담깁니다. AI 실패 같은 앱의 태그는 프로젝트마다 자동으로 생깁니다.' },
} as const;

const Framed = ({ children }: { children: ReactNode }) => <Box overflow="hidden" radius="md" border="all" borderColor="default" background="surface">{children}</Box>;

export function TaxonomySettings({ target, source, search, navigate }: {
  target: SettingsTarget;
  source: TaxonomySource;
  search: TaxonomySearch;
  navigate: (options: { search: (previous: TaxonomySearch) => TaxonomySearch; replace: boolean }) => unknown;
}) {
  const words = WORDS[target.kind];
  const { statuses, tags } = source;
  const selectedStatus = search.status && search.status !== 'new' ? statuses?.find((status) => status.id === search.status) : undefined;
  const selectedTag = search.tag && search.tag !== 'new' ? tags?.find((tag) => tag.id === search.tag) : undefined;
  const selectedMark = target.kind === 'project' ? search.mark : undefined;
  const { setSearch, open, close, toggle } = useListScreen({
    search,
    navigate,
    selection: ['status', 'tag', 'mark'],
    report: [words.report, [selectedStatus && { kind: words.status, id: selectedStatus.id, label: selectedStatus.name }, selectedTag && { kind: words.tag, id: selectedTag.id, label: selectedTag.name }]],
  });
  // What is asked to be deleted, from a pane, a row's menu or the bulk button: one confirmation per entity.
  const [removing, setRemoving] = useState<StatusRow[] | null>(null);
  const [removingTags, setRemovingTags] = useState<TagRow[] | null>(null);

  const fail = (error: Error) => toast.error(error.message);
  const createStatus = useMutation({ mutationFn: (form: StatusForm) => source.createStatus(form), onSuccess: () => { close(); toast.success('상태를 추가했습니다.'); }, onError: fail });
  const saveStatus = useMutation({ mutationFn: (variables: { id: string; changed: Partial<StatusForm> }) => source.saveStatus(variables.id, variables.changed), onSuccess: () => toast.success('저장했습니다.'), onError: fail });
  const deleteStatuses = useMutation({
    mutationFn: (variables: { ids: string[]; moveTo?: string }) => source.deleteStatuses(variables.ids, variables.moveTo),
    onSuccess: (_result, variables) => {
      setRemoving(null);
      if (search.status && variables.ids.includes(search.status)) close();
      toast.success(variables.moveTo ? `상태 ${variables.ids.length}개를 삭제하고 대사를 옮겼습니다.` : `상태 ${variables.ids.length}개를 삭제했습니다.`);
    },
    onError: fail,
  });
  const reorderStatuses = useMutation({ mutationFn: (ids: string[]) => source.reorderStatuses(ids), onError: fail });
  const createTag = useMutation({ mutationFn: (form: TagForm) => source.createTag(form), onSuccess: () => { close(); toast.success('태그를 추가했습니다.'); }, onError: fail });
  const saveTag = useMutation({ mutationFn: (variables: { id: string; changed: Partial<TagForm> }) => source.saveTag(variables.id, variables.changed), onSuccess: () => toast.success('저장했습니다.'), onError: fail });
  const deleteTags = useMutation({
    mutationFn: (ids: string[]) => source.deleteTags(ids),
    onSuccess: (_result, ids) => {
      if (search.tag && ids.includes(search.tag)) close();
      toast.success(`태그 ${ids.length}개를 삭제했습니다.`);
    },
    onError: fail,
  });
  const reorderTags = useMutation({ mutationFn: (ids: string[]) => source.reorderTags(ids), onError: fail });

  const pane =
    selectedMark && target.kind === 'project' ? (
      <ProjectMarkPane key={selectedMark} projectId={target.projectId} mark={selectedMark} onClose={close} />
    ) : search.status === 'new' ? (
      <StatusPane key="new" pending={createStatus.isPending} onClose={close} onSave={(form) => createStatus.mutate(form)} />
    ) : selectedStatus ? (
      <StatusPane key={selectedStatus.id} status={selectedStatus} count={statuses!.length} pending={saveStatus.isPending} onClose={close} onSave={(_form, changed) => saveStatus.mutate({ id: selectedStatus.id, changed })} onDelete={() => setRemoving([selectedStatus])} />
    ) : search.tag === 'new' ? (
      <TagPane key="new" pending={createTag.isPending} onClose={close} onSave={(form) => createTag.mutate(form)} />
    ) : selectedTag ? (
      // The pane asks before it deletes its own tag (the same confirmation the table's delete uses).
      <TagPane key={selectedTag.id} tag={selectedTag} pending={saveTag.isPending} onClose={close} onSave={(_form, changed) => saveTag.mutate({ id: selectedTag.id, changed })} onDelete={() => deleteTags.mutate([selectedTag.id])} />
    ) : null;

  const shownTags = tags && search.on ? tags.filter((tag) => tag.scope.includes(search.on!)) : tags;
  return (
    <Page title={words.title} flush>
      <SplitPane fill="height" id={words.pane} selectionKey={search.status ?? search.tag ?? selectedMark} defaultWidth="384px" pane={pane}>
        <PageBody width="wide">
          <Box spaceY="wide">
            {words.intro && <Text as="p" tone="muted">{words.intro}</Text>}
            <Section
              variant="page"
              title="상태"
              actions={
                <>
                  {statuses && <Text variant="caption" tone="muted" tabular>{statuses.length}개</Text>}
                  <Button variant="outline" onClick={() => open('new', 'status')}><Plus /> 추가</Button>
                </>
              }
            >
              <Framed>
                <StatusTable target={target} rows={statuses} selected={search.status} onToggle={(id) => toggle(id, 'status')} onOpen={(id) => open(id, 'status')} onReorder={(ids) => reorderStatuses.mutate(ids)} onDelete={setRemoving} />
              </Framed>
            </Section>

            <Section
              variant="page"
              title="태그"
              description={words.tags}
              actions={
                <>
                  {shownTags && <Text variant="caption" tone="muted" tabular>{shownTags.length}개</Text>}
                  <Button variant="outline" onClick={() => open('new', 'tag')}><Plus /> 추가</Button>
                </>
              }
            >
              <Framed>
                <TagTable target={target} rows={tags} place={search.on} onPlace={(on) => setSearch({ on })} selected={search.tag} onToggle={(id) => toggle(id, 'tag')} onOpen={(id) => open(id, 'tag')} onReorder={(ids) => reorderTags.mutate(ids)} onDelete={setRemovingTags} />
              </Framed>
            </Section>

            {target.kind === 'project' && (
              <Section variant="page" title="자동 태그" actions={<Text variant="caption" tone="muted" tabular>{autoTagsOn(search.on).length}개</Text>} description="앱이 상태를 보고 스스로 붙였다 떼는 태그입니다. 필터와 조건에서 고를 수 있고, 붙이거나 뗄 수는 없습니다.">
                <Framed>
                  <AutoTagTable place={search.on} selected={selectedMark} onToggle={(mark) => toggle(mark, 'mark')} onOpen={(mark) => open(mark, 'mark')} />
                </Framed>
              </Section>
            )}
          </Box>
        </PageBody>
      </SplitPane>

      <StatusDeleteDialog statuses={removing} all={statuses ?? []} pending={deleteStatuses.isPending} onClose={() => setRemoving(null)} onConfirm={(moveTo) => removing && deleteStatuses.mutate({ ids: removing.map((status) => status.id), moveTo })} />
      <TagDeleteDialog tags={removingTags} onClose={() => setRemovingTags(null)} onConfirm={() => removingTags && deleteTags.mutate(removingTags.map((tag) => tag.id))} />
    </Page>
  );
}
