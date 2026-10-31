import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { SPECIAL_LISTENERS, SPEECH_LEVELS, SPEECH_LEVEL_LABELS, type SpeechLevel } from '@tw/shared';
import { Button, Grid, Input, Popover, PopoverTrigger, Combobox, Select, SelectContent, SelectItem, SelectValue, type ComboboxOption, SelectTrigger, PopoverContent, Box, KeyValue, KeyValueRow } from '@loca/ui';
import { client } from '@/lib/api';
import { pairKey } from '@tw/shared';
import type { Pair } from './pairs';
import { sent } from '@/lib/collections';

/** The picker value that means "a person who is not in the list yet": a name is typed instead. */
const NEW = '\u0000new';
/** Default relationship kind when a relationship is created without one typed (the same word the pair pane uses). */
const DEFAULT_KIND = '관계';

interface Person {
  id: string;
  name: string;
}

/** One end of the pair: a picked person, or a new name; listeners can also be 여럿 / 불특정 다수 / 혼잣말 / 그 밖의 인물. */
function End({ label, value, name, onValue, onName, options, placeholder }: { label: string; value: string; name: string; onValue: (value: string) => void; onName: (name: string) => void; options: ComboboxOption[]; placeholder: string }) {
  return (
    <KeyValueRow label={label}>
     <Grid gap="condensed">
      <Combobox ariaLabel={label} value={value} onValueChange={onValue} options={options} placeholder={placeholder} searchPlaceholder="이름 검색" />
      {value === NEW && <Input aria-label={`${label} 새 이름`} autoFocus value={name} onChange={(event) => onName(event.target.value)} placeholder="새 인물 이름" />}
     </Grid>
    </KeyValueRow>
  );
}

/**
 * 관계 표 / 그래프의 “+ 관계·말투”: picks a speaker and a listener (people, new names, or a special
 * listener), a speech level and optionally a relationship kind. Creates the missing people, the speech
 * rule and, when both ends are people, the relationship; then opens the pair.
 */
export function AddPairPopover({ projectId, characters, pairs, onCreated }: { projectId: string; characters: Person[]; pairs: Pair[]; onCreated: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [fromName, setFromName] = useState('');
  const [to, setTo] = useState('');
  const [toName, setToName] = useState('');
  const [level, setLevel] = useState<SpeechLevel>('haeyo');
  const [kind, setKind] = useState('');

  const people: ComboboxOption[] = characters.map((c) => ({ value: c.id, label: c.name }));
  const fromOptions = [...people, { value: NEW, label: '새 인물…' }];
  const toOptions = [
    ...people,
    { value: NEW, label: '새 인물…' },
    ...Object.entries(SPECIAL_LISTENERS).map(([key, label]) => ({ value: key, label: `${label} (${key})`, searchText: key })),
  ];
  const isPerson = (value: string) => characters.some((c) => c.id === value);
  const toSpecial = to !== '' && to !== NEW && !isPerson(to);
  const fromTyped = fromName.trim();
  const toTyped = toName.trim();
  const ready = (from !== '' && (from !== NEW || fromTyped !== '')) && (to !== '' && (to !== NEW || toTyped !== ''));

  const reset = () => {
    setFrom('');
    setFromName('');
    setTo('');
    setToName('');
    setLevel('haeyo');
    setKind('');
  };

  const submit = useMutation({
    mutationFn: async () => {
      const api = client.projects[':projectId'];
      const param = { projectId };
      const person = async (value: string, typed: string): Promise<Person> => {
        const existing = value === NEW ? characters.find((c) => c.name.toLowerCase() === typed.toLowerCase()) : characters.find((c) => c.id === value);
        if (existing) return existing;
        const created = await sent(projectId, api.characters.$post({ param, json: { name: typed } }));
        return { id: created.id, name: created.name };
      };
      const speaker = await person(from, fromTyped);
      const listener = to === NEW || isPerson(to) ? await person(to, toTyped) : undefined;
      const toKey = listener?.name ?? to;
      const key = pairKey(speaker.name, toKey);
      const existing = pairs.find((pair) => pair.key === key);
      // A pair that already has a rule or relationship is opened rather than doubled.
      if (!existing?.rules.length) await sent(projectId, api['speech-rules'].$post({ param, json: { fromName: speaker.name, toName: toKey, level } }));
      if (listener && !existing?.relationship && (kind.trim() || !existing)) await sent(projectId, api.relationships.$post({ param, json: { fromId: speaker.id, toId: listener.id, kind: kind.trim() || DEFAULT_KIND } }));
      return { key, existed: Boolean(existing?.rules.length) };
    },
    onSuccess: ({ key, existed }) => {
      if (existed) toast.info('이미 말투가 정해진 쌍이라 그 쌍을 열었습니다.');
      setOpen(false);
      reset();
      onCreated(key);
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button>
          <Plus /> 관계·말투
        </Button>
      </PopoverTrigger>
      <Box asChild display="grid" gap="normal"><PopoverContent align="end" width="popover">
        <Grid
          as="form"
          gap="normal"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready && !submit.isPending) submit.mutate();
          }}
        >
          <KeyValue align="start">
          <End label="화자" value={from} name={fromName} onValue={setFrom} onName={setFromName} options={fromOptions} placeholder="말하는 사람" />
          <End label="청자" value={to} name={toName} onValue={setTo} onName={setToName} options={toOptions} placeholder="듣는 사람" />
          <KeyValueRow label="말투">
            <Select value={level} onValueChange={(value) => setLevel(value as SpeechLevel)}>
              <SelectTrigger width="full" aria-label="말투">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPEECH_LEVELS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {SPEECH_LEVEL_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </KeyValueRow>
          {!toSpecial && (
            <KeyValueRow label="관계 종류">
              <Input aria-label="관계 종류" value={kind} onChange={(event) => setKind(event.target.value)} placeholder={`비우면 ‘${DEFAULT_KIND}’`} />
            </KeyValueRow>
          )}
          </KeyValue>
          <Button type="submit" disabled={!ready || submit.isPending}>
            추가
          </Button>
        </Grid>
      </PopoverContent></Box>
    </Popover>
  );
}
