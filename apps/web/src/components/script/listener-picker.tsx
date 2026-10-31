import { useState } from 'react';
import { isUnsureListener, listenerLabel, type ListenerOrigin, SPECIAL_LISTENERS } from '@tw/shared';
import { Input, ScriptInlineListenerTrigger, Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue, Text } from '@loca/ui';

const LISTENER_ORIGIN_LABELS: Record<ListenerOrigin, string> = { import: '가져오기', ai: 'AI 추정', human: '사람' };
const TYPE_NAME = '__type';

/**
 * Who the line addresses. Offered nearest first: the scene's other speakers (extras such as SWAT
 * included) and names typed there before, then a group / the public / themself, then the rest of
 * the cast; any other name can be typed. An unsure guess shows as 미상 with what was guessed.
 */
export function ListenerPicker({ line, cast, onPick, inline = false, arrow = true }: {
  line: { speaker: string | null; listener: string | null; listenerOrigin: ListenerOrigin | null; listenerConfidence: number | null; sceneNames?: string[] };
  cast: { name: string; player: boolean }[];
  onPick: (listener: string | null) => void;
  /** In a line's speaker row: the listener itself is the trigger, and the origin hint is its tooltip. */
  inline?: boolean;
  /** Inline: the trigger writes "→" before the name. Off where the arrow stands outside the control. */
  arrow?: boolean;
}) {
  const [typing, setTyping] = useState<string | null>(null);
  const unsure = isUnsureListener(line);
  const value = !line.listener || unsure ? '-' : line.listener;
  const scene = line.sceneNames ?? [];
  const rest = cast.filter((person) => !scene.includes(person.name) && person.name !== line.speaker);
  const listed = new Set([...scene, ...rest.map((person) => person.name), ...Object.keys(SPECIAL_LISTENERS)]);
  const confidence = (line.listenerConfidence ?? 0).toFixed(2);
  const listenerIsPerson = !unsure && Boolean(line.listener) && !Object.hasOwn(SPECIAL_LISTENERS, line.listener!);
  const hint = !line.listenerOrigin
    ? null
    : unsure
      ? `AI 추정: ${listenerLabel(line.listener!)} (${confidence}, 낮아서 미상)`
      : `${LISTENER_ORIGIN_LABELS[line.listenerOrigin]}${line.listenerOrigin === 'ai' ? ` · ${confidence}` : ''}`;

  if (typing !== null)
    return (
      <Input
        size={inline ? 'xs' : 'sm'}
        width={inline ? 'field' : 'field-lg'}
        autoFocus
        value={typing}
        onChange={(event) => setTyping(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && typing.trim()) {
            onPick(typing.trim());
            setTyping(null);
          } else if (event.key === 'Escape') setTyping(null);
        }}
        onBlur={() => setTyping(null)}
        placeholder="이름"
        aria-label="청자 이름"
      />
    );
  return (
    <>
      <Select value={value} onValueChange={(next) => (next === TYPE_NAME ? setTyping('') : onPick(next === '-' ? null : next))}>
        {inline ? (
          // Reads as the speaker row's text; the small chevron says it can be changed.
          <ScriptInlineListenerTrigger
            aria-label="청자 바꾸기"
            onClick={(event) => event.stopPropagation()}
            unknown={value === '-'}
            arrow={arrow}
            label={value === '-' ? '청자 미상' : listenerLabel(value)}
          />
        ) : (
          <SelectTrigger width="field-lg" aria-label="청자">
            <SelectValue />
          </SelectTrigger>
        )}
        {/* Inline, the default item-aligned placement lands off screen; open below the text instead. */}
        <SelectContent {...(inline && { position: 'popper' as const, align: 'start' as const })}>
          <SelectItem value="-"><span>청자 미상</span></SelectItem>
          {scene.length > 0 && (
            <SelectGroup>
              <SelectLabel>이 장면 인물</SelectLabel>
              {scene.map((name) => (
                <SelectItem key={name} value={name}>
                  <Text truncate>{name}</Text>
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          <SelectGroup>
            <SelectLabel>여럿 · 혼잣말</SelectLabel>
            {Object.entries(SPECIAL_LISTENERS).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectGroup>
          {rest.length > 0 && (
            <SelectGroup>
              <SelectLabel>다른 인물</SelectLabel>
              {rest.map((person) => (
                <SelectItem key={person.name} value={person.name}>
                  <Text truncate>{person.name}</Text>
                  {person.player && ' · 플레이어'}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {value !== '-' && !listed.has(value) && <SelectItem value={value}><Text truncate>{value}</Text></SelectItem>}
          <SelectItem value={TYPE_NAME}>직접 입력…</SelectItem>
        </SelectContent>
      </Select>
      {hint && !inline && <Text variant="caption" tone={unsure ? 'warning' : 'muted'}>{hint}</Text>}
    </>
  );
}
