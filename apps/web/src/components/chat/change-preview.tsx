import { AGENT_TOOLS, type AgeBand, type AutoMark, type Gender, personLabel } from '@tw/shared';
import { MarkChip } from '@/components/status';
import { Markdown } from './markdown';

export const LABEL: Record<string, string> = Object.fromEntries(Object.entries(AGENT_TOOLS).map(([name, info]) => [name, info.label]));

/** A readable preview of what an approval-gated tool would change. */
export function ChangePreview({ name, input, pending = true }: { name: string; input: Record<string, unknown>; /** Still waiting for a decision: only then does it say what accepting will do. */ pending?: boolean }) {
  const field = (label: string, value: unknown) =>
    value === undefined || value === '' ? null : (
      <div className="grid grid-cols-[5rem_1fr] gap-2">
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="min-w-0 break-words">{Array.isArray(value) ? value.join(', ') : String(value)}</dd>
      </div>
    );
  const markdown = (value: unknown) =>
    typeof value === 'string' && value ? (
      <div className="prose-chat max-h-64 overflow-auto rounded-md border bg-muted/30 px-3 py-2">
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
          {markdown(input.profile)}
        </dl>
      );
    case 'save_relationship':
      return <dl className="space-y-1">{field('작업', action)}{field('관계', `${input.from} → ${input.to} (${input.kind})`)}{field('양방향', input.mutual ? '예' : '아니오')}{field('설명', input.description)}</dl>;
    case 'save_document':
      return <dl className="space-y-1">{field('작업', action)}{field('제목', input.title)}{field('종류', input.kind)}{field('번역 문맥에 넣기', input.alwaysInclude ? '예' : '아니오')}{markdown(input.body)}</dl>;
    case 'tag_items': {
      const kinds: Record<string, string> = { terms: '용어', characters: '인물', relationships: '관계', speechRules: '말투 규칙', events: '사건', documents: '문서' };
      const names = (value: unknown) => ((value as string[] | undefined) ?? []).map((name) => `#${name.replace(/^#/, '')}`);
      return (
        <dl className="space-y-1">
          {field('대상', `${kinds[input.kind as string] ?? String(input.kind)} ${((input.ids as unknown[] | undefined) ?? []).length}개`)}
          {field('붙이기', names(input.add))}
          {field('떼기', names(input.remove))}
          <p className="text-muted-foreground">다른 태그와 항목 내용은 그대로입니다.</p>
        </dl>
      );
    }
    case 'save_knowledge': {
      const sections = [
        ['characters', '인물', (item: Record<string, unknown>) => String(item.name ?? item.id ?? '')],
        ['relationships', '관계', (item: Record<string, unknown>) => `${String(item.from ?? '?')} → ${String(item.to ?? '?')}${item.kind ? ` (${String(item.kind)})` : ''}`],
        ['speechRules', '말투 규칙', (item: Record<string, unknown>) => (item.fromName ? `${String(item.fromName)} → ${String(item.toName ?? '?')}${item.level ? ` (${String(item.level)})` : ''}` : String(item.id ?? ''))],
        ['events', '사건', (item: Record<string, unknown>) => String(item.title ?? item.id ?? '')],
        ['documents', '문서', (item: Record<string, unknown>) => String(item.title ?? item.id ?? '')],
      ] as const;
      return (
        <div className="max-h-56 space-y-2 overflow-auto">
          {sections.map(([key, label, text]) => {
            const items = (input[key] as Record<string, unknown>[] | undefined) ?? [];
            return items.length ? (
              <div key={key}>
                <p className="font-medium">
                  {label} {items.length}개
                </p>
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
          <p className="text-muted-foreground">항목마다 따로 저장됩니다. 실패한 항목이 있어도 나머지는 저장됩니다.</p>
        </div>
      );
    }
    case 'delete_items': {
      const kinds: Record<string, string> = { terms: '용어', characters: '인물', relationships: '관계', speechRules: '말투 규칙', events: '사건', documents: '문서', tags: '태그' };
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
      const labels: Record<string, string> = { name: '이름', description: '설명', formatRules: '서식 규칙', aiConfirm: 'AI 확인', editorAi: '편집기 AI', markColors: '표시 색' };
      return (
        <dl className="space-y-1">
          {Object.entries(input).map(([key, value]) => (
            <div key={key} className="grid grid-cols-[5rem_1fr] gap-2">
              <dt className="text-muted-foreground">{labels[key] ?? key}</dt>
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
          {pending && <p className="text-muted-foreground">수락하면 한 번에 반영됩니다. 그사이 다른 곳에서 바뀐 대사는 덮어쓰지 않고 건너뜁니다.</p>}
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
            <dt className="text-muted-foreground">범위</dt>
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
      return <dl className="space-y-1">{field('요약', input.description)}<p className="text-muted-foreground">AI 번역 노드가 이 장면의 문맥으로 받습니다.</p></dl>;
    case 'edit_workflow_node': {
      const value = input.field === 'expression' ? JSON.stringify(input.value, null, 2) : String(input.value ?? '');
      return (
        <dl className="space-y-1">
          {field('노드', input.nodeId)}
          {field('항목', { instructions: '지시문', expression: '조건식', code: '스크립트 코드' }[input.field as string])}
          {field('설명', input.description)}
          <pre className="max-h-64 overflow-auto rounded-md border bg-muted/30 p-2 text-xs whitespace-pre-wrap">{value}</pre>
        </dl>
      );
    }
    default:
      return <pre className="max-h-48 overflow-auto text-xs">{JSON.stringify(input, null, 2)}</pre>;
  }
}
