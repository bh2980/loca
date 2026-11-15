import { useMemo, useState } from 'react';
import { Combobox } from '@loca/ui';

/** Languages games are most often made in or translated into, by their codes (BCP 47, as projects store them). */
const LANGUAGES: { code: string; name: string }[] = [
  { code: 'en', name: '영어' },
  { code: 'ja', name: '일본어' },
  { code: 'ko', name: '한국어' },
  { code: 'zh-Hans', name: '중국어 (간체)' },
  { code: 'zh-Hant', name: '중국어 (번체)' },
  { code: 'fr', name: '프랑스어' },
  { code: 'de', name: '독일어' },
  { code: 'es', name: '스페인어' },
  { code: 'es-419', name: '스페인어 (중남미)' },
  { code: 'pt-BR', name: '포르투갈어 (브라질)' },
  { code: 'it', name: '이탈리아어' },
  { code: 'ru', name: '러시아어' },
  { code: 'pl', name: '폴란드어' },
  { code: 'tr', name: '튀르키예어' },
  { code: 'th', name: '태국어' },
  { code: 'vi', name: '베트남어' },
  { code: 'id', name: '인도네시아어' },
  { code: 'ar', name: '아랍어' },
  { code: 'uk', name: '우크라이나어' },
];

const CODE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const labelOf = (code: string) => {
  const known = LANGUAGES.find((language) => language.code.toLowerCase() === code.toLowerCase());
  return known ? `${known.name} · ${known.code}` : code;
};

/** A project's language: picked from the common ones by name or code, or any other code typed in the search (e.g. `nl`, `pt-PT`). */
export function LanguagePicker({ value, onChange, ariaLabel }: { value: string; onChange: (code: string) => void; ariaLabel: string }) {
  const [query, setQuery] = useState('');
  const options = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    const matches = LANGUAGES.filter((language) => !wanted || `${language.name} ${language.code}`.toLowerCase().includes(wanted)).map((language) => ({ value: language.code, label: `${language.name} · ${language.code}` }));
    // A code that is not in the list is taken as written.
    const typed = query.trim();
    const custom = CODE.test(typed) && !LANGUAGES.some((language) => language.code.toLowerCase() === typed.toLowerCase()) ? [{ value: typed, label: `${typed} (직접 입력한 코드)` }] : [];
    return [...matches, ...custom];
  }, [query]);
  return <Combobox ariaLabel={ariaLabel} value={value} onValueChange={(code) => (onChange(code), setQuery(''))} options={options} onSearch={setQuery} selectedLabel={labelOf(value)} placeholder="언어 고르기" searchPlaceholder="언어 이름이나 코드 (예: nl, pt-PT)" emptyText="언어 이름이나 코드를 입력하세요" />;
}
