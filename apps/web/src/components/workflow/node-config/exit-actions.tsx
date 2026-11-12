/**
 * 출구 동작 in the panes: an exit's actions in order (태그 붙이기 · 태그 떼기 · 상태 바꾸기), each a row that opens to its
 * fields, and the exit's pane (opened by a line or a chip on the canvas: ?exit=node:exit) with where its lines go.
 */
import { ArrowDown, ArrowUp, Plus, Trash2, Unlink } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ISSUE_KIND_LABELS, KNOWLEDGE_STATUSES, KNOWLEDGE_STATUS_LABELS, exitActionIssues, exitActions, exitResultSteps, nodeName, nodeOutputFields, nodePorts, withExitActions, type ExitAction, type TagExitAction, type WorkflowDefinition, type WorkflowNode, INPUT_TYPES } from '@tw/shared';
import { Box, Button, ExpandableRow, Field, Grid, Inline, Input, Inspector, InspectorHeader, InspectorResult, PickedTags, Section, SelectField, SelectItem, Stack, StatusIcon, Text } from '@loca/ui';
import { exitActionText, resultStepNames, type MarkNames } from '@/components/workflow/exit-marks';
import { refsInput, type NodeRefs } from '@/components/workflow/node-config/shared';

const NEW_ACTIONS: { label: string; make: () => ExitAction }[] = [
  { label: '추가할 태그', make: () => ({ type: 'tag', action: 'add', tagIds: [], categoryTags: {} }) },
  { label: '제거할 태그', make: () => ({ type: 'tag', action: 'remove', tagIds: [], categoryTags: {} }) },
  { label: '바꿀 상태', make: () => ({ type: 'status', statusId: '' }) },
];

const namesOf = (refs: NodeRefs): MarkNames => ({ tags: new Map(refs.tags.map((tag) => [tag.id, tag])), statuses: new Map(refs.statuses.map((status) => [status.id, status])) });

/** The statuses an exit can set, by where the input's statuses come from (INPUT_TYPES[input].statuses). */
const STATUS_OPTIONS: Record<(typeof INPUT_TYPES)[keyof typeof INPUT_TYPES]['statuses'], (refs: NodeRefs) => ReactNode> = {
  knowledge: () => KNOWLEDGE_STATUSES.map((status) => <SelectItem key={status} value={status}>{KNOWLEDGE_STATUS_LABELS[status]}</SelectItem>),
  project: (refs) =>
    refs.statuses.map((status) => (
      <SelectItem key={status.id} value={status.id}>
        <StatusIcon status={status} /> {status.name}
      </SelectItem>
    )),
};

/** A status action's one field: the status (a term's: 후보·확정·버림). */
function StatusFields({ action, refs, onChange }: { action: Extract<ExitAction, { type: 'status' }>; refs: NodeRefs; onChange: (action: ExitAction) => void }) {
  const picked = refs.statuses.find((status) => status.id === action.statusId);
  return (
    <Field label="바꿀 상태" description={picked?.humanOnly ? '워크플로가 지정하지 않는 상태 → 실행하면 검토함으로 갑니다.' : '이 출구로 나가는 대사의 상태를 바꿉니다. 사람이 정한 대사는 상태로 고른 실행에서 바꾸지 않습니다.'}>
      <SelectField value={action.statusId || 'none'} onValueChange={(statusId) => onChange({ ...action, statusId: statusId === 'none' ? '' : statusId })}>
        <SelectItem value="none">고르세요</SelectItem>
        {STATUS_OPTIONS[INPUT_TYPES[refsInput(refs)].statuses](refs)}
      </SelectField>
    </Field>
  );
}

/**
 * A tag action's fields: the tags picked here, and the tags a step's result decides: a field of its result whose values
 * stand for tags, each value through the tag set for it here (a value not set takes the tag of its own name).
 */
function TagFields({ node, port, action, refs, onChange }: { node: WorkflowNode; port: string; action: TagExitAction; refs: NodeRefs; onChange: (action: ExitAction) => void }) {
  const add = action.action === 'add';
  const definition = { nodes: refs.nodes, edges: refs.edges ?? [] } as unknown as WorkflowDefinition;
  const steps = exitResultSteps(definition, node, port).filter((step) => step.type !== 'gather');
  const from = resultStepNames(definition, node, port);
  // Fields that can hold tag names: texts and lists of texts, said by what they hold.
  const fields = [...new Map(steps.flatMap((step) => nodeOutputFields(step) ?? []).filter((field) => field.type === 'string' || field.type === 'strings').map((field) => [field.name, field])).values()];
  const [value, setValue] = useState('');
  const connect = (kind: string, tagId: string | undefined) => {
    const next = { ...action.categoryTags };
    if (tagId === undefined) delete next[kind];
    else next[kind] = tagId;
    onChange({ ...action, categoryTags: next });
  };
  const values = Object.keys(action.categoryTags);
  return (
    <>
      <Field label="직접 고른 태그">
        <PickedTags tags={refs.tags} picked={action.tagIds} empty="고른 태그가 없습니다." onChange={(tagIds) => onChange({ ...action, tagIds })} />
      </Field>
      <Field
        label={steps.length ? `${from} 결과에 따라` : '결과에 따라'}
        help={`${from || '앞 단계'}가 낸 값마다 그 값에 맞는 태그를 ${add ? '추가' : '제거'}합니다. 위에서 고른 태그와 함께 쓸 수 있습니다.`}
      >
        {steps.length ? (
          <SelectField value={action.fromField ?? 'none'} ariaLabel="결과의 어느 값을 쓸지" onValueChange={(next) => onChange({ ...action, fromField: next === 'none' ? undefined : next })}>
            <SelectItem value="none">쓰지 않음</SelectItem>
            {action.fromField && !fields.some((field) => field.name === action.fromField) && <SelectItem value={action.fromField}>{action.fromField} (없어짐)</SelectItem>}
            {fields.map((field) => <SelectItem key={field.name} value={field.name}>{field.description || field.name}</SelectItem>)}
          </SelectField>
        ) : (
          <Text as="p" variant="caption" tone="muted">이 출구 앞에 결과를 내는 노드(AI·검사·스크립트)가 없습니다.</Text>
        )}
      </Field>
      {action.fromField && (
        <Field label="값마다 태그" description="표에 없는 값은 같은 이름의 태그를 씁니다. 그런 태그가 없으면 실행 상세에만 남깁니다.">
          <Stack gap="tight">
            {values.map((kind) => (
              <Grid key={kind} columns="labelAndControl" gap="condensed" align="center">
                <Text minWidth={0} truncate variant="body">{ISSUE_KIND_LABELS[kind as keyof typeof ISSUE_KIND_LABELS] ?? kind}</Text>
                <Inline gap="hair">
                  <Box grow minWidth={0}>
                    <SelectField value={action.categoryTags[kind]} ariaLabel={`${kind}의 태그`} onValueChange={(next) => connect(kind, next)}>
                      {!refs.tags.some((tag) => tag.id === action.categoryTags[kind]) && <SelectItem value={action.categoryTags[kind]!}>삭제된 태그</SelectItem>}
                      {refs.tags.map((tag) => <SelectItem key={tag.id} value={tag.id}>#{tag.name}</SelectItem>)}
                    </SelectField>
                  </Box>
                  <Button variant="ghost" size="icon-xs" aria-label={`${kind} 빼기`} title="빼기" onClick={() => connect(kind, undefined)}><Trash2 /></Button>
                </Inline>
              </Grid>
            ))}
            {refs.tags[0] && (
              <Inline gap="hair">
                <Box grow minWidth={0}><Input value={value} placeholder="값 (예: format)" aria-label="태그를 정할 값" onChange={(event) => setValue(event.target.value)} /></Box>
                <Button variant="ghost" disabledReason={(!value.trim() && '값을 적으세요.') || (values.includes(value.trim()) && '이미 있는 값입니다.')} onClick={() => { connect(value.trim(), refs.tags[0]!.id); setValue(''); }}><Plus /> 더하기</Button>
              </Inline>
            )}
          </Stack>
        </Field>
      )}
    </>
  );
}

/** An exit's actions in order: rows that open to their fields, moved up or down, deleted; and the three to add. */
export function ExitActionsEditor({ node, port, refs, readOnly, onChange }: { node: WorkflowNode; port: string; refs: NodeRefs; readOnly?: boolean; onChange: (node: WorkflowNode) => void }) {
  const actions = exitActions(node, port);
  const names = namesOf(refs);
  const set = (next: ExitAction[]) => onChange(withExitActions(node, port, next));
  const move = (index: number, by: number) => {
    const next = [...actions];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item!);
    set(next);
  };
  return (
    <Box spaceY="condensed">
      {actions.length > 0 ? (
        <div>
          {actions.map((action, index) => (
            <ExpandableRow
              key={index}
              ruled
              toggle="chevron"
              label={`${index + 1}번째 동작 편집`}
              defaultOpen={action.type === 'status' ? !action.statusId : !action.tagIds.length && !action.fromField}
              summary={<Text minWidth={0} breakWords>{exitActionText(action, names, resultStepNames({ nodes: refs.nodes, edges: refs.edges ?? [] }, node, port))}</Text>}
              meta={readOnly ? undefined : (
                <Inline gap="hair">
                  <Button variant="ghost" size="icon-xs" aria-label="위로" title="위로" disabledReason={index === 0 && '맨 위입니다.'} onClick={() => move(index, -1)}><ArrowUp /></Button>
                  <Button variant="ghost" size="icon-xs" aria-label="아래로" title="아래로" disabledReason={index === actions.length - 1 && '맨 아래입니다.'} onClick={() => move(index, 1)}><ArrowDown /></Button>
                  <Button variant="ghost" size="icon-xs" aria-label={`${index + 1}번째 동작 삭제`} title="삭제" onClick={() => set(actions.filter((_, at) => at !== index))}><Trash2 /></Button>
                </Inline>
              )}
            >
              <Box spaceY="normal">
                {action.type === 'status'
                  ? <StatusFields action={action} refs={refs} onChange={(next) => set(actions.map((other, at) => (at === index ? next : other)))} />
                  : <TagFields node={node} port={port} action={action} refs={refs} onChange={(next) => set(actions.map((other, at) => (at === index ? next : other)))} />}
              </Box>
            </ExpandableRow>
          ))}
        </div>
      ) : (
        <Text as="p" variant="caption" tone="muted">이 출구로 나가는 대사에 하는 일이 없습니다.</Text>
      )}
      {!readOnly && (
        <Inline wrap gap="hair">
          {NEW_ACTIONS.map((item) => <Button key={item.label} variant="ghost" onClick={() => set([...actions, item.make()])}><Plus /> {item.label}</Button>)}
        </Inline>
      )}
    </Box>
  );
}

/**
 * An exit's pane: what its actions do to the lines leaving it, in order, and where its lines go (a node to open, a line
 * to cut). Actions apply once as a line leaves, before the exit's lines split; with no line the line ends after them.
 */
export function ExitPanel({ node, port, refs, issues, onChange, onRemoveEdge, onClose }: {
  node: WorkflowNode;
  port: string;
  refs: NodeRefs;
  issues: { level: 'error' | 'warning'; message: string }[];
  onChange: (node: WorkflowNode) => void;
  onRemoveEdge: (edgeId: string) => void;
  onClose: () => void;
}) {
  const exit = nodePorts(node).find((item) => item.id === port);
  const lines = (refs.edges ?? []).filter((edge) => edge.source === node.id && edge.sourceHandle === port);
  const own = exitActionIssues({ nodes: refs.nodes, edges: refs.edges ?? [] }, { ...node, exits: { [port]: exitActions(node, port) } }, refsInput(refs), { statusIds: new Set(refs.statuses.map((status) => status.id)), tagIds: new Set(refs.tags.map((tag) => tag.id)) });
  const shown = [...own, ...issues.filter((issue) => !own.some((item) => item.message === issue.message) && issue.message.includes(`'${exit?.label ?? port}' 출구`))];
  return (
    <Inspector bare flush header={<InspectorHeader kind="출구" name={`${nodeName(node)} · ${exit?.label ?? port}`} onClose={onClose} />}>
      {shown.length > 0 && (
        <Section>
          {shown.map((issue) => <InspectorResult key={issue.message} tone={issue.level === 'error' ? 'error' : 'info'}>{issue.message}</InspectorResult>)}
        </Section>
      )}
      <Section title="출구 동작">
        <Text as="p" variant="caption" tone="muted">대사가 이 출구를 떠날 때 한 번, 선이 갈라지기 전에 적힌 순서대로 합니다. 노드 방문으로 세지 않고, 되돌아가는 선으로 다시 오면 다시 합니다.</Text>
        <ExitActionsEditor node={node} port={port} refs={refs} onChange={onChange} />
      </Section>
      <Section title="가는 곳">
        {lines.length ? (
          <Box as="ul" spaceY="hair">
            {lines.map((edge) => {
              const target = refs.nodes.find((item) => item.id === edge.target);
              return (
                <li key={edge.id}>
                  <Inline gap="hair">
                    <Button variant="ghost" grow justifyContent="start" weight="normal" onClick={() => target && refs.onOpenNode?.(target.id)}>
                      <Text truncate>{target ? nodeName(target) : '삭제된 노드'}</Text>
                    </Button>
                    <Button variant="ghost" size="icon-xs" aria-label="선 삭제" title="선 삭제" onClick={() => onRemoveEdge(edge.id)}><Unlink /></Button>
                  </Inline>
                </li>
              );
            })}
          </Box>
        ) : (
          <Text as="p" variant="caption" tone="muted">이 출구에는 선이 없습니다. 출구 동작을 한 뒤 대사는 여기서 끝납니다.</Text>
        )}
      </Section>
    </Inspector>
  );
}
