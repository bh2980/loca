import { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { CONNECTION_KIND_INFO, NODE_TYPES, type WorkflowIssue, type WorkflowNode } from '@tw/shared';
import { StatusDot, TagChip } from '@/components/status';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { NODE_ICON } from './node-view';

interface Refs {
  statuses: { id: string; name: string; color: string }[];
  tags: { id: string; name: string; color: string }[];
  profiles: { id: string; name: string; model: string; connectionId: string }[];
  connections: { id: string; kind: keyof typeof CONNECTION_KIND_INFO }[];
  nodes: WorkflowNode[];
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      {label}
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

/** Edits one node's config. Every change goes straight into the draft; saving is separate. */
export function NodeConfig({ node, issues, refs, readOnly, onChange, onDelete, onClose }: {
  node: WorkflowNode;
  issues: WorkflowIssue[];
  refs: Refs;
  readOnly?: boolean;
  onChange: (node: WorkflowNode) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const info = NODE_TYPES[node.type];
  const Icon = NODE_ICON[node.type];
  // The form below only renders fields that belong to node.type, so a loose setter is safe here.
  const set = (key: string, value: unknown) => onChange({ ...node, config: { ...node.config, [key]: value } } as WorkflowNode);
  const kindOf = (profileId: string) => {
    const profile = refs.profiles.find((item) => item.id === profileId);
    return refs.connections.find((connection) => connection.id === profile?.connectionId)?.kind;
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-2 border-b px-4 py-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{info.label}</p>
          <p className="text-xs text-muted-foreground">{info.description}</p>
        </div>
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="닫기">
          <X />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <fieldset disabled={readOnly} className="space-y-5 p-4">
          {issues.length > 0 && (
            <ul className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs">
              {issues.map((issue, index) => (
                <li key={index} className={issue.level === 'error' ? 'text-destructive' : 'text-amber-700'}>
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
          <Field label="이름">
            <Input value={node.label ?? ''} placeholder={info.label} onChange={(event) => onChange({ ...node, label: event.target.value || undefined })} />
          </Field>

          {node.type === 'entry' && (
            <Field label="들어올 대사의 상태" hint="선택한 상태 중 하나인 대사만 실행 대상이 됩니다. 아무것도 고르지 않으면 범위 안의 모든 대사.">
              <div className="space-y-1.5">
                {refs.statuses.map((status) => (
                  <label key={status.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={node.config.statusIds.includes(status.id)}
                      onCheckedChange={(checked) => set('statusIds', checked ? [...node.config.statusIds, status.id] : node.config.statusIds.filter((id) => id !== status.id))}
                    />
                    <StatusDot color={status.color} /> {status.name}
                  </label>
                ))}
              </div>
            </Field>
          )}

          {(node.type === 'translate' || node.type === 'review' || node.type === 'revise') && (
            <>
              <Field label="AI 프로필" hint={node.type === 'review' ? '생성형 모델 또는 System One(판정)을 쓸 수 있습니다.' : undefined}>
                <Select value={node.config.profileId || undefined} onValueChange={(value) => set('profileId', value)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="프로필 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {refs.profiles
                      .filter((profile) => {
                        const kind = kindOf(profile.id);
                        const capabilities = kind ? CONNECTION_KIND_INFO[kind].capabilities : [];
                        return capabilities.includes('generate') || (node.type === 'review' && capabilities.includes('judge'));
                      })
                      .map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {profile.name} <span className="text-muted-foreground">· {profile.model}</span>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="이 노드의 지시문" hint="프로필 지시문 뒤에 덧붙습니다.">
                <Textarea value={node.config.instructions} onChange={(event) => set('instructions', event.target.value)} className="min-h-20" />
              </Field>
              <Separator />
              <div className="space-y-2.5">
                <p className="text-xs font-medium">문맥</p>
                <ToggleRow label="용어집 (원문에 나온 용어)" checked={node.config.context.glossary} onChange={(value) => set('context', { ...node.config.context, glossary: value })} />
                <ToggleRow label="항상 포함 문서 (스토리·세계관·문체)" checked={node.config.context.documents} onChange={(value) => set('context', { ...node.config.context, documents: value })} />
                <ToggleRow label="등장 인물 프로필" checked={node.config.context.characters} onChange={(value) => set('context', { ...node.config.context, characters: value })} />
                <ToggleRow label="인물 관계" checked={node.config.context.relationships} onChange={(value) => set('context', { ...node.config.context, relationships: value })} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="선행 대사 수" hint="대사 그래프에서 앞에 오는 대사">
                    <Input type="number" min={0} max={50} value={node.config.context.precedingLines} onChange={(event) => set('context', { ...node.config.context, precedingLines: Number(event.target.value) })} />
                  </Field>
                  <Field label="이전 장면 수" hint="장면 그래프에서 앞선 장면">
                    <Input type="number" min={0} max={10} value={node.config.context.previousScenes} onChange={(event) => set('context', { ...node.config.context, previousScenes: Number(event.target.value) })} />
                  </Field>
                </div>
              </div>
              <Separator />
              <div className="grid grid-cols-2 gap-3">
                <Field label="묶음 단위">
                  <Select value={node.config.batch.mode} onValueChange={(value) => set('batch', { ...node.config.batch, mode: value as 'unit' | 'group' | 'count' })}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="group">장면별</SelectItem>
                      <SelectItem value="count">개수별</SelectItem>
                      <SelectItem value="unit">대사 하나씩</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {node.config.batch.mode !== 'unit' && (
                  <Field label="최대 묶음 크기">
                    <Input type="number" min={1} max={200} value={node.config.batch.size} onChange={(event) => set('batch', { ...node.config.batch, size: Number(event.target.value) })} />
                  </Field>
                )}
              </div>
            </>
          )}

          {node.type === 'check' && (
            <div className="space-y-2.5">
              <ToggleRow label="자리표시자 ({name}, %s) 보존" checked={node.config.placeholders} onChange={(value) => set('placeholders', value)} />
              <ToggleRow label="서식 태그 보존" checked={node.config.tags} onChange={(value) => set('tags', value)} />
              <ToggleRow label="줄바꿈 수 일치" checked={node.config.newlines} onChange={(value) => set('newlines', value)} />
              <ToggleRow label="빈 번역 금지" checked={node.config.emptyText} onChange={(value) => set('emptyText', value)} />
            </div>
          )}

          {node.type === 'condition' && <ConditionEditor node={node} nodes={refs.nodes} readOnly={readOnly} onChange={onChange} />}

          {node.type === 'update' && (
            <>
              <Field label="상태를 바꾸기">
                <Select value={node.config.statusId ?? 'keep'} onValueChange={(value) => set('statusId', value === 'keep' ? undefined : value)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keep">바꾸지 않음</SelectItem>
                    {refs.statuses.map((status) => (
                      <SelectItem key={status.id} value={status.id}>
                        <StatusDot color={status.color} /> {status.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <ToggleRow label="최신 후보를 대표 번역으로 적용" checked={node.config.applyCandidate} onChange={(value) => set('applyCandidate', value)} />
              {refs.tags.length > 0 && (
                <Field label="태그" hint="누를 때마다 추가 → 제거 → 그대로 순서로 바뀝니다.">
                  <div className="flex flex-wrap gap-1.5">
                    {refs.tags.map((tag) => {
                      const add = node.config.addTagIds.includes(tag.id), remove = node.config.removeTagIds.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          className="rounded border px-1.5 py-0.5 text-xs"
                          onClick={() =>
                            onChange({
                              ...node,
                              config: {
                                ...node.config,
                                addTagIds: add ? node.config.addTagIds.filter((id) => id !== tag.id) : remove ? node.config.addTagIds : [...node.config.addTagIds, tag.id],
                                removeTagIds: add ? [...node.config.removeTagIds, tag.id] : node.config.removeTagIds.filter((id) => id !== tag.id),
                              },
                            })
                          }
                        >
                          {add ? '+ ' : remove ? '− ' : ''}
                          <TagChip tag={tag} />
                        </button>
                      );
                    })}
                  </div>
                </Field>
              )}
            </>
          )}

          {node.type === 'human' && (
            <Field label="검토자에게 보일 안내">
              <Textarea value={node.config.instructions} onChange={(event) => set('instructions', event.target.value)} />
            </Field>
          )}
        </fieldset>
      </ScrollArea>
      {!readOnly && node.type !== 'entry' && (
        <div className="border-t p-3">
          <Button variant="ghost" size="sm" className="text-destructive" onClick={onDelete}>
            <Trash2 /> 노드 삭제
          </Button>
        </div>
      )}
    </div>
  );
}

/** Common conditions as a form; anything else is plain JSON Logic. */
function ConditionEditor({ node, nodes, readOnly, onChange }: { node: Extract<WorkflowNode, { type: 'condition' }>; nodes: WorkflowNode[]; readOnly?: boolean; onChange: (node: WorkflowNode) => void }) {
  const [text, setText] = useState(() => JSON.stringify(node.config.expression ?? null, null, 2));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setText(JSON.stringify(node.config.expression ?? null, null, 2)), [node.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (expression: unknown, description: string) => {
    setText(JSON.stringify(expression, null, 2));
    setError(null);
    onChange({ ...node, config: { expression, description } });
  };
  const visitTargets = nodes.filter((other) => other.id !== node.id && other.type !== 'entry' && other.type !== 'end');
  const [target, setTarget] = useState(visitTargets.find((other) => other.type === 'revise')?.id ?? visitTargets[0]?.id ?? '');
  const [limit, setLimit] = useState(3);

  return (
    <div className="space-y-4">
      <Field label="설명">
        <Input value={node.config.description} onChange={(event) => onChange({ ...node, config: { ...node.config, description: event.target.value } })} />
      </Field>
      {!readOnly && (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-xs font-medium">자주 쓰는 조건</p>
          <div className="flex items-center gap-2 text-sm">
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger size="sm" className="w-36">
                <SelectValue placeholder="노드" />
              </SelectTrigger>
              <SelectContent>
                {visitTargets.map((other) => (
                  <SelectItem key={other.id} value={other.id}>
                    {other.label ?? NODE_TYPES[other.type].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            방문
            <Input type="number" min={1} className="h-8 w-16" value={limit} onChange={(event) => setLimit(Number(event.target.value))} />
            회 미만
            <Button
              size="sm"
              variant="secondary"
              disabled={!target}
              onClick={() => apply({ '<': [{ var: `visits.${target}` }, limit] }, `'${visitTargets.find((other) => other.id === target)?.label ?? target}' 방문이 ${limit}회 미만`)}
            >
              적용
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" onClick={() => apply({ '==': [{ var: 'review.passed' }, true] }, '검수 통과')}>
              검수 통과
            </Button>
            <Button size="sm" variant="outline" onClick={() => apply({ '==': [{ var: 'check.passed' }, true] }, '형식 검사 통과')}>
              형식 검사 통과
            </Button>
            <Button size="sm" variant="outline" onClick={() => apply({ '==': [{ var: 'unit.kind' }, 'ui'] }, 'UI 문자열')}>
              UI 문자열
            </Button>
          </div>
        </div>
      )}
      <Field label="조건식 (JSON Logic)" hint="읽을 수 있는 값: visits.<노드ID>, review.passed, review.issues, check.passed, unit.kind, unit.speaker, unit.statusId, unit.tagIds">
        <Textarea
          value={text}
          spellCheck={false}
          className="min-h-28 font-mono text-xs"
          onChange={(event) => {
            setText(event.target.value);
            try {
              onChange({ ...node, config: { ...node.config, expression: JSON.parse(event.target.value) } });
              setError(null);
            } catch {
              setError('JSON 형식이 아닙니다.');
            }
          }}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
      </Field>
    </div>
  );
}
