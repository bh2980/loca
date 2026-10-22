import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, InspectorField, InspectorResult, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Spinner } from '@loca/ui';
import { q } from '@/lib/queries';

const AUTO = '__auto';

/**
 * An ACP connection's login method. The choices come from the agent itself (it is started once,
 * initialize only, when the list is opened or "불러오기" is pressed); 자동 uses the first it offers.
 * Hidden once the agent turns out to offer none (and nothing is chosen).
 */
export function AuthMethodField({ connectionId, executable, value, onChange }: { connectionId: string; executable: string | null; value: string | null | undefined; onChange: (value: string | null) => void }) {
  const [wanted, setWanted] = useState(false);
  const methods = useQuery(q.authMethods(connectionId, executable, wanted));
  const list = methods.data?.ok ? methods.data.methods : undefined;
  if (list && !list.length && !value) return null;
  const known = list?.some((method) => method.id === value);
  return (
    <InspectorField
      label="로그인 방식"
      help="CLI가 로그인을 요구할 때 쓰는 방식입니다. 이미 로그인되어 있으면 쓰이지 않습니다."
      action={
        !list && (
          <Button variant="ghost" size="inline" disabled={methods.isFetching} onClick={() => setWanted(true)}>
            {methods.isFetching && <Spinner />}불러오기
          </Button>
        )
      }
    >
      <Select value={value || AUTO} onValueChange={(next) => onChange(next === AUTO ? null : next)} onOpenChange={(open) => open && setWanted(true)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO}>{list?.length ? `자동 (${list[0]!.name})` : '자동 (첫 번째 방식)'}</SelectItem>
          {value && !known && <SelectItem value={value}>{value}</SelectItem>}
          {list?.map((method) => (
            <SelectItem key={method.id} value={method.id}>
              {method.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {methods.isError ? <InspectorResult tone="error">{methods.error.message}</InspectorResult> : methods.data && !methods.data.ok ? <InspectorResult tone="error">{methods.data.detail}</InspectorResult> : null}
    </InspectorField>
  );
}
