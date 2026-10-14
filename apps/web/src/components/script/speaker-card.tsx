import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { listenerLabel, personLabel, SPEECH_LEVEL_LABELS, styleNames } from '@tw/shared';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { q } from '@/lib/queries';

/**
 * Who is speaking, on hover over a speaker's name: the character's profile and how they talk,
 * and their speech rules by listener (the Korean level and form of address). Unconfirmed items
 * are marked. Data loads only when the card opens.
 */
export function SpeakerCard({ projectId, name, children }: { projectId: string; name: string | null; children: ReactNode }) {
  if (!name) return <>{children}</>;
  return (
    <HoverCard openDelay={250} closeDelay={100}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent align="start" className="w-80 space-y-2 text-sm" onClick={(event) => event.stopPropagation()}>
        <SpeakerInfo projectId={projectId} name={name} />
      </HoverCardContent>
    </HoverCard>
  );
}

function SpeakerInfo({ projectId, name }: { projectId: string; name: string }) {
  const characters = useQuery(q.characters(projectId));
  const rules = useQuery(q.speechRules(projectId));
  const lower = name.toLowerCase();
  const character = characters.data?.characters.find((item) => item.name.toLowerCase() === lower || item.aliases.some((alias) => alias.toLowerCase() === lower));
  const own = (rules.data ?? []).filter((rule) => rule.fromName.toLowerCase() === (character?.name ?? name).toLowerCase());
  const pending = (status: string) => status !== 'confirmed' && <span className="text-xs text-muted-foreground"> · 확인 전</span>;
  return (
    <>
      <p className="font-medium">
        {character?.name ?? name}
        {character && personLabel(character) && <span className="text-xs font-normal text-muted-foreground"> · {personLabel(character)}</span>}
        {character && pending(character.status)}
      </p>
      {character?.profile ? (
        <p className="line-clamp-4 text-muted-foreground">{character.profile}</p>
      ) : (
        <p className="text-muted-foreground">{character ? '프로필이 비어 있습니다.' : '인물로 등록돼 있지 않습니다.'}</p>
      )}
      {character?.speech && (
        <p className="line-clamp-2">
          <span className="text-xs text-muted-foreground">말버릇 </span>
          {character.speech}
        </p>
      )}
      {styleNames(character?.style).length > 0 && (
        <p>
          <span className="text-xs text-muted-foreground">문체 </span>
          {styleNames(character?.style).join(' · ')}
        </p>
      )}
      {own.length > 0 && (
        <ul className="space-y-0.5 border-t pt-2">
          {own.map((rule) => (
            <li key={rule.id} className="flex gap-2">
              <span className="min-w-0 truncate text-muted-foreground">→ {listenerLabel(rule.toName)}</span>
              <span className="ml-auto shrink-0">
                {SPEECH_LEVEL_LABELS[rule.level]}
                {rule.address && ` · “${rule.address}”`}
                {pending(rule.status)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ tab: 'people', ...(character && { item: character.id }) }} className="block text-xs text-muted-foreground underline-offset-2 hover:underline">
        인물·관계에서 보기
      </Link>
    </>
  );
}
