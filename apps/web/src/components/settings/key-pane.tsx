import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger, Button, Field, FieldDescription, FieldGroup, FieldLabel, Input, Inspector, InspectorHeader } from '@loca/ui';
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
  const dirty = !row || name !== row.name || header !== (row.headerTemplate ?? '') || Boolean(secret.trim());

  return (
    <Inspector header={<InspectorHeader kind="API 키" name={row ? row.name : 'API 키 추가'} onClose={onClose} />} footer={
        <>
          <Button disabled={!name.trim() || !dirty || create.isPending || save.isPending} onClick={() => (row ? save.mutate() : create.mutate())}>
            {row ? '저장' : '추가'}
          </Button>
          {row && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="text-destructive">
                  <Trash2 /> 삭제
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
            </AlertDialog>
          )}
        </>
      }>
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="key-name">이름</FieldLabel>
          <Input id="key-name" value={name} placeholder="예: 맞춤법 검사기 키" onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="key-header">키를 보내는 헤더</FieldLabel>
          <Input id="key-header" className="font-mono text-xs" value={header} onChange={(event) => setHeader(event.target.value)} />
          <FieldDescription>
            {'{key}'} 자리에 저장한 키가 들어갑니다. 예: X-API-Key: {'{key}'}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="key-secret">키 {row?.hasKey && <span className="font-normal text-muted-foreground">(저장됨 — 바꿀 때만 입력)</span>}</FieldLabel>
          <Input id="key-secret" type="password" autoComplete="off" value={secret} onChange={(event) => setSecret(event.target.value)} />
          <FieldDescription>OS 키체인에 저장되며 DB·워크플로·내보내기에 들어가지 않습니다.</FieldDescription>
        </Field>
      </FieldGroup>
    </Inspector>
  );
}
