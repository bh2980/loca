/** Row and form shapes shared by the status, tag and mark panes. */
import { TAG_SCOPES, TAG_SCOPE_LABELS, type TagScope } from '@tw/shared';
import { STATUS_KIND } from '@/lib/labels';

export type Kind = keyof typeof STATUS_KIND;
export interface StatusRowData {
  id: string;
  name: string;
  color: string;
  kind: Kind;
  units: number;
  inReview: boolean;
}
export interface TagRowData {
  id: string;
  name: string;
  color: string;
  units: number;
  /** Knowledge items and terms carrying it. */
  items?: number;
  role?: string | null;
  /** Where the tag can be put (the app's tags: fixed by their role). */
  scope: TagScope[];
}
/** All three places read as 어디든. */
export const scopeLabel = (scope: readonly TagScope[]) => (TAG_SCOPES.every((place) => scope.includes(place)) ? '어디든' : TAG_SCOPES.filter((place) => scope.includes(place)).map((place) => TAG_SCOPE_LABELS[place]).join(' · '));
export type TagForm = { name: string; color: string; scope: TagScope[] };
export type StatusForm = { name: string; color: string; kind: Kind; inReview: boolean };
