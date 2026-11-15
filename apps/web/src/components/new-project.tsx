import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Box, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Field, Grid, Input, Spinner } from '@loca/ui';
import { createProject } from '@/lib/project';

const EMPTY = { name: '', sourceLanguage: 'en', targetLanguage: 'ko' };

/** 새 프로젝트: a name and the two languages make an empty project from the 홈 설정; its lines are written or imported in it. */
export function NewProjectDialog({ variant = 'default' }: { variant?: 'default' | 'outline' }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const ready = Boolean(form.name.trim()) && form.sourceLanguage.trim().length >= 2 && form.targetLanguage.trim().length >= 2;

  const create = useMutation({
    mutationFn: () => createProject({ ...form, description: '' }),
    onSuccess: ({ projectId }) => {
      setOpen(false);
      void navigate({ to: '/p/$projectId', params: { projectId } });
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={(next) => (setOpen(next), next || setForm(EMPTY))}>
      <DialogTrigger asChild>
        <Button variant={variant}>
          <Plus /> 새 프로젝트
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>새 프로젝트</DialogTitle>
        </DialogHeader>
        <form id="new-project-form" onSubmit={(event) => (event.preventDefault(), ready && !create.isPending && create.mutate())}>
          <Box spaceY="normal">
            <Field label="이름">
              <Input autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="예: Monaco" />
            </Field>
            <Grid columns="twoFromSm" gap="normal">
              <Field label="원문 언어" description="언어 코드 (en, ja, zh…)">
                <Input value={form.sourceLanguage} onChange={(event) => setForm({ ...form, sourceLanguage: event.target.value })} />
              </Field>
              <Field label="번역 언어">
                <Input value={form.targetLanguage} onChange={(event) => setForm({ ...form, targetLanguage: event.target.value })} />
              </Field>
            </Grid>
          </Box>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            취소
          </Button>
          <Button type="submit" form="new-project-form" disabled={!ready || create.isPending}>
            {create.isPending && <Spinner />} 만들기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
