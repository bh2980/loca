import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { listenerLabel, personLabel, SPEECH_LEVEL_LABELS, SPECIAL_LISTENERS, styleNames } from '@tw/shared';
import { Box, HoverCard, HoverCardContent, HoverCardTrigger, Inline, Stack, Text } from '@loca/ui';
import { useCharacters, useSpeechRules } from '@/lib/knowledge';

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
      <Box asChild width="popover" spaceY="condensed" variant="body">
        <HoverCardContent align="start" onClick={(event) => event.stopPropagation()}>
          <SpeakerInfo projectId={projectId} name={name} />
        </HoverCardContent>
      </Box>
    </HoverCard>
  );
}

function SpeakerInfo({ projectId, name }: { projectId: string; name: string }) {
  const characters = useCharacters(projectId);
  const rules = useSpeechRules(projectId);
  const lower = name.toLowerCase();
  const character = characters.data?.find((item) => item.name.toLowerCase() === lower || item.aliases.some((alias) => alias.toLowerCase() === lower));
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
        <Text as="p" lines={4}>{character.profile}</Text>
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
              <Inline as="span" minWidth={0} gap="tight" truncate tone="muted">
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
      <Text asChild display="block" variant="caption" tone="muted" underline="hoverOffset">
        <Link to="/p/$projectId/knowledge" params={{ projectId }} search={{ tab: 'people', display: 'characters', ...(character && { item: character.id }) }}>
          인물 보기
        </Link>
      </Text>
    </>
  );
}
