import { AGENT_TOOLS, APP_DEFAULT_SECTION_LABELS, type AppDefaultSection, type AgeBand, type AutoMark, type Gender, personLabel, CHARACTER_ROLE_LABELS, type CharacterRole } from '@tw/shared';
import { MarkChip } from '@/components/status';
import { Box, Markdown, Grid, Inline, Text, SectionHeading } from '@loca/ui';

export const LABEL: Record<string, string> = Object.fromEntries(Object.entries(AGENT_TOOLS).map(([name, info]) => [name, info.label]));

/** What the server knows about a proposal beyond its input (names for ids, old values): see services/proposal-details.ts. */
export interface ProposalDetails {
  items: { kind: string; action: '수정' | '추가'; label: string; changes: { field: string; before?: string; after: string }[] }[];
  refs: Record<string, string>;
}
const KIND_NAME: Record<string, string> = { characters: '인물', relationships: '관계', speechRules: '말투 규칙', events: '사건', documents: '노트' };

/** Each saved item as who it is, then field by field what it was and what it becomes. */
function KnowledgeChanges({ items }: { items: ProposalDetails['items'] }) {
  return (
    <Box as="ul" maxHeight="scroll" spaceY="condensed" overflow="auto">
      {items.map((item, index) => (
        <li key={index}>
          <Text as="p" weight="medium">
            {item.action} · {KIND_NAME[item.kind] ?? item.kind} · {item.label || '(이름 없음)'}
          </Text>
          {item.changes.length ? (
            <Box as="dl" spaceY="tight">
              {item.changes.map((change) => (
                <Grid key={change.field} columns="field" gap="condensed">
                  <Text as="dt" variant="caption" tone="muted">{change.field}</Text>
                  <Box as="dd" minWidth={0}>
                    {change.before !== undefined && <Text as="p" tone="muted" breakWords preserveLines>{change.before}</Text>}
                    <Text as="p" breakWords preserveLines>{change.before !== undefined ? '→ ' : ''}{change.after}</Text>
                  </Box>
                </Grid>
              ))}
            </Box>
          ) : (
            <Text as="p" variant="caption" tone="muted">바뀌는 내용이 없습니다.</Text>
          )}
        </li>
      ))}
    </Box>
  );
}

/** A readable preview of what an approval-gated tool would change. */
export function ChangePreview({ name, input, pending = true, details }: { name: string; input: Record<string, unknown>; /** Still waiting for a decision: only then does it say what accepting will do. */ pending?: boolean; details?: ProposalDetails | null }) {
  // An id the project can name is shown as its name.
  const named = (value: unknown) => (typeof value === 'string' ? (details?.refs[value] ?? value) : value);
  const field = (label: string, value: unknown) =>
    value === undefined || value === '' ? null : (
      <Grid columns="field" gap="condensed">
        <Text as="dt" variant="caption" tone="muted">{label}</Text>
        <Text as="dd" minWidth={0} breakWords>{Array.isArray(value) ? value.map(named).join(', ') : String(named(value))}</Text>
      </Grid>
    );
  if (details?.items.length && ['save_knowledge', 'save_character', 'save_relationship', 'save_speech_rule', 'save_event', 'save_document'].includes(name)) return <KnowledgeChanges items={details.items} />;
  const markdown = (value: unknown) =>
    typeof value === 'string' && value ? (
      <Markdown framed>{value}</Markdown>
    ) : null;
  const action = input.id ? '수정' : '새로 만들기';
  switch (name) {
    case 'save_character':
      return (
        <Box as="dl" spaceY="tight">
          {field('작업', action)}
          {field('이름', input.name)}
          {field('별칭', input.aliases)}
          {input.gender || input.ageBand ? field('성별·나이', personLabel(input as { gender?: Gender; ageBand?: AgeBand }) || '모름') : null}
          {input.role ? field('역할', CHARACTER_ROLE_LABELS[input.role as CharacterRole]) : null}
          {markdown(input.profile)}
        </Box>
      );
    case 'save_relationship':
      return <Box as="dl" spaceY="tight">{field('작업', action)}{field('관계', `${input.from} → ${input.to} (${input.kind})`)}{field('쌍방', input.mutual ? '예' : '아니오')}{field('설명', input.description)}</Box>;
    case 'save_document':
      return <Box as="dl" spaceY="tight">{field('작업', action)}{field('제목', input.title)}{field('종류', input.kind)}{field('문맥에 넣기', input.alwaysInclude ? '예' : '아니오')}{markdown(input.body)}</Box>;
    case 'tag_items': {
      const kinds: Record<string, string> = { terms: '용어', characters: '인물', relationships: '관계', speechRules: '말투 규칙', events: '사건', documents: '노트' };
      const names = (value: unknown) => ((value as string[] | undefined) ?? []).map((name) => `#${name.replace(/^#/, '')}`);
      return (
        <Box as="dl" spaceY="tight">
          {field('대상', `${kinds[input.kind as string] ?? String(input.kind)} ${((input.ids as unknown[] | undefined) ?? []).length}개`)}
          {field('붙이기', names(input.add))}
          {field('떼기', names(input.remove))}
        </Box>
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
        <Box maxHeight="scroll" spaceY="condensed" overflow="auto">
          {sections.map(([key, label, text]) => {
            const items = (input[key] as Record<string, unknown>[] | undefined) ?? [];
            return items.length ? (
              <div key={key}>
                <SectionHeading level="group">
                  {label} {items.length}개
                </SectionHeading>
                <Box as="ul" spaceY="hair">
                  {items.map((item, index) => (
                    <li key={index}>
                      {item.id ? '수정' : '추가'} · {text(item)}
                    </li>
                  ))}
                </Box>
              </div>
            ) : null;
          })}
        </Box>
      );
    }
    case 'delete_items': {
      const kinds: Record<string, string> = { terms: '용어', characters: '인물', relationships: '관계', speechRules: '말투 규칙', events: '사건', documents: '노트', tags: '태그' };
      const ids = (input.ids as string[] | undefined) ?? [];
      return (
        <Box as="dl" spaceY="tight">
          {field('삭제', `${kinds[input.kind as string] ?? String(input.kind)} ${ids.length}개`)}
          {field('이유', input.reason)}
          {field('id', ids.slice(0, 10).join(', ') + (ids.length > 10 ? ` 외 ${ids.length - 10}개` : ''))}
          {pending && <Text as="p" tone="danger">수락하면 바로 지워지고 되돌릴 수 없습니다. 이 항목에 걸린 관계·태그 연결도 함께 지워집니다.</Text>}
        </Box>
      );
    }
    case 'pull_app_defaults': {
      const sections = Array.isArray(input.sections) ? (input.sections as AppDefaultSection[]) : [];
      return <Text as="p">홈 기본값에서 가져옴: {sections.map((section) => APP_DEFAULT_SECTION_LABELS[section] ?? section).join(', ')}. 상태·태그·저장한 지시는 없는 이름만 더하고, 워크플로는 새로 더합니다.</Text>;
    }
    case 'update_project_settings': {
      const labels: Record<string, string> = { name: '이름', description: '설명', formatRules: '서식 규칙', aiAutoConfirm: 'AI 문맥', editorAi: '편집기 AI' };
      return (
        <Box as="dl" spaceY="tight">
          {Object.entries(input).map(([key, value]) => (
            <Grid key={key} columns="field" gap="condensed">
              <Text as="dt" variant="caption" tone="muted">{labels[key] ?? key}</Text>
              <Text as="dd" minWidth={0} breakWords>{typeof value === 'string' ? value : <Text as="pre" maxHeight="scroll-sm" overflow="auto" variant="caption" preserveLines>{JSON.stringify(value, null, 2)}</Text>}</Text>
            </Grid>
          ))}
        </Box>
      );
    }
    case 'save_status': {
      const places: Record<string, string> = { lines: '대사', knowledge: '자료', terms: '용어집' };
      return (
        <Box as="dl" spaceY="tight">
          {field('만들기', input.type === 'tag' ? `태그 #${String(input.name)}` : `상태 ${String(input.name)}`)}
          {input.type === 'tag' && field('붙는 곳', ((input.scope as string[] | undefined) ?? ['lines', 'knowledge', 'terms']).map((place) => places[place] ?? place))}
          {input.type === 'tag' && field('설명', input.description)}
        </Box>
      );
    }
    case 'update_status':
      return <Box as="dl" spaceY="tight">{field('상태', input.id)}{field('이름', input.name)}{field('종류', input.kind)}{field('색', input.color)}{field('검토', input.inReview === undefined ? undefined : input.inReview ? '검토 필요' : '검토 불필요')}</Box>;
    case 'delete_status':
      return <Box as="dl" spaceY="tight">{field('삭제할 상태', input.ids)}{field('대사를 옮길 상태', input.moveTo)}{pending && <Text as="p" tone="danger">대사의 상태가 바뀌고 상태를 삭제합니다.</Text>}</Box>;
    case 'update_tag':
      return <Box as="dl" spaceY="tight">{field('태그', input.id)}{field('이름', input.name)}{field('설명', input.description)}{field('색', input.color)}{field('붙는 곳', input.scope)}</Box>;
    case 'delete_tag':
      return <Box as="dl" spaceY="tight">{field('삭제할 태그', input.ids)}{pending && <Text as="p" tone="danger">항목에 붙은 태그도 함께 제거됩니다.</Text>}</Box>;
    case 'delete_workflow':
      return <Box as="dl" spaceY="tight">{field('삭제할 워크플로', input.id)}{pending && <Text as="p" tone="danger">워크플로와 실행 계획을 삭제합니다.</Text>}</Box>;
    case 'create_group':
      return <Box as="dl" spaceY="tight">{field('종류', { scene: '장면', document: '문서 묶음', ui: 'UI 묶음' }[input.kind as string])}{field('제목', input.title)}{field('키', input.key)}{field('설명', input.description)}<Text as="p" tone="muted">묶음만 추가합니다. 원문이나 그래프 연결은 만들지 않습니다.</Text></Box>;
    case 'update_group':
      return <Box as="dl" spaceY="tight">{field('묶음', input.groupId)}{field('제목', input.title)}{field('키', input.key)}{field('설명', input.description)}{field('구역', input.section)}</Box>;
    case 'delete_group':
      return <Box as="dl" spaceY="tight">{field('삭제할 묶음', input.groupId)}{pending && <Text as="p" tone="danger">묶음과 안의 원문을 모두 삭제합니다.</Text>}</Box>;
    case 'create_unit':
      return <Box as="dl" spaceY="tight">{field('묶음', input.groupId)}{field('키', input.key)}{field('화자', input.speaker)}{field('청자', input.listener)}{field('원문', input.source)}<Text as="p" tone="muted">새 원문 항목이며 번역 후보가 아닙니다.</Text></Box>;
    case 'update_unit':
      return <Box as="dl" spaceY="tight">{field('원문 항목', input.unitId)}{field('묶음', input.groupId)}{field('키', input.key)}{field('화자', input.speaker)}{field('청자', input.listener)}{field('원문', input.source)}</Box>;
    case 'delete_units': {
      const ids = (input.ids as unknown[] | undefined) ?? [];
      return <Box as="dl" spaceY="tight">{field('삭제', `원문 대사 ${ids.length}개`)}{field('id', ids.slice(0, 10).join(', ') + (ids.length > 10 ? ` 외 ${ids.length - 10}개` : ''))}{pending && <Text as="p" tone="danger">원문 대사와 번역, 후보가 삭제됩니다. 되돌릴 수 없습니다.</Text>}</Box>;
    }
    case 'save_terms': {
      const terms = (input.terms as { source: string; target: string; id?: string }[]) ?? [];
      return (
        <Box as="ul" maxHeight="scroll-sm" spaceY="hair" overflow="auto">
          {terms.map((term, index) => (
            <li key={index}>
              {term.id ? '수정' : '추가'} · <b>{term.source}</b> → {term.target || '(번역 없음)'}
            </li>
          ))}
        </Box>
      );
    }
    case 'save_workflow': {
      const definition = input.definition as { nodes?: { type: string; label?: string }[]; edges?: unknown[] } | undefined;
      return (
        <Box as="dl" spaceY="tight">
          {field('작업', action)}
          {field('이름', input.name)}
          {field('노드', definition?.nodes?.map((node) => node.label ?? node.type))}
          {field('연결', definition?.edges?.length)}
        </Box>
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
        <Box spaceY="condensed">
          <p>
            대사 <b>{(counts?.lines ?? changes.length).toLocaleString()}</b>개 · 번역 {translations.toLocaleString()} · 상태 {statuses.toLocaleString()} · 태그 {tagged.toLocaleString()}
            {counts && changes.length < counts.lines && <Text tone="muted"> · 처음 {changes.length}개만 표시</Text>}
          </p>
          <Box as="ul" maxHeight="scroll" spaceY="tight" overflow="auto">
            {changes.slice(0, 50).map((change) => (
              <Box as="li" key={change.key} radius="base" border="all" paddingX="condensed" paddingY="tight">
                <Text mono variant="caption" tone="muted">{change.key}</Text>
                {change.translation !== undefined && <Text display="block">{change.translation}</Text>}
                {(change.status || change.addTags?.length || change.removeTags?.length) && (
                  <Text display="block" tone="muted">
                    {[change.status && `→ ${change.status}`, ...(change.addTags ?? []).map((tag) => `+#${tag}`), ...(change.removeTags ?? []).map((tag) => `−#${tag}`)].filter(Boolean).join(' ')}
                  </Text>
                )}
              </Box>
            ))}
          </Box>
          {changes.length > 50 && <Text as="p" tone="muted">외 {changes.length - 50}개</Text>}
          {pending && <Text as="p" tone="muted">그사이 바뀐 대사는 덮어쓰지 않고 건너뜁니다.</Text>}
        </Box>
      );
    }
    case 'start_run': {
      const count = (key: string) => ((input[key] as unknown[] | undefined) ?? []).length;
      const scope = [
        count('groupIds') && `장면·묶음 ${count('groupIds')}개`,
        count('unitIds') && `대사 ${count('unitIds')}개`,
        count('tagIds') && `태그 ${count('tagIds')}개`,
        input.unfinished === true ? '최종 아님' : input.unfinished === false && '최종',
        input.decidedBy && `정한 쪽 ${input.decidedBy === 'ai' ? 'AI' : '사람'}`,
        input.noted === true ? '메모 있음' : input.noted === false && '메모 없음',
        input.emptyTarget === true ? '번역 비어 있음' : input.emptyTarget === false && '번역 있음',
      ].filter(Boolean).join(', ');
      const marks = (input.marks as AutoMark[] | undefined) ?? [];
      return (
        <Box as="dl" spaceY="tight">
          {field('워크플로', input.workflowId)}
          <Grid columns="field" gap="condensed">
            <Text as="dt" variant="caption" tone="muted">범위</Text>
            <Inline as="dd" minWidth={0} wrap gap="tight" breakWords>
              {scope || marks.length === 0 ? scope || '진입 조건에 맞는 모든 대사' : null}
              {marks.map((mark) => (
                <MarkChip key={mark} mark={mark} />
              ))}
            </Inline>
          </Grid>
          {field('상태 조건', input.ignoreStatus ? '무시하고 실행' : '진입 상태에 맞는 대사만')}
          {pending && <Text as="p" tone="muted">수락하면 바로 실행이 시작되고 AI 호출 비용이 듭니다.</Text>}
        </Box>
      );
    }
    case 'continue_run': {
      const models = Object.keys((input.models as Record<string, unknown> | undefined) ?? {}).length;
      return (
        <Box as="dl" spaceY="tight">
          {field('실행', input.runId)}
          {field('실패한 대사', input.retryFailed ? '실패한 단계부터 다시' : '그대로 두기')}
          {models > 0 && field('다른 모델', `AI 단계 ${models}개`)}
          {pending && <Text as="p" tone="muted">수락하면 실행이 이어지고 AI 호출 비용이 듭니다.</Text>}
        </Box>
      );
    }
    case 'propose_translation':
      return <Box as="dl" spaceY="tight">{field('번역', input.text)}{field('메모', input.note)}</Box>;
    case 'decide_suggestion':
      return <Box as="dl" spaceY="tight">{field('대사', input.unitId)}{field('결정', input.decision === 'apply' ? '적용 (현재 번역으로)' : '거절 (이력에만 남김)')}</Box>;
    case 'save_group_summary':
      return <Box as="dl" spaceY="tight">{field('요약', input.description)}</Box>;
    case 'edit_workflow_node': {
      const value = input.field === 'expression' ? JSON.stringify(input.value, null, 2) : String(input.value ?? '');
      return (
        <Box as="dl" spaceY="tight">
          {field('노드', input.nodeId)}
          {field('항목', { instructions: '지시문', expression: '조건식', code: '스크립트 코드' }[input.field as string])}
          {field('설명', input.description)}
          <Text as="pre" maxHeight="scroll" overflow="auto" radius="md" border="all" background="sunken" padding="condensed" variant="caption" preserveLines>{value}</Text>
        </Box>
      );
    }
    default:
      return <Text as="pre" maxHeight="scroll-sm" overflow="auto" variant="caption">{JSON.stringify(input, null, 2)}</Text>;
  }
}
