/**
 * The statuses and tags of one settings target, read and written the same way by the settings screen: a project's
 * (rows of its own, each write an API call) or the home's defaults a new project starts with (two lists saved whole).
 */
import { useMemo } from 'react';
import type { TemplateStatus, TemplateTag } from '@tw/shared';
import type { StatusForm, StatusRowData, TagForm, TagRowData, WithoutUnits } from '@/components/settings/status-types';
import { saveAppDefaults, useAppDefaults } from '@/lib/app-data';
import { reorderTaxonomy, taxonomyWrites, useTaxonomy, useTaxonomyCounts } from '@/lib/knowledge';

export type StatusRow = WithoutUnits<StatusRowData>;
export type TagRow = WithoutUnits<TagRowData>;

export interface TaxonomySource {
  /** Undefined while loading. A project's rows carry how many lines hold them (`units`); the defaults' rows do not. */
  statuses?: StatusRow[];
  tags?: TagRow[];
  createStatus: (form: StatusForm) => Promise<unknown>;
  saveStatus: (id: string, changed: Partial<StatusForm>) => Promise<unknown>;
  /** A project's deleted statuses hand their lines to `moveTo`; the defaults have no lines to move. */
  deleteStatuses: (ids: string[], moveTo?: string) => Promise<unknown>;
  reorderStatuses: (ids: string[]) => Promise<unknown>;
  createTag: (form: TagForm) => Promise<unknown>;
  saveTag: (id: string, changed: Partial<TagForm>) => Promise<unknown>;
  deleteTags: (ids: string[]) => Promise<unknown>;
  reorderTags: (ids: string[]) => Promise<unknown>;
}

/** A project's statuses and tags with their counts (kept apart in the browser: they change with every line). */
export function useProjectTaxonomy(projectId: string): TaxonomySource {
  const taxonomy = useTaxonomy(projectId);
  const counts = useTaxonomyCounts(projectId);
  const statuses = useMemo<StatusRow[] | undefined>(() => taxonomy.statuses?.map((status) => ({ ...status, units: counts.statuses.get(status.id) ?? 0 })), [taxonomy.statuses, counts]);
  const tags = useMemo<TagRow[] | undefined>(() => taxonomy.tags?.map((tag) => ({ ...tag, units: 0, items: 0, ...counts.tags.get(tag.id) })), [taxonomy.tags, counts]);
  return useMemo(() => {
    const writes = taxonomyWrites(projectId);
    return {
      statuses,
      tags,
      createStatus: (form) => writes.createStatus(form),
      saveStatus: (id, changed) => writes.saveStatus(id, changed),
      deleteStatuses: (ids, moveTo) => writes.deleteStatuses(ids, moveTo ?? ''),
      // The row moves at once; a failure moves it back.
      reorderStatuses: (ids) => reorderTaxonomy(projectId, 'statuses', ids),
      createTag: (form) => writes.createTag(form),
      saveTag: (id, changed) => writes.saveTag(id, changed),
      deleteTags: (ids) => writes.deleteTags(ids),
      reorderTags: (ids) => reorderTaxonomy(projectId, 'tags', ids),
    };
  }, [projectId, statuses, tags]);
}

const inOrder = <T extends { id: string }>(list: T[], ids: string[]) => [...list].sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));

/** The home's default statuses and tags. Each edit saves the whole list (shown at once, put back on failure); the server says what is wrong with it. */
export function useDefaultTaxonomy(): TaxonomySource {
  const defaults = useAppDefaults();
  const statuses = defaults.data?.statuses as TemplateStatus[] | undefined;
  const tags = defaults.data?.tags as TemplateTag[] | undefined;
  return useMemo(() => {
    const statusList = statuses ?? [];
    const tagList = tags ?? [];
    const saveStatuses = (list: TemplateStatus[]) => saveAppDefaults({ statuses: list } as never);
    const saveTags = (list: TemplateTag[]) => saveAppDefaults({ tags: list } as never);
    return {
      statuses,
      tags,
      createStatus: (form) => saveStatuses([...statusList, { id: crypto.randomUUID(), ...form }]),
      saveStatus: (id, changed) => saveStatuses(statusList.map((status) => (status.id === id ? { ...status, ...changed } : status))),
      deleteStatuses: (ids) => saveStatuses(statusList.filter((status) => !ids.includes(status.id))),
      reorderStatuses: (ids) => saveStatuses(inOrder(statusList, ids)),
      createTag: (form) => saveTags([...tagList, { id: crypto.randomUUID(), ...form }]),
      saveTag: (id, changed) => saveTags(tagList.map((tag) => (tag.id === id ? { ...tag, ...changed } : tag))),
      deleteTags: (ids) => saveTags(tagList.filter((tag) => !ids.includes(tag.id))),
      reorderTags: (ids) => saveTags(inOrder(tagList, ids)),
    };
  }, [statuses, tags]);
}
