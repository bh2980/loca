import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { PI_BUILTIN_TOOLS, piOptionsSchema, type PiBuiltinTool, type PiOptions } from '@tw/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { client, unwrap } from '@/lib/api';

const FILE_TOOLS: PiBuiltinTool[] = ['edit', 'write', 'bash'];

function Row({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span>
        {label}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5" />
    </label>
  );
}

/**
 * What a pi connection loads besides the workbench tools. pi users bring their own harness, so
 * packages/extensions load by default and can be switched off one by one; pi's file and shell
 * tools and pi-side instructions are opt-in.
 */
export function PiOptionsPanel({ connectionId, options }: { connectionId: string; options: PiOptions | null }) {
  const queryClient = useQueryClient();
  const saved = piOptionsSchema.parse(options ?? {});
  const [draft, setDraft] = useState<PiOptions>(saved);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const resources = useQuery({
    queryKey: ['connections', connectionId, 'pi-resources'],
    queryFn: () => unwrap(client.connections[':id']['pi-resources'].$get({ param: { id: connectionId } })),
    staleTime: 60_000,
  });
  const save = useMutation({
    mutationFn: () => unwrap(client.connections[':id'].$patch({ param: { id: connectionId }, json: { options: draft } })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['connections'] });
      toast.success('pi 설정을 저장했습니다. 다음 메시지부터 적용됩니다.');
    },
    onError: (error) => toast.error(error.message),
  });
  const update = (patch: Partial<PiOptions>) => setDraft((current) => ({ ...current, ...patch }));
  const disabled = new Set(draft.disabledExtensions);
  const data = resources.data && resources.data.ok ? resources.data : null;
  const fileToolsOn = draft.builtinTools.some((tool) => FILE_TOOLS.includes(tool));

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">pi에서 불러올 것</h3>
        <p className="text-xs text-muted-foreground">작업실 도구(대본·용어·제안 카드)는 항상 붙습니다. 그 밖에 pi에 설치한 것을 여기서 켜고 끕니다.</p>
      </div>

      <section>
        <Row label="패키지·확장" hint="웹 검색(pi-web-access), 라우터, 다중 계정, 가드레일 등 pi에 설치한 것" checked={draft.extensions} onChange={(value) => update({ extensions: value })} />
        {draft.extensions && (
          <div className="mt-1 max-h-56 overflow-auto rounded-md border p-2">
            {resources.isPending ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Spinner /> 설치된 확장을 읽는 중…
              </p>
            ) : data ? (
              data.extensions.length ? (
                data.extensions.map((extension) => (
                  <label key={extension.path} className="flex items-start gap-2 py-1 text-xs">
                    <Checkbox
                      className="mt-0.5"
                      checked={!disabled.has(extension.path)}
                      onCheckedChange={(checked) =>
                        update({ disabledExtensions: checked ? draft.disabledExtensions.filter((path) => path !== extension.path) : [...draft.disabledExtensions, extension.path] })
                      }
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium" title={extension.path}>
                        {extension.source || extension.path.split('/').at(-1)}
                      </span>
                      {extension.tools.length > 0 && <span className="block truncate text-muted-foreground">도구: {extension.tools.join(', ')}</span>}
                    </span>
                  </label>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">설치된 확장이 없습니다.</p>
              )
            ) : (
              <p className="text-xs text-destructive">확장을 읽지 못했습니다: {resources.data && !resources.data.ok ? resources.data.detail : ''}</p>
            )}
            {data && data.errors.length > 0 && <p className="mt-1 text-xs text-amber-700">불러오지 못한 확장 {data.errors.length}개: {data.errors[0]}</p>}
          </div>
        )}
      </section>

      <section>
        <p className="text-sm">pi 기본 도구</p>
        <p className="text-xs text-muted-foreground">이 컴퓨터의 파일을 읽거나 고치고 명령을 실행합니다. 번역 작업에는 보통 필요 없습니다.</p>
        <div className="mt-1 grid grid-cols-2 gap-x-4">
          {(Object.keys(PI_BUILTIN_TOOLS) as PiBuiltinTool[]).map((tool) => (
            <label key={tool} className="flex items-center gap-2 py-1 text-sm">
              <Checkbox
                checked={draft.builtinTools.includes(tool)}
                onCheckedChange={(checked) => update({ builtinTools: checked ? [...draft.builtinTools, tool] : draft.builtinTools.filter((item) => item !== tool) })}
              />
              {PI_BUILTIN_TOOLS[tool]} <code className="text-[11px] text-muted-foreground">{tool}</code>
            </label>
          ))}
        </div>
        {fileToolsOn && (
          <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-700">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> 에이전트가 작업 폴더의 파일을 바꾸거나 명령을 실행할 수 있습니다. 이 도구들은 수락 카드를 거치지 않습니다.
          </p>
        )}
        {draft.builtinTools.length > 0 || draft.contextFiles ? (
          <div className="mt-2 space-y-1">
            <p className="text-xs">작업 폴더</p>
            <Input className="h-8 font-mono text-xs" value={draft.cwd} placeholder="비워 두면 임시 폴더" onChange={(event) => update({ cwd: event.target.value })} />
          </div>
        ) : null}
      </section>

      <section>
        <Row label="스킬" hint={data ? `${data.skills.length}개 설치됨` : undefined} checked={draft.skills} onChange={(value) => update({ skills: value })} />
        <Row label="프롬프트 템플릿" hint={data ? `${data.prompts.length}개 설치됨` : undefined} checked={draft.promptTemplates} onChange={(value) => update({ promptTemplates: value })} />
        <Row label="AGENTS.md 같은 지침 파일" hint="작업 폴더와 pi 설정 폴더에서 찾아 함께 넣습니다" checked={draft.contextFiles} onChange={(value) => update({ contextFiles: value })} />
      </section>

      <div className="flex gap-2">
        <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Spinner />} 저장
        </Button>
        {dirty && (
          <Button size="sm" variant="ghost" onClick={() => setDraft(saved)}>
            되돌리기
          </Button>
        )}
      </div>
    </div>
  );
}
