import { Button } from '@loca/ui';

/**
 * An unsaved edit whose item changed elsewhere meanwhile (a chat proposal accepted, a workflow,
 * another window): the person picks which to keep; neither side is dropped silently.
 * `fields` names what collided when only some fields did.
 */
export function ChangedElsewhere({ fields, onTakeSaved, onKeepMine }: { fields?: string[]; onTakeSaved: () => void; onKeepMine: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs">
      <span className="text-warning">
        고치는 동안 {fields?.length ? `${fields.join(', ')}이(가)` : '이 항목이'} 다른 곳에서 바뀌었습니다. 아래는 아직 저장하지 않은 내 수정입니다.
      </span>
      <span className="ml-auto flex gap-1">
        <Button variant="outline" size="inline" className="px-2" onClick={onTakeSaved}>
          바뀐 내용 불러오기
        </Button>
        <Button variant="ghost" size="inline" className="px-2" onClick={onKeepMine}>
          내 수정 유지
        </Button>
      </span>
    </div>
  );
}
