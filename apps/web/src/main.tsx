import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { Notice, Spinner, Toaster, TooltipProvider } from '@loca/ui';
import { setChangeListener, useServerDown } from '@/lib/api';
import { queryClient } from '@/lib/query-client';
import { refetchKeys } from '@/lib/live';
import { routeTree } from './routeTree.gen';
import '@loca/ui/fonts.css';
import './index.css';


// A write's answer names the topics it changed: refetch those queries now. The event for the same
// change names this tab as its origin and is skipped (lib/live.ts), so it is fetched once (#20).
setChangeListener((topics) => {
  for (const key of refetchKeys(topics)) void queryClient.invalidateQueries({ queryKey: [key] });
});

const router = createRouter({
  routeTree,
  context: { queryClient },
  scrollRestoration: true,
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
});

/** Outside the router: a page still waiting for its first data renders nothing, and the notice must show then too. */
function ServerDownNotice() {
  if (!useServerDown()) return null;
  return (
    <Notice variant="floating"><Spinner size="xs" />서버에 연결하는 중…</Notice>
  );
}

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <RouterProvider router={router} />
        <ServerDownNotice />
        <Toaster position="bottom-left" />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
