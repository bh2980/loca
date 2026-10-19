import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Input, InspectorField, InspectorResult } from '@loca/ui';
import { client, unwrap } from '@/lib/api';

/**
 * A CLI connection's executable: by default the app finds it (PATH and the usual install dirs) and
 * shows the file it found and its version; "직접 지정" opens a path field for a binary it cannot find.
 * The browser cannot open a file dialog on the server's disk, so the server checks what is typed.
 */
export function ExecutableField({ kind, value, onChange }: { kind: string; value: string; onChange: (value: string) => void }) {
  const [editing, setEditing] = useState(Boolean(value));
  const [checked, setChecked] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setChecked(value.trim()), 400);
    return () => clearTimeout(timer);
  }, [value]);
  const located = useQuery({
    queryKey: ['connections', 'locate', kind, checked],
    queryFn: () => unwrap(client.connections.locate.$post({ json: { kind, executable: checked || undefined } })),
    staleTime: 30_000,
  });
  const found = located.data;
  return (
    <InspectorField
      label="실행 파일"
      action={
        editing ? (
          <Button variant="ghost" size="inline" onClick={() => { onChange(''); setEditing(false); }}>
            자동 찾기
          </Button>
        ) : (
          <Button variant="ghost" size="inline" onClick={() => setEditing(true)}>
            직접 지정
          </Button>
        )
      }
    >
      {editing && <Input value={value} placeholder="/usr/local/bin/codex" className="font-mono text-xs" onChange={(event) => onChange(event.target.value)} />}
      {located.isPending ? (
        <InspectorResult tone="pending">찾는 중…</InspectorResult>
      ) : located.isError ? (
        <InspectorResult tone="error">{located.error.message}</InspectorResult>
      ) : found?.resolved ? (
        <InspectorResult tone="ok" detail={found.version ?? undefined}>
          <span className="font-mono">{found.resolved}</span>
        </InspectorResult>
      ) : (
        <InspectorResult tone="error">{editing && value.trim() ? '이 경로에 실행 파일이 없습니다' : `${found?.command ?? kind}을(를) 찾지 못했습니다. 직접 지정하세요`}</InspectorResult>
      )}
    </InspectorField>
  );
}
