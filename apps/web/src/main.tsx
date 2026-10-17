import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Toaster, TooltipProvider } from '@loca/ui';
import { setChangeListener } from '@/lib/api';
import { refetchKeys } from '@/lib/live';
import { routeTree } from './routeTree.gen';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
    mutations: { onError: (error) => toast.error(error.message) },
  },
});

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
        <Toaster position="bottom-left" />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
