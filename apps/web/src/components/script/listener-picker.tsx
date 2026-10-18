import { useState } from 'react';
import { isUnsureListener, listenerLabel, type ListenerOrigin, SPECIAL_LISTENERS } from '@tw/shared';
import { Input, Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@loca/ui';
import { cn } from '@/lib/utils';

const LISTENER_ORIGIN_LABELS: Record<ListenerOrigin, string> = { import: '가져오기', scene: '장면 추정', ai: 'AI 추정', human: '사람' };
const TYPE_NAME = '__type';

/**
 * Who the line addresses. Offered nearest first: the scene's other speakers (extras such as SWAT
 * included) and names typed there before, then a group / the public / themself, then the rest of
 * the cast; any other name can be typed. An unsure guess shows as 미상 with what was guessed.
 */
export function ListenerPicker({ line, cast, onPick, inline = false }: {
  line: { speaker: string | null; listener: string | null; listenerOrigin: ListenerOrigin | null; listenerConfidence: number | null; sceneNames?: string[] };
  cast: { name: string; player: boolean }[];
  onPick: (listener: string | null) => void;
  /** In a line's speaker row: the listener itself is the trigger, and the origin hint is its tooltip. */
  inline?: boolean;
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
      ? line.listenerOrigin === 'scene'
        ? `장면 추정: 이 장면에서 주로 ${listenerLabel(line.listener!)}에게 (섞인 장면 · ${confidence})`
        : `AI 추정: ${listenerLabel(line.listener!)} (${confidence}, 낮아서 미상)`
      : `${LISTENER_ORIGIN_LABELS[line.listenerOrigin]}${line.listenerOrigin === 'ai' || line.listenerOrigin === 'scene' ? ` · ${confidence}` : ''}`;

  if (typing !== null)
    return (
      <Input
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
        placeholder="이름 입력 후 Enter"
        className={inline ? 'h-6 w-36 text-xs' : 'w-40'}
        aria-label="청자 이름"
      />
    );
  return (
    <>
      <Select value={value} onValueChange={(next) => (next === TYPE_NAME ? setTyping('') : onPick(next === '-' ? null : next))}>
        {inline ? (
          // Reads as the speaker row's text; the small chevron says it can be changed.
          <SelectTrigger
            aria-label="청자 바꾸기"
            title={hint ? `청자 바꾸기 · ${hint}` : '청자 바꾸기'}
            onClick={(event) => event.stopPropagation()}
            className={cn('h-auto min-w-0 gap-0.5 border-0 data-[size=default]:h-auto bg-transparent p-0 text-xs shadow-none hover:underline dark:bg-transparent dark:hover:bg-transparent [&>svg]:size-3', value === '-' ? 'text-warning' : 'text-muted-foreground')}
          >
            <span className="inline-flex min-w-0 items-center gap-1.5 truncate"><span className="truncate">→ {value === '-' ? '청자 미상' : listenerLabel(value)}</span></span>
          </SelectTrigger>
        ) : (
          <SelectTrigger size="sm" className="w-40" aria-label="청자">
            <SelectValue />
          </SelectTrigger>
        )}
        {/* Inline, the default item-aligned placement lands off screen; open below the text instead. */}
        <SelectContent {...(inline && { position: 'popper' as const, align: 'start' as const })}>
          <SelectItem value="-"><span>청자 미상</span></SelectItem>
          {scene.length > 0 && (
            <SelectGroup>
              <SelectLabel description="가까운 순">이 장면 인물</SelectLabel>
              {scene.map((name) => (
                <SelectItem key={name} value={name}>
                  <span className="truncate">{name}</span>
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
                  <span className="truncate">{person.name}</span>
                  {person.player && ' · 플레이어'}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {value !== '-' && !listed.has(value) && <SelectItem value={value}><span className="truncate">{value}</span></SelectItem>}
          <SelectItem value={TYPE_NAME}>직접 입력…</SelectItem>
        </SelectContent>
      </Select>
      {hint && !inline && <span className={cn('text-xs', unsure ? 'text-warning' : 'text-muted-foreground')}>{hint}</span>}
    </>
  );
}
