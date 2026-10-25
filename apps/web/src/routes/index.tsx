import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { FolderOpen } from 'lucide-react';
import { SectionHeading, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle, Box, Inline, Stack, BrandMark, OutlinedEmpty, ProjectCard, ProjectCardLink, ProjectCardSkeleton, ProjectGrid, ProjectListFrame } from '@loca/ui';
import { ImportProjectDialog } from '@/components/import-project';
import { q } from '@/lib/queries';

export const Route = createFileRoute('/')({ component: Home });

function Home() {
  const projects = useQuery(q.projects());
  return (
    <ProjectListFrame>
      <Stack as="header" direction="row" align="end" justify="between" gap="comfortable" marginBottom="wide">
        <Inline gap="normal">
          <BrandMark />
          <Box>
            <SectionHeading page as="h1">loca</SectionHeading>
          </Box>
        </Inline>
        {!!projects.data?.length && <ImportProjectDialog />}
      </Stack>

      {projects.isPending && (
        <ProjectGrid>
          <ProjectCardSkeleton />
          <ProjectCardSkeleton />
        </ProjectGrid>
      )}
      {projects.data?.length === 0 && (
        <OutlinedEmpty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpen />
            </EmptyMedia>
            <EmptyTitle>프로젝트가 없습니다</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <ImportProjectDialog />
          </EmptyContent>
        </OutlinedEmpty>
      )}
      <ProjectGrid>
        {projects.data?.map((project) => (
          <ProjectCardLink key={project.id}>
            <Link to="/p/$projectId" params={{ projectId: project.id }}>
              <ProjectCard name={project.name} sourceLanguage={project.sourceLanguage} targetLanguage={project.targetLanguage} units={project.units} />
            </Link>
          </ProjectCardLink>
        ))}
      </ProjectGrid>
    </ProjectListFrame>
  );
}
