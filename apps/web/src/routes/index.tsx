import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { FolderOpen, Languages } from 'lucide-react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { ImportProjectDialog } from '@/components/import-project';
import { q } from '@/lib/queries';

export const Route = createFileRoute('/')({ component: Home });

function Home() {
  const projects = useQuery(q.projects());
  return (
    <div className="mx-auto flex min-h-svh max-w-4xl flex-col px-6 py-12">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-xs bg-primary text-primary-foreground">
            <Languages className="size-4" />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight">loca</h1>
            <p className="text-xs text-muted-foreground">게임 번역 프로젝트</p>
          </div>
        </div>
        {!!projects.data?.length && <ImportProjectDialog />}
      </header>

      {projects.isPending && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      )}
      {projects.data?.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpen />
            </EmptyMedia>
            <EmptyTitle>프로젝트가 없습니다</EmptyTitle>
            <EmptyDescription>게임에서 추출한 표준 포맷 파일을 가져와 시작하세요. 저장소의 samples 폴더에 예시가 있습니다.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <ImportProjectDialog />
          </EmptyContent>
        </Empty>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {projects.data?.map((project) => (
          <Link key={project.id} to="/p/$projectId" params={{ projectId: project.id }} className="rounded-md focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none">
            <Card className="h-full border-border/80 shadow-none transition-colors hover:bg-muted/40 hover:border-border">
              <CardHeader className="p-4">
                <CardTitle className="truncate text-sm font-semibold">{project.name}</CardTitle>
                <CardDescription className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="uppercase font-mono">{project.sourceLanguage}</span>→<span className="uppercase font-mono">{project.targetLanguage}</span>
                  <span>·</span>
                  <span className="tabular-nums">대사 {project.units.toLocaleString()}개</span>
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
