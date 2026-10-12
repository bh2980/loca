import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { STATUS_COLORS } from '@tw/shared';
import { Page } from '@/components/page';
import { StatusDot } from '@/components/status';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { client, unwrap } from '@/lib/api';
import { STATUS_KIND } from '@/lib/labels';
import { q } from '@/lib/queries';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/p/$projectId/settings/statuses')({
  component: StatusSettings,
});

type Kind = keyof typeof STATUS_KIND;
interface StatusRowData {
  id: string;
  name: string;
  color: string;
  kind: Kind;
  units: number;
  inReview: boolean;
}
interface TagRowData {
  id: string;
  name: string;
  color: string;
  units: number;
}

function Swatches({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label="색상">
      {STATUS_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color}
          onClick={() => onChange(color)}
          className={cn('size-5 rounded-full border-2 border-transparent', value === color && 'ring-2 ring-offset-1 ring-foreground/60')}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}

function KindSelect({ value, onChange }: { value: Kind; onChange: (kind: Kind) => void }) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as Kind)}>
      <SelectTrigger className="w-28" aria-label="종류">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(STATUS_KIND) as Kind[]).map((kind) => (
          <SelectItem key={kind} value={kind}>
            {STATUS_KIND[kind]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function StatusSettings() {
  const { projectId } = Route.useParams();
  const data = useQuery(q.statuses(projectId));
  const statuses = (data.data?.statuses ?? []) as StatusRowData[];
  const tags = (data.data?.tags ?? []) as TagRowData[];
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState({ name: '', color: STATUS_COLORS[1] as string, kind: 'normal' as Kind });
  const [removing, setRemoving] = useState<StatusRowData | null>(null);
  const [moveTo, setMoveTo] = useState<string>('');
  const [newTag, setNewTag] = useState({ name: '', color: STATUS_COLORS[2] as string });
  const [editingTag, setEditingTag] = useState<string | null>(null);

  const fail = (error: Error) => toast.error(error.message);
  const reorder = useMutation({
    mutationFn: (ids: string[]) => unwrap(client.projects[':projectId'].statuses.order.$put({ param: { projectId }, json: { ids } })),
    onError: fail,
  });
  const create = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].statuses.$post({ param: { projectId }, json: adding })),
    onSuccess: () => {
      setAdding({ ...adding, name: '' });
      toast.success('상태를 추가했습니다.');
    },
    onError: fail,
  });
  const update = useMutation({
    mutationFn: (variables: { id: string; json: Partial<Pick<StatusRowData, 'name' | 'color' | 'kind' | 'inReview'>> }) =>
      unwrap(client.projects[':projectId'].statuses[':id'].$patch({ param: { projectId, id: variables.id }, json: variables.json })),
    onSuccess: () => {
      setEditing(null);
      toast.success('저장했습니다.');
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (variables: { id: string; moveTo: string }) =>
      unwrap(client.projects[':projectId'].statuses[':id'].$delete({ param: { projectId, id: variables.id }, json: { moveTo: variables.moveTo } })),
    onSuccess: () => {
      setRemoving(null);
      toast.success('상태를 삭제하고 대사를 옮겼습니다.');
    },
    onError: fail,
  });
  const createTag = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].tags.$post({ param: { projectId }, json: newTag })),
    onSuccess: () => {
      setNewTag({ ...newTag, name: '' });
      toast.success('태그를 추가했습니다.');
    },
    onError: fail,
  });
  const updateTag = useMutation({
    mutationFn: (variables: { id: string; json: { name?: string; color?: string } }) =>
      unwrap(client.projects[':projectId'].tags[':id'].$patch({ param: { projectId, id: variables.id }, json: variables.json })),
    onSuccess: () => {
      setEditingTag(null);
      toast.success('저장했습니다.');
    },
    onError: fail,
  });
  const removeTag = useMutation({
    mutationFn: (id: string) => unwrap(client.projects[':projectId'].tags[':id'].$delete({ param: { projectId, id } })),
    onSuccess: () => toast.success('태그를 삭제했습니다.'),
    onError: fail,
  });

  const move = (index: number, delta: number) => {
    const ids = statuses.map((status) => status.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    reorder.mutate(ids);
  };

  return (
    <Page title="상태·태그">
      <div className="max-w-4xl space-y-8">
        <section className="space-y-2">
          <div>
            <h2 className="text-sm font-semibold">상태</h2>
            <p className="text-xs text-muted-foreground">
              ‘검토함에 표시’를 켠 상태의 대사는 사람이 바꾸든 워크플로가 바꾸든 검토함에 모입니다. 검토함에서는 다른 상태 중 하나를 골라 옮기는 것으로 결정합니다.
            </p>
          </div>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">순서</TableHead>
                  <TableHead>이름</TableHead>
                  <TableHead className="w-32">종류</TableHead>
                  <TableHead className="w-28">검토함에 표시</TableHead>
                  <TableHead className="w-24 text-right">대사 수</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {statuses.map((status, index) =>
                  editing === status.id ? (
                    <StatusEditRow key={status.id} status={status} pending={update.isPending} onCancel={() => setEditing(null)} onSave={(json) => update.mutate({ id: status.id, json })} />
                  ) : (
                    <TableRow key={status.id}>
                      <TableCell>
                        <div className="flex">
                          <Button variant="ghost" size="icon" className="size-7" disabled={index === 0 || reorder.isPending} onClick={() => move(index, -1)} aria-label={`${status.name} 위로`}>
                            <ArrowUp />
                          </Button>
                          <Button variant="ghost" size="icon" className="size-7" disabled={index === statuses.length - 1 || reorder.isPending} onClick={() => move(index, 1)} aria-label={`${status.name} 아래로`}>
                            <ArrowDown />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-2 font-medium">
                          <StatusDot color={status.color} className="size-2.5" />
                          {status.name}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{STATUS_KIND[status.kind]}</TableCell>
                      <TableCell>
                        <Switch checked={status.inReview} onCheckedChange={(inReview) => update.mutate({ id: status.id, json: { inReview } })} aria-label={`${status.name} 검토함에 표시`} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{status.units.toLocaleString()}</TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <Button variant="ghost" size="icon" className="size-7" onClick={() => setEditing(status.id)} aria-label={`${status.name} 편집`}>
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-destructive"
                            disabled={statuses.length < 2}
                            onClick={() => {
                              setRemoving(status);
                              setMoveTo('');
                            }}
                            aria-label={`${status.name} 삭제`}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ),
                )}
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableCell />
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Input className="w-44" aria-label="새 상태 이름" placeholder="새 상태 이름" value={adding.name} onChange={(event) => setAdding({ ...adding, name: event.target.value })} onKeyDown={(event) => event.key === 'Enter' && adding.name.trim() && create.mutate()} />
                      <Swatches value={adding.color} onChange={(color) => setAdding({ ...adding, color })} />
                    </div>
                  </TableCell>
                  <TableCell>
                    <KindSelect value={adding.kind} onChange={(kind) => setAdding({ ...adding, kind })} />
                  </TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell>
                    <Button size="sm" disabled={!adding.name.trim() || create.isPending} onClick={() => create.mutate()}>
                      <Plus /> 추가
                    </Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </section>

        <section className="space-y-2">
          <div>
            <h2 className="text-sm font-semibold">태그</h2>
            <p className="text-xs text-muted-foreground">
              상태와 별개로 대사에 여러 개 붙이는 표시입니다(예: #재검토, #폰트확인). 스크립트에서 골라 붙이거나 상태 변경 노드로 붙이고, 워크플로 실행 범위나 조건에 씁니다.
            </p>
          </div>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>이름</TableHead>
                  <TableHead className="w-24 text-right">대사 수</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {tags.map((tag) =>
                  editingTag === tag.id ? (
                    <TagEditRow key={tag.id} tag={tag} pending={updateTag.isPending} onCancel={() => setEditingTag(null)} onSave={(json) => updateTag.mutate({ id: tag.id, json })} />
                  ) : (
                    <TableRow key={tag.id}>
                      <TableCell>
                        <span className="inline-flex items-center gap-2 font-medium">
                          <StatusDot color={tag.color} className="size-2.5" />#{tag.name}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{tag.units.toLocaleString()}</TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <Button variant="ghost" size="icon" className="size-7" onClick={() => setEditingTag(tag.id)} aria-label={`${tag.name} 편집`}>
                            <Pencil />
                          </Button>
                          <TagDeleteButton tag={tag} onConfirm={() => removeTag.mutate(tag.id)} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ),
                )}
                {data.data && tags.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-12 text-center text-muted-foreground">
                      태그가 없습니다.
                    </TableCell>
                  </TableRow>
                )}
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Input className="w-44" aria-label="새 태그 이름" placeholder="새 태그 이름" value={newTag.name} onChange={(event) => setNewTag({ ...newTag, name: event.target.value })} onKeyDown={(event) => event.key === 'Enter' && newTag.name.trim() && createTag.mutate()} />
                      <Swatches value={newTag.color} onChange={(color) => setNewTag({ ...newTag, color })} />
                    </div>
                  </TableCell>
                  <TableCell />
                  <TableCell>
                    <Button size="sm" disabled={!newTag.name.trim() || createTag.isPending} onClick={() => createTag.mutate()}>
                      <Plus /> 추가
                    </Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </section>
      </div>

      <AlertDialog open={!!removing} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>“{removing?.name}” 상태를 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              이 상태의 대사 {removing?.units.toLocaleString()}개를 다른 상태로 옮깁니다. 이 상태를 쓰는 워크플로 노드는 검증에 실패하므로 수정해야 합니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Select value={moveTo} onValueChange={setMoveTo}>
            <SelectTrigger className="w-full" aria-label="옮길 상태">
              <SelectValue placeholder="대사를 옮길 상태 선택" />
            </SelectTrigger>
            <SelectContent>
              {statuses
                .filter((status) => status.id !== removing?.id)
                .map((status) => (
                  <SelectItem key={status.id} value={status.id}>
                    <StatusDot color={status.color} /> {status.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <Button variant="destructive" disabled={!moveTo || remove.isPending} onClick={() => removing && remove.mutate({ id: removing.id, moveTo })}>
              삭제
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}

function TagDeleteButton({ tag, onConfirm }: { tag: TagRowData; onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="icon" className="size-7 text-destructive" onClick={() => setOpen(true)} aria-label={`${tag.name} 삭제`}>
        <Trash2 />
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>“#{tag.name}” 태그를 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>대사 {tag.units.toLocaleString()}개에서 이 태그가 제거됩니다. 이 태그를 쓰는 워크플로 노드는 수정해야 합니다.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <Button variant="destructive" onClick={onConfirm}>
              삭제
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function StatusEditRow({ status, pending, onCancel, onSave }: { status: StatusRowData; pending: boolean; onCancel: () => void; onSave: (json: { name: string; color: string; kind: Kind }) => void }) {
  const [form, setForm] = useState({ name: status.name, color: status.color, kind: status.kind });
  return (
    <TableRow className="bg-muted/30 hover:bg-muted/30">
      <TableCell />
      <TableCell>
        <div className="flex items-center gap-3">
          <Input className="w-44" aria-label="상태 이름" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <Swatches value={form.color} onChange={(color) => setForm({ ...form, color })} />
        </div>
      </TableCell>
      <TableCell>
        <KindSelect value={form.kind} onChange={(kind) => setForm({ ...form, kind })} />
      </TableCell>
      <TableCell />
      <TableCell className="text-right tabular-nums">{status.units.toLocaleString()}</TableCell>
      <TableCell>
        <div className="flex justify-end">
          <Button variant="ghost" size="icon" className="size-7" disabled={!form.name.trim() || pending} onClick={() => onSave(form)} aria-label="저장">
            <Check />
          </Button>
          <Button variant="ghost" size="icon" className="size-7" onClick={onCancel} aria-label="취소">
            <X />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function TagEditRow({ tag, pending, onCancel, onSave }: { tag: TagRowData; pending: boolean; onCancel: () => void; onSave: (json: { name: string; color: string }) => void }) {
  const [form, setForm] = useState({ name: tag.name, color: tag.color });
  return (
    <TableRow className="bg-muted/30 hover:bg-muted/30">
      <TableCell>
        <div className="flex items-center gap-3">
          <Input className="w-44" aria-label="태그 이름" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <Swatches value={form.color} onChange={(color) => setForm({ ...form, color })} />
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">{tag.units.toLocaleString()}</TableCell>
      <TableCell>
        <div className="flex justify-end">
          <Button variant="ghost" size="icon" className="size-7" disabled={!form.name.trim() || pending} onClick={() => onSave(form)} aria-label="저장">
            <Check />
          </Button>
          <Button variant="ghost" size="icon" className="size-7" onClick={onCancel} aria-label="취소">
            <X />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
