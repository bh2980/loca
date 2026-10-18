import { z } from 'zod';

const key = z.string().trim().min(1).max(200);
const person = z.string().trim().min(1).max(200).nullable();
const groupFields = {
  key: key.optional(),
  title: z.string().trim().min(1).max(300),
  description: z.string().max(20000).optional(),
  section: z.string().trim().max(300).nullable().optional(),
};
export const createGroupSchema = z.object({ kind: z.enum(['scene', 'document', 'ui']), ...groupFields }).strict();
export const updateGroupSchema = z.object(groupFields).partial().strict();
export const createUnitSchema = z.object({
  groupId: z.string().min(1),
  key: key.optional(),
  source: z.string().min(1).max(100000).refine((value) => Boolean(value.trim()), '원문을 입력하세요.'),
  speaker: person.optional(),
  listener: person.optional(),
}).strict();
export const updateUnitSchema = createUnitSchema.partial().strict();
export const deleteUnitsSchema = z.object({ unitIds: z.array(z.string().min(1)).min(1).max(10000) }).strict();
