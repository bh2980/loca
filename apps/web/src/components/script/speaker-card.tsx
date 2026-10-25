import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { listenerLabel, personLabel, SPEECH_LEVEL_LABELS, SPECIAL_LISTENERS, styleNames } from '@tw/shared';
import { Box, HoverCard, HoverCardTrigger, Inline, ScriptSpeakerCardContent, ScriptSpeakerCardLink, ScriptSpeakerProfile, Stack, Text } from '@loca/ui';
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
      <ScriptSpeakerCardContent align="start" onClick={(event) => event.stopPropagation()}>
        <SpeakerInfo projectId={projectId} name={name} />
      </ScriptSpeakerCardContent>
    </HoverCard>
  );
}

function SpeakerInfo({ projectId, name }: { projectId: string; name: string }) {
  const characters = useQuery(q.characters(projectId));
  const rules = useQuery(q.speechRules(projectId));
  const lower = name.toLowerCase();
  const character = characters.data?.characters.find((item) => item.name.toLowerCase() === lower || item.aliases.some((alias) => alias.toLowerCase() === lower));
  const own = (rules.data ?? []).filter((rule) => rule.fromName.toLowerCase() === (character?.name ?? name).toLowerCase());
  const pending = (status: string) => status !== 'confirmed' && <Text variant="caption" tone="muted"> · 확인 전</Text>;
  return (
    <>
      <Inline as="p" minWidth={0} gap="condensed" weight="semibold">
        <Text truncate>{character?.name ?? name}</Text>
        {character && personLabel(character) && <Text variant="caption" weight="normal" tone="muted"> · {personLabel(character)}</Text>}
        {character && pending(character.status)}
      </Inline>
      {character?.profile ? (
        <ScriptSpeakerProfile>{character.profile}</ScriptSpeakerProfile>
      ) : null}
      {character?.speech && (
        <Text as="p" lines={2}>
          <Text variant="caption" tone="muted">말버릇 </Text>
          {character.speech}
        </Text>
      )}
      {styleNames(character?.style).length > 0 && (
        <p>
          <Text variant="caption" tone="muted">문체 </Text>
          {styleNames(character?.style).join(' · ')}
        </p>
      )}
      {own.length > 0 && (
        <Box as="ul" spaceY="hair" border="top" paddingTop="condensed">
          {own.map((rule) => (
            <Stack as="li" key={rule.id} direction="row" gap="condensed">
              <Inline as="span" minWidth={0} gap="snug" truncate tone="muted">
                → {listenerLabel(rule.toName)}
              </Inline>
              <Text marginLeft="auto" shrink={false}>
                {SPEECH_LEVEL_LABELS[rule.level]}
                {rule.address && ` · “${rule.address}”`}
                {pending(rule.status)}
              </Text>
            </Stack>
          ))}
        </Box>
      )}
      <ScriptSpeakerCardLink>
        <Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ tab: 'people', display: 'characters', ...(character && { item: character.id }) }}>
          인물 보기
        </Link>
      </ScriptSpeakerCardLink>
    </>
  );
}
