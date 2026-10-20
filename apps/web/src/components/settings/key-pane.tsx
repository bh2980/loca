import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger, Button, Input, Inspector, InspectorField, InspectorFields, InspectorHeader, InspectorSection } from '@loca/ui';
import { client, unwrap } from '@/lib/api';

export type KeyRow = { id: string; name: string; headerTemplate: string | null; hasKey: boolean };
export const DEFAULT_HEADER = 'Authorization: Bearer {key}';
const fail = (error: Error) => toast.error(error.message);

export function KeyPane({ row, onClose, onCreated }: { row?: KeyRow; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState(row?.name ?? '');
  const [header, setHeader] = useState(row?.headerTemplate ?? DEFAULT_HEADER);
  const [secret, setSecret] = useState('');
  const create = useMutation({
    mutationFn: () => unwrap(client.connections.$post({ json: { kind: 'http', name: name.trim(), headerTemplate: header.trim() || undefined, apiKey: secret.trim() || undefined } })),
    onSuccess: (created) => {
      toast.success('API 키를 추가했습니다.');
      onCreated(created.id);
    },
    onError: fail,
  });
  const save = useMutation({
    mutationFn: async () => {
      await unwrap(client.connections[':id'].$patch({ param: { id: row!.id }, json: { name: name.trim(), headerTemplate: header.trim() } }));
      if (secret.trim()) await unwrap(client.connections[':id'].key.$put({ param: { id: row!.id }, json: { apiKey: secret.trim() } }));
    },
    onSuccess: () => {
      setSecret('');
      toast.success('저장했습니다.');
    },
    onError: fail,
  });
  const remove = useMutation({ mutationFn: () => unwrap(client.connections[':id'].$delete({ param: { id: row!.id } })), onSuccess: onClose, onError: fail });
  const revert = () => {
    setName(row?.name ?? '');
    setHeader(row?.headerTemplate ?? DEFAULT_HEADER);
    setSecret('');
  };
  const dirty = !row || name !== row.name || header !== (row.headerTemplate ?? '') || Boolean(secret.trim());

  return (
    <Inspector footerStart={row ? (<><AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" className="text-destructive">
                <Trash2 /> API 키 삭제
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>API 키를 삭제할까요?</AlertDialogTitle>
                <AlertDialogDescription>“{row.name}”을(를) 고른 HTTP 노드는 키 없이 호출하게 되어 검증 오류가 납니다.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>취소</AlertDialogCancel>
                <AlertDialogAction onClick={() => remove.mutate()}>삭제</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog></>) : undefined} header={<InspectorHeader kind="API 키" name={row ? row.name : 'API 키 추가'} onClose={onClose} />} footer={
        <>
          {row && dirty && (
            <>
              <span className="mr-auto text-xs text-muted-foreground">바뀐 곳이 있습니다</span>
              <Button variant="outline" disabled={save.isPending} onClick={revert}>되돌리기</Button>
            </>
          )}
          <Button disabled={!name.trim() || !dirty || create.isPending || save.isPending} onClick={() => (row ? save.mutate() : create.mutate())}>
            {row ? '저장' : '추가'}
          </Button>
        </>
      }>
      <InspectorSection title="설정">
        <InspectorFields>
          <InspectorField label="이름">
            <Input value={name} placeholder="예: 맞춤법 검사기 키" onChange={(event) => setName(event.target.value)} />
          </InspectorField>
          <InspectorField label="헤더" description="{key}는 저장한 키로 바뀝니다.">
            <Input className="font-mono text-sm" value={header} onChange={(event) => setHeader(event.target.value)} />
          </InspectorField>
          <InspectorField label={row ? `키 · ${row.hasKey ? '저장됨' : '없음'}` : '키'} help="OS 키체인에 저장되며 DB·내보내기에 들어가지 않습니다.">
            <Input type="password" autoComplete="off" value={secret} placeholder={row ? '바꿀 때만 입력' : undefined} onChange={(event) => setSecret(event.target.value)} />
          </InspectorField>
        </InspectorFields>
      </InspectorSection>
    </Inspector>
  );
}
