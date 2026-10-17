/** Confirm and start the AI fill of empty term translations. */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Play, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { ModelPicker, useInitialModel, type ModelValue } from '@/components/model-picker';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@loca/ui';
import { client, unwrap } from '@/lib/api';

/** Confirm a batched AI fill of the empty translations: the expected number of requests, and the AI to use. */
export function FillDialog({ projectId, pending, calls, batch }: { projectId: string; pending: number; calls: number; batch: number }) {
  const [open, setOpen] = useState(false);
  const initial = useInitialModel(['generate']);
  const [picked, setPicked] = useState<ModelValue | null>(null);
  const model = picked ?? initial;
  const start = useMutation({
    mutationFn: () => unwrap(client.projects[':projectId'].terms.suggest.$post({ param: { projectId }, json: model! })),
    onSuccess: () => {
      setOpen(false);
      toast.success('용어 번역 채우기를 시작했습니다. 후보로 들어옵니다.');
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Sparkles /> 빈 번역 AI로 채우기
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>빈 번역 AI로 채우기</DialogTitle>
          <DialogDescription>
            번역이 빈 후보 {pending.toLocaleString()}개 · 예상 요청 {calls.toLocaleString()}회 (요청당 {batch}개, 예문 2줄씩)
          </DialogDescription>
        </DialogHeader>
        <ModelPicker value={model} onChange={setPicked} />
        <DialogFooter>
          <Button disabled={!model?.model || start.isPending} onClick={() => start.mutate()}>
            <Play /> 시작
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
