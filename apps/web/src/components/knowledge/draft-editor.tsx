import { type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Play, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { DOCUMENT_KINDS, KNOWLEDGE_ORIGIN_LABELS, SPEECH_FIX_WORKFLOW, SPEECH_LEVEL_LABELS, SPEECH_LEVELS, isSettled, KNOWLEDGE_SOURCES, KNOWLEDGE_STATUS_LABELS, SOURCE_LABELS, sourceOf, type KnowledgeOrigin, type KnowledgeSource, type KnowledgeStatus, type SpeechLevel } from '@tw/shared';
import { RunDialog } from '@/components/workflow/run-dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useDraft } from '@/lib/drafts';
import { DOCUMENT_KIND } from '@/lib/labels';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { PaneHeader } from '@/components/pane-header';

export const KINDS = { documents: '문서', characters: '인물', relationships: '관계', events: '사건', speechRules: '말투 규칙' } as const;
export type Kind = keyof typeof KINDS;

/** Fields every knowledge row has, whatever its kind. */
export interface Draft {
  id: string;
  status: KnowledgeStatus;
  origin: KnowledgeOrigin;
  reviewed: boolean;
  evidence: string[];
}
export type Row = Draft & Record<string, unknown>;
export type Value = string | boolean | string[] | null;
export interface Field {
  name: string;
  label: string;
  type: 'text' | 'long' | 'list' | 'bool' | 'level' | 'key' | 'docKind' | 'character';
}
export interface KindSpec {
  rows: Row[];
  columns: { head: string; cell: (row: Row) => ReactNode; className?: string }[];
  fields: Field[];
  label: (row: Row) => string;
  save: (id: string, json: Record<string, Value>) => Promise<unknown>;
  /** Creates an empty item (a person's, official) and returns its id; absent when it cannot be made yet. */
  create?: () => Promise<{ id: string }>;
  remove: (id: string) => Promise<unknown>;
  /** Shown under the fields (read-only facts such as relationship changes, a rule's lines). */
  extra?: (row: Row) => ReactNode;
}

export const fail = (error: Error) => toast.error(error.message);
export const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** AI (added by AI, nobody took it over) or 정식; candidates are shown with a dashed edge, not a badge. */
export function SourceBadge({ row }: { row: Draft }) {
  if (sourceOf(row) === 'ai')
    return (
      <Badge variant="outline" className="text-muted-foreground" title="AI가 넣었고 아직 사람이 고치거나 정식으로 올리지 않았습니다.">
        {SOURCE_LABELS.ai}
      </Badge>
    );
  return <span className="text-xs text-muted-foreground">{row.origin === 'import' || row.origin === 'script' ? KNOWLEDGE_ORIGIN_LABELS[row.origin] : SOURCE_LABELS.official}</span>;
}

/** A candidate row: dashed left edge (not used as context until confirmed). */
export const candidateRow = (row: Draft) => (row.status === 'candidate' ? '[&>td:first-child]:border-l-2 [&>td:first-child]:border-dashed [&>td:first-child]:border-l-amber-500' : undefined);

export type SourceFilter = KnowledgeSource | undefined;
export type StatusFilter = 'confirmed' | 'candidate' | undefined;
export const matches = (row: Draft, source: SourceFilter, status: StatusFilter) => (!source || sourceOf(row) === source) && (!status || row.status === status);

/** 출처 (AI / 정식) and 상태 (확정 / 후보), filtered separately. */
export function KnowledgeFilters({ source, status, onChange }: { source: SourceFilter; status: StatusFilter; onChange: (next: { source?: SourceFilter; status?: StatusFilter }) => void }) {
  return (
    <div className="flex items-center gap-2">
      <ToggleGroup type="single" variant="outline" size="sm" value={source ?? 'all'} onValueChange={(value) => value && onChange({ source: value === 'all' ? undefined : (value as KnowledgeSource) })} aria-label="출처">
        <ToggleGroupItem value="all">전체</ToggleGroupItem>
        {KNOWLEDGE_SOURCES.map((value) => (
          <ToggleGroupItem key={value} value={value}>
            {SOURCE_LABELS[value]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Separator orientation="vertical" className="h-5" />
      <ToggleGroup type="single" variant="outline" size="sm" value={status ?? 'all'} onValueChange={(value) => value && onChange({ status: value === 'all' ? undefined : (value as StatusFilter) })} aria-label="상태">
        <ToggleGroupItem value="all">전체</ToggleGroupItem>
        <ToggleGroupItem value="confirmed">{KNOWLEDGE_STATUS_LABELS.confirmed}</ToggleGroupItem>
        <ToggleGroupItem value="candidate">
          <span className="border-b border-dashed border-amber-500">{KNOWLEDGE_STATUS_LABELS.candidate}</span>
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}

export function DiscardButton({ count, onConfirm }: { count: number; onConfirm: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="ghost" className="text-destructive">
          <Trash2 /> 버리기
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>AI 항목 {count}개를 버릴까요?</AlertDialogTitle>
          <AlertDialogDescription>AI가 넣고 아직 정식이 아닌 항목만 지워집니다. 다시 분석하면 다시 들어올 수 있습니다.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>버리기</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Edit one item (unsaved edits survive navigation), see its evidence, and make it official or
 * discard it while it is AI's. As a right-hand pane, or embedded in another pane (a pair's detail).
 */
export function DraftEditor({ projectId, kind, spec, row, characters, onClose, onDecide, embedded }: {
  projectId: string;
  kind: Kind;
  spec: KindSpec;
  row: Row;
  characters: { id: string; name: string }[];
  onClose?: () => void;
  onDecide: (action: 'confirm' | 'discard') => void;
  embedded?: boolean;
}) {
  const saved = JSON.stringify(Object.fromEntries(spec.fields.map((field) => [field.name, row[field.name] ?? null])));
  const [draft, setDraft, clear] = useDraft(`knowledge.${kind}.${row.id}`, saved);
  const form = JSON.parse(draft) as Record<string, Value>;
  const dirty = draft !== saved;
  const update = (name: string, value: Value) => setDraft(JSON.stringify({ ...form, [name]: value }));
  const save = useMutation({
    mutationFn: () => spec.save(row.id, form),
    onSuccess: () => {
      clear();
      toast.success('저장했습니다. 고친 항목은 정식이 됩니다.');
    },
    onError: fail,
  });
  const remove = useMutation({ mutationFn: () => spec.remove(row.id), onSuccess: onClose, onError: fail });
  const official = isSettled(row);

  const body = (
    <div className={cn('flex flex-col gap-4', !embedded && 'p-4')}>
      {spec.fields.map((field) => (
        <FieldInput key={field.name} field={field} value={form[field.name]} characters={characters} onChange={(value) => update(field.name, value)} />
      ))}
      {spec.extra?.(row)}
      <Evidence projectId={projectId} keys={row.evidence} />
    </div>
  );
  const footer = (
    <div className={cn('flex items-center gap-2', embedded ? 'pt-1' : 'border-t p-3')}>
      {!official ? (
        <>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => onDecide('discard')}>
            <Trash2 /> 버리기
          </Button>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
              저장
            </Button>
            <Button size="sm" disabled={dirty} title={dirty ? '먼저 저장하세요' : 'AI가 넣은 그대로 정식 자료로 올립니다'} onClick={() => onDecide('confirm')}>
              <Check /> 정식으로
            </Button>
          </div>
        </>
      ) : (
        <>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" className="text-destructive">
                <Trash2 /> 삭제
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>정식 항목을 삭제할까요?</AlertDialogTitle>
                <AlertDialogDescription>“{spec.label(row)}”이(가) 사라지고 더 이상 AI 문맥에 쓰이지 않습니다.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>취소</AlertDialogCancel>
                <AlertDialogAction onClick={() => remove.mutate()}>삭제</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button size="sm" className="ml-auto" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            저장
          </Button>
        </>
      )}
    </div>
  );
  if (embedded)
    return (
      <div className="space-y-3">
        {body}
        {footer}
      </div>
    );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneHeader
        kicker={KINDS[kind]}
        title={spec.label(row)}
        subtitle={
          <span className="flex items-center gap-1.5">
            <SourceBadge row={row} />
            {row.status === 'candidate' && <span>후보 · 아직 문맥에 쓰이지 않음</span>}
          </span>
        }
        onClose={onClose}
      />
      <ScrollArea className="min-h-0 flex-1">{body}</ScrollArea>
      {footer}
    </div>
  );
}

export function FieldInput({ field, value, characters, onChange }: { field: Field; value: Value; characters: { id: string; name: string }[]; onChange: (value: Value) => void }) {
  const id = `field-${field.name}`;
  if (field.type === 'bool')
    return (
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{field.label}</Label>
        <Switch id={id} checked={Boolean(value)} onCheckedChange={onChange} />
      </div>
    );
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{field.label}</Label>
      {field.type === 'long' ? (
        <Textarea id={id} rows={field.name === 'body' ? 16 : 4} className={field.name === 'body' ? 'font-mono text-xs' : undefined} value={text(value)} onChange={(event) => onChange(event.target.value)} />
      ) : field.type === 'docKind' || field.type === 'character' ? (
        <Select value={text(value)} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(field.type === 'docKind' ? DOCUMENT_KINDS.map((kind) => ({ id: kind, name: DOCUMENT_KIND[kind] })) : characters).map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : field.type === 'list' ? (
        <Input id={id} value={(value as string[] | null)?.join(', ') ?? ''} onChange={(event) => onChange(event.target.value.split(',').map((part) => part.trim()).filter(Boolean))} />
      ) : field.type === 'level' ? (
        <Select value={text(value)} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SPEECH_LEVELS.map((level) => (
              <SelectItem key={level} value={level}>
                {SPEECH_LEVEL_LABELS[level]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input id={id} className={field.type === 'key' ? 'font-mono text-xs' : undefined} value={text(value)} onChange={(event) => onChange(field.type === 'key' ? event.target.value.trim() || null : event.target.value)} />
      )}
    </div>
  );
}

/** The lines a draft cites, opening in the script. Keys that are not lines were already dropped by the server. */
export function Evidence({ projectId, keys }: { projectId: string; keys: string[] }) {
  const lines = useQuery(q.linesByKeys(projectId, keys.slice(0, 50)));
  return (
    <section className="space-y-2 border-t pt-4">
      <h3 className="text-xs font-medium text-muted-foreground">근거 대사 {keys.length}개</h3>
      {keys.length === 0 && <p className="text-xs text-muted-foreground">근거로 든 대사가 없습니다.</p>}
      <ul className="space-y-1">
        {lines.data?.map((line) => (
          <li key={line.id}>
            <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: line.groupId, line: line.id }} className="block rounded px-2 py-1 text-xs hover:bg-muted">
              <span className="text-muted-foreground">{line.groupTitle} · </span>
              {line.speaker && <span className="font-medium">{line.speaker}: </span>}
              {line.source}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Lines the rule governs and what their translations end in; after fixing the rule, re-run just these. */
export function RuleLines({ projectId, ruleId, candidate }: { projectId: string; ruleId: string; candidate: boolean }) {
  const lines = useQuery(q.ruleLines(projectId, ruleId));
  const levels = Object.entries(lines.data?.levels ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <section className="space-y-2 border-t pt-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">{candidate ? '확정하면 적용될' : '이 규칙이 적용되는'} 대사 {lines.data?.count ?? '…'}개</h3>
        {!!lines.data?.count && !candidate && (
          <RunDialog
            projectId={projectId}
            unitIds={lines.data.unitIds}
            defaultIgnoreStatus
            preferWorkflow={SPEECH_FIX_WORKFLOW}
            trigger={
              <Button size="sm" variant="outline">
                <Play /> 다시 실행
              </Button>
            }
          />
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        청자가 정해진 이 쌍의 대사(대사 그래프에서 이 구간 시작을 반드시 거친 뒤, 다음 구간 전까지. 루트에 따라 다르면 대본 순서 기준)입니다. 규칙을 고쳤다면 “{SPEECH_FIX_WORKFLOW}”로 이 대사들의 어미·호칭만 다시 맞추세요.
      </p>
      {!!lines.data?.routeDependent && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          이 중 {lines.data.routeDependent.toLocaleString()}개는 구간 시작을 거쳤는지가 루트에 따라 달라, 대본 순서로 이 규칙을 골랐습니다. 번역은 한 줄에 하나라 루트 하나에만 맞을 수 있으니 확인하세요.
        </p>
      )}
      {levels.length > 0 && (
        <p className="text-xs">
          지금 번역의 말투(어미 추정):{' '}
          {levels.map(([level, count]) => `${level === 'unknown' ? '판단 불가·번역 없음' : SPEECH_LEVEL_LABELS[level as SpeechLevel]} ${count}`).join(' · ')}
        </p>
      )}
      <ul className="max-h-60 space-y-1 overflow-auto">
        {lines.data?.rows.map((line) => (
          <li key={line.id}>
            <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: line.groupId, line: line.id }} className="block rounded px-2 py-1 text-xs hover:bg-muted">
              <span className="text-muted-foreground">{line.groupTitle} · </span>
              {line.source}
              {line.translation && <span className="block text-muted-foreground">{line.translation}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RelationshipChanges({ projectId, changes }: { projectId: string; changes: { at: string; change: string; cause: string }[] }) {
  const lines = useQuery(q.linesByKeys(projectId, changes.map((change) => change.at)));
  if (!changes.length) return null;
  const byKey = new Map(lines.data?.map((line) => [line.key, line]));
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground">관계 변화</h3>
      <ul className="space-y-2">
        {changes.map((change) => {
          const line = byKey.get(change.at);
          return (
            <li key={`${change.at}-${change.change}`} className="rounded border p-2 text-xs">
              <p>{change.change}</p>
              {change.cause && <p className="text-muted-foreground">계기: {change.cause}</p>}
              {line && (
                <Link to="/p/$projectId/script" params={{ projectId }} search={{ group: line.groupId, line: line.id }} className="mt-1 block text-muted-foreground hover:underline">
                  {line.speaker && `${line.speaker}: `}
                  {line.source}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
