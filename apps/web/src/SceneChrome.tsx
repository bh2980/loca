import { Button } from './components/ui/button';
import { NativeSelect } from './components/ui/native-select';
import { NativeSelectOption } from './components/ui/native-select';
import { Popover, PopoverContent, PopoverTrigger } from './components/ui/popover';
import { useState, type ReactNode } from 'react';
import { ArrowLeft, BookOpen, ChevronDown, FlaskConical, GitBranch, Info, Play } from 'lucide-react';
import type { Group } from '@workbench/contracts';
import './scene-chrome.css';

export function SceneChrome({ groupId, groups, view, onBack, onSelectGroup, onView, actions }: { groupId: string; groups: Group[]; view: 'read' | 'flow'; onBack: () => void; onSelectGroup: (id: string) => void; onView: (view: 'read' | 'flow') => void; actions?: ReactNode }) {
  return <header className="scene-chrome">
    <div className="scene-chrome-location"><Button onClick={onBack} variant="ghost" size="sm"><ArrowLeft size={13} />작품으로</Button><label><span>장면</span><NativeSelect aria-label="장면 선택" value={groupId} onChange={event => onSelectGroup(event.target.value)}>{!groupId ? <NativeSelectOption value="">장면 선택</NativeSelectOption> : null}{groups.map(group => <NativeSelectOption key={group.id} value={group.id}>{group.title}</NativeSelectOption>)}</NativeSelect></label></div>
    <div className="scene-chrome-views" role="group" aria-label="장면 보기"><Button aria-pressed={view === 'read'} onClick={() => onView('read')} variant="ghost"><BookOpen size={14} />읽기</Button><Button aria-pressed={view === 'flow'} onClick={() => onView('flow')} variant="ghost"><GitBranch size={14} />흐름</Button></div>
    <div className="scene-chrome-actions">{actions}</div>
  </header>;
}

export function SceneActions({ options, value, onChange, disabled = false, onTest, onRun, children }: { options: { value: string; label: string; count: number }[]; value: string; onChange: (value: string) => void; disabled?: boolean; onTest?: () => void; onRun?: () => void; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const selected = options.find(option => option.value === value);
  const close = () => setOpen(false);
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button className="scene-actions-trigger" variant="ghost">장면 작업<ChevronDown size={13} /></Button></PopoverTrigger><PopoverContent className="scene-actions-popover" align="end" sideOffset={8}>
    <label>대상<NativeSelect aria-label="작업 대상" value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>{options.map(option => <NativeSelectOption key={option.value} value={option.value}>{option.label} · {option.count}개</NativeSelectOption>)}</NativeSelect></label>
    <p>{selected?.count ?? 0}개 원문</p>
    {children ? <div className="scene-actions-extra">{children}</div> : null}
    <div className="scene-actions-buttons"><Button disabled={disabled || !selected?.count || !onTest} onClick={() => { close(); onTest?.(); }} variant="outline" size="sm"><FlaskConical size={13} />시험</Button><Button disabled={disabled || !selected?.count || !onRun} onClick={() => { close(); onRun?.(); }} variant="default" size="sm"><Play size={13} />번역 실행</Button></div>
  </PopoverContent></Popover>;
}

export function SceneInfo({ description }: { description: string }) {
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button className="scene-information-trigger" variant="ghost"><Info size={13} />장면 정보</Button></PopoverTrigger><PopoverContent className="scene-information-popover" align="end" sideOffset={8}>{description}</PopoverContent></Popover>;
}
