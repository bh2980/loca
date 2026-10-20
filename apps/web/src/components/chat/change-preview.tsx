import { AGENT_TOOLS, type AgeBand, type AutoMark, type Gender, personLabel, CHARACTER_ROLE_LABELS, type CharacterRole } from '@tw/shared';
import { MarkChip } from '@/components/status';
import { GroupHeading } from '@loca/ui';
import { Markdown } from './markdown';

export const LABEL: Record<string, string> = Object.fromEntries(Object.entries(AGENT_TOOLS).map(([name, info]) => [name, info.label]));

/** A readable preview of what an approval-gated tool would change. */
export function ChangePreview({ name, input, pending = true }: { name: string; input: Record<string, unknown>; /** Still waiting for a decision: only then does it say what accepting will do. */ pending?: boolean }) {
  const field = (label: string, value: unknown) =>
    value === undefined || value === '' ? null : (
      <div className="grid grid-cols-[5rem_1fr] gap-2">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="min-w-0 break-words">{Array.isArray(value) ? value.join(', ') : String(value)}</dd>
      </div>
    );
  const markdown = (value: unknown) =>
    typeof value === 'string' && value ? (
      <div className="prose-chat max-h-64 overflow-auto rounded-md border bg-muted px-3 py-2">
        <Markdown>{value}</Markdown>
      </div>
    ) : null;
  const action = input.id ? '수정' : '새로 만들기';
  switch (name) {
    case 'save_character':
      return (
        <dl className="space-y-1">
          {field('작업', action)}
          {field('이름', input.name)}
          {field('별칭', input.aliases)}
          {input.gender || input.ageBand ? field('성별·나이', personLabel(input as { gender?: Gender; ageBand?: AgeBand }) || '모름') : null}
          {input.role ? field('역할', CHARACTER_ROLE_LABELS[input.role as CharacterRole]) : null}
          {markdown(input.profile)}
        </dl>
      );
    case 'save_relationship':
      return <dl className="space-y-1">{field('작업', action)}{field('관계', `${input.from} → ${input.to} (${input.kind})`)}{field('쌍방', input.mutual ? '예' : '아니오')}{field('설명', input.description)}</dl>;
    case 'save_document':
      return <dl className="space-y-1">{field('작업', action)}{field('제목', input.title)}{field('종류', input.kind)}{field('문맥에 넣기', input.alwaysInclude ? '예' : '아니오')}{markdown(input.body)}</dl>;
    case 'tag_items': {
      const kinds: Record<string, string> = { terms: '용어', characters: '인물', relationships: '관계', speechRules: '말투 규칙', events: '사건', documents: '노트' };
      const names = (value: unknown) => ((value as string[] | undefined) ?? []).map((name) => `#${name.replace(/^#/, '')}`);
      return (
        <dl className="space-y-1">
          {field('대상', `${kinds[input.kind as string] ?? String(input.kind)} ${((input.ids as unknown[] | undefined) ?? []).length}개`)}
          {field('붙이기', names(input.add))}
          {field('떼기', names(input.remove))}
        </dl>
      );
    }
    case 'save_knowledge': {
      const sections = [
        ['characters', '인물', (item: Record<string, unknown>) => String(item.name ?? item.id ?? '')],
        ['relationships', '관계', (item: Record<string, unknown>) => `${String(item.from ?? '?')} → ${String(item.to ?? '?')}${item.kind ? ` (${String(item.kind)})` : ''}`],
        ['speechRules', '말투 규칙', (item: Record<string, unknown>) => (item.fromName ? `${String(item.fromName)} → ${String(item.toName ?? '?')}${item.level ? ` (${String(item.level)})` : ''}` : String(item.id ?? ''))],
        ['events', '사건', (item: Record<string, unknown>) => String(item.title ?? item.id ?? '')],
        ['documents', '노트', (item: Record<string, unknown>) => String(item.title ?? item.id ?? '')],
      ] as const;
      return (
        <div className="max-h-56 space-y-2 overflow-auto">
          {sections.map(([key, label, text]) => {
            const items = (input[key] as Record<string, unknown>[] | undefined) ?? [];
            return items.length ? (
              <div key={key}>
                <GroupHeading>
                  {label} {items.length}개
                </GroupHeading>
                <ul className="space-y-0.5">
                  {items.map((item, index) => (
                    <li key={index}>
                      {item.id ? '수정' : '추가'} · {text(item)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null;
          })}
        </div>
      );
    }
    case 'delete_items': {
      const kinds: Record<string, string> = { terms: '용어', characters: '인물', relationships: '관계', speechRules: '말투 규칙', events: '사건', documents: '노트', tags: '태그' };
      const ids = (input.ids as string[] | undefined) ?? [];
      return (
        <dl className="space-y-1">
          {field('삭제', `${kinds[input.kind as string] ?? String(input.kind)} ${ids.length}개`)}
          {field('이유', input.reason)}
          {field('id', ids.slice(0, 10).join(', ') + (ids.length > 10 ? ` 외 ${ids.length - 10}개` : ''))}
          {pending && <p className="text-destructive">수락하면 바로 지워지고 되돌릴 수 없습니다. 이 항목에 걸린 관계·태그 연결도 함께 지워집니다.</p>}
        </dl>
      );
    }
    case 'update_project_settings': {
      const labels: Record<string, string> = { name: '이름', description: '설명', formatRules: '서식 규칙', aiAutoConfirm: 'AI 문맥', editorAi: '편집기 AI', markColors: '표시 색' };
      return (
        <dl className="space-y-1">
          {Object.entries(input).map(([key, value]) => (
            <div key={key} className="grid grid-cols-[5rem_1fr] gap-2">
              <dt className="text-xs text-muted-foreground">{labels[key] ?? key}</dt>
              <dd className="min-w-0 break-words">{typeof value === 'string' ? value : <pre className="max-h-32 overflow-auto text-xs whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>}</dd>
            </div>
          ))}
        </dl>
      );
    }
    case 'save_status': {
      const places: Record<string, string> = { lines: '대사', knowledge: '자료', terms: '용어집' };
      return (
        <dl className="space-y-1">
          {field('만들기', input.type === 'tag' ? `태그 #${String(input.name)}` : `상태 ${String(input.name)}`)}
          {input.type === 'tag' && field('붙는 곳', ((input.scope as string[] | undefined) ?? ['lines', 'knowledge', 'terms']).map((place) => places[place] ?? place))}
        </dl>
      );
    }
    case 'update_status':
      return <dl className="space-y-1">{field('상태', input.id)}{field('이름', input.name)}{field('종류', input.kind)}{field('색', input.color)}{field('검토', input.inReview === undefined ? undefined : input.inReview ? '검토 필요' : '검토 불필요')}</dl>;
    case 'delete_status':
      return <dl className="space-y-1">{field('삭제할 상태', input.ids)}{field('대사를 옮길 상태', input.moveTo)}{pending && <p className="text-destructive">대사의 상태가 바뀌고 상태를 삭제합니다.</p>}</dl>;
    case 'update_tag':
      return <dl className="space-y-1">{field('태그', input.id)}{field('이름', input.name)}{field('색', input.color)}{field('붙는 곳', input.scope)}</dl>;
    case 'delete_tag':
      return <dl className="space-y-1">{field('삭제할 태그', input.ids)}{pending && <p className="text-destructive">항목에 붙은 태그도 함께 제거됩니다.</p>}</dl>;
    case 'delete_workflow':
      return <dl className="space-y-1">{field('삭제할 워크플로', input.id)}{pending && <p className="text-destructive">워크플로와 실행 계획을 삭제합니다.</p>}</dl>;
    case 'create_group':
      return <dl className="space-y-1">{field('종류', { scene: '장면', document: '문서 묶음', ui: 'UI 묶음' }[input.kind as string])}{field('제목', input.title)}{field('키', input.key)}{field('설명', input.description)}<p className="text-muted-foreground">묶음만 추가합니다. 원문이나 그래프 연결은 만들지 않습니다.</p></dl>;
    case 'update_group':
      return <dl className="space-y-1">{field('묶음', input.groupId)}{field('제목', input.title)}{field('키', input.key)}{field('설명', input.description)}{field('구역', input.section)}</dl>;
    case 'delete_group':
      return <dl className="space-y-1">{field('삭제할 묶음', input.groupId)}{pending && <p className="text-destructive">묶음과 안의 원문을 모두 삭제합니다.</p>}</dl>;
    case 'create_unit':
      return <dl className="space-y-1">{field('묶음', input.groupId)}{field('키', input.key)}{field('화자', input.speaker)}{field('청자', input.listener)}{field('원문', input.source)}<p className="text-muted-foreground">새 원문 항목이며 번역 후보가 아닙니다.</p></dl>;
    case 'update_unit':
      return <dl className="space-y-1">{field('원문 항목', input.unitId)}{field('묶음', input.groupId)}{field('키', input.key)}{field('화자', input.speaker)}{field('청자', input.listener)}{field('원문', input.source)}</dl>;
    case 'delete_units': {
      const ids = (input.ids as unknown[] | undefined) ?? [];
      return <dl className="space-y-1">{field('삭제', `원문 대사 ${ids.length}개`)}{field('id', ids.slice(0, 10).join(', ') + (ids.length > 10 ? ` 외 ${ids.length - 10}개` : ''))}{pending && <p className="text-destructive">원문 대사와 번역, 후보가 삭제됩니다. 되돌릴 수 없습니다.</p>}</dl>;
    }
    case 'save_terms': {
      const terms = (input.terms as { source: string; target: string; id?: string }[]) ?? [];
      return (
        <ul className="max-h-48 space-y-0.5 overflow-auto">
          {terms.map((term, index) => (
            <li key={index}>
              {term.id ? '수정' : '추가'} · <b>{term.source}</b> → {term.target || '(번역 없음)'}
            </li>
          ))}
        </ul>
      );
    }
    case 'save_workflow': {
      const definition = input.definition as { nodes?: { type: string; label?: string }[]; edges?: unknown[] } | undefined;
      return (
        <dl className="space-y-1">
          {field('작업', action)}
          {field('이름', input.name)}
          {field('노드', definition?.nodes?.map((node) => node.label ?? node.type))}
          {field('연결', definition?.edges?.length)}
        </dl>
      );
    }
    case 'propose_changes': {
      const changes = (input.changes as { key: string; translation?: string; status?: string; addTags?: string[]; removeTags?: string[] }[] | undefined) ?? [];
      // A large batch arrives as its first lines plus counts (see routes/proposals.ts).
      const counts = input.counts as { lines: number; translations: number; statuses: number; tagged: number } | undefined;
      const translations = counts?.translations ?? changes.filter((change) => change.translation !== undefined).length;
      const statuses = counts?.statuses ?? changes.filter((change) => change.status).length;
      const tagged = counts?.tagged ?? changes.filter((change) => change.addTags?.length || change.removeTags?.length).length;
      return (
        <div className="space-y-2">
          <p>
            대사 <b>{(counts?.lines ?? changes.length).toLocaleString()}</b>개 · 번역 {translations.toLocaleString()} · 상태 {statuses.toLocaleString()} · 태그 {tagged.toLocaleString()}
            {counts && changes.length < counts.lines && <span className="text-muted-foreground"> · 처음 {changes.length}개만 표시</span>}
          </p>
          <ul className="max-h-56 space-y-1 overflow-auto">
            {changes.slice(0, 50).map((change) => (
              <li key={change.key} className="rounded border px-2 py-1">
                <span className="font-mono text-xs text-muted-foreground">{change.key}</span>
                {change.translation !== undefined && <span className="block">{change.translation}</span>}
                {(change.status || change.addTags?.length || change.removeTags?.length) && (
                  <span className="block text-muted-foreground">
                    {[change.status && `→ ${change.status}`, ...(change.addTags ?? []).map((tag) => `+#${tag}`), ...(change.removeTags ?? []).map((tag) => `−#${tag}`)].filter(Boolean).join(' ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {changes.length > 50 && <p className="text-muted-foreground">외 {changes.length - 50}개</p>}
          {pending && <p className="text-muted-foreground">그사이 바뀐 대사는 덮어쓰지 않고 건너뜁니다.</p>}
        </div>
      );
    }
    case 'start_run': {
      const count = (key: string) => ((input[key] as unknown[] | undefined) ?? []).length;
      const scope = [count('groupIds') && `장면·묶음 ${count('groupIds')}개`, count('unitIds') && `대사 ${count('unitIds')}개`, count('tagIds') && `태그 ${count('tagIds')}개`].filter(Boolean).join(', ');
      const marks = (input.marks as AutoMark[] | undefined) ?? [];
      return (
        <dl className="space-y-1">
          {field('워크플로', input.workflowId)}
          <div className="grid grid-cols-[5rem_1fr] gap-2">
            <dt className="text-xs text-muted-foreground">범위</dt>
            <dd className="flex min-w-0 flex-wrap items-center gap-1 break-words">
              {scope || marks.length === 0 ? scope || '진입 조건에 맞는 모든 대사' : null}
              {marks.map((mark) => (
                <MarkChip key={mark} mark={mark} />
              ))}
            </dd>
          </div>
          {field('상태 조건', input.ignoreStatus ? '무시하고 실행' : '진입 상태에 맞는 대사만')}
          {pending && <p className="text-muted-foreground">수락하면 바로 실행이 시작되고 AI 호출 비용이 듭니다.</p>}
        </dl>
      );
    }
    case 'propose_translation':
      return <dl className="space-y-1">{field('번역', input.text)}{field('메모', input.note)}</dl>;
    case 'save_group_summary':
      return <dl className="space-y-1">{field('요약', input.description)}</dl>;
    case 'edit_workflow_node': {
      const value = input.field === 'expression' ? JSON.stringify(input.value, null, 2) : String(input.value ?? '');
      return (
        <dl className="space-y-1">
          {field('노드', input.nodeId)}
          {field('항목', { instructions: '지시문', expression: '조건식', code: '스크립트 코드' }[input.field as string])}
          {field('설명', input.description)}
          <pre className="max-h-64 overflow-auto rounded-md border bg-muted p-2 text-xs whitespace-pre-wrap">{value}</pre>
        </dl>
      );
    }
    default:
      return <pre className="max-h-48 overflow-auto text-xs">{JSON.stringify(input, null, 2)}</pre>;
  }
}
