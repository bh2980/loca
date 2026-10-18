import { z } from 'zod';

/** The endpoint is an exact line key, unit id, or content-node id within one project. */
export const findReadingRouteInputSchema = z.object({
  start: z.string().trim().min(1).max(200),
  end: z.string().trim().min(1).max(200),
});

const endpoint = z.object({
  nodeId: z.string().min(1),
  key: z.string().min(1),
  source: z.string(),
  speaker: z.string().optional(),
});

export const findReadingRouteOutputSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(false), error: z.string().min(1) }),
  z.object({
    ok: z.literal(true),
    label: z.literal('선택한 구간 · 단일 경로'),
    start: endpoint,
    end: endpoint,
    lineCount: z.number().int().nonnegative(),
    stageCount: z.number().int().nonnegative(),
    parallelStageCount: z.number().int().nonnegative(),
    open: z.object({
      to: z.literal('/p/$projectId/graph'),
      search: z.object({
        scope: z.literal('dialogue'),
        view: z.literal('path').optional(),
        routeStart: z.string().min(1),
        routeEnd: z.string().min(1),
      }),
    }),
  }),
]);

export type FindReadingRouteInput = z.infer<typeof findReadingRouteInputSchema>;
export type FindReadingRouteOutput = z.infer<typeof findReadingRouteOutputSchema>;

export const readingRouteQuerySchema = z.object({
  start: z.string().min(1).optional(),
  end: z.string().min(1).optional(),
  via: z.string().optional(),
});
export type ReadingRouteQuery = z.infer<typeof readingRouteQuerySchema>;

export const readingRouteForkOptionSchema = z.object({
  targetId: z.string().min(1),
  label: z.string(),
  preview: z.string(),
});
export type ReadingRouteForkOption = z.infer<typeof readingRouteForkOptionSchema>;

export const readingRouteForkSchema = z.object({
  nodeId: z.string().min(1),
  label: z.string().nullable(),
  selectedId: z.string().min(1),
  options: z.array(readingRouteForkOptionSchema),
});
export type ReadingRouteFork = z.infer<typeof readingRouteForkSchema>;
