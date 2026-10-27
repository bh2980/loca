import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { FolderOpen } from 'lucide-react';
import { Button, SectionHeading, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle, Box, Inline, Stack, BrandMark, Grid, ProjectCard, ProjectCardLink, ProjectListFrame, Skeleton, EmptyState } from '@loca/ui';
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
            <SectionHeading level="page" as="h1">loca</SectionHeading>
          </Box>
        </Inline>
        <Inline gap="condensed">
          <Button asChild variant="ghost">
            <Link to="/settings">설정</Link>
          </Button>
          {!!projects.data?.length && <ImportProjectDialog />}
        </Inline>
      </Stack>

      {projects.isPending && (
        <Grid columns="twoFromSm" gap="normal">
          <Skeleton shape="card" count={2} />
        </Grid>
      )}
      {projects.data?.length === 0 && (
        <EmptyState size="pane">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpen />
            </EmptyMedia>
            <EmptyTitle>프로젝트가 없습니다</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <ImportProjectDialog />
          </EmptyContent>
        </EmptyState>
      )}
      <Grid columns="twoFromSm" gap="normal">
        {projects.data?.map((project) => (
          <ProjectCardLink key={project.id}>
            <Link to="/p/$projectId" params={{ projectId: project.id }}>
              <ProjectCard name={project.name} sourceLanguage={project.sourceLanguage} targetLanguage={project.targetLanguage} units={project.units} />
            </Link>
          </ProjectCardLink>
        ))}
      </Grid>
    </ProjectListFrame>
  );
}
