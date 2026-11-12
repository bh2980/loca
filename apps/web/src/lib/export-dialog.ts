import { useSyncExternalStore } from 'react';
import type { LineFilterInput } from '@loca/shared';

/** What the screen shows when 내보내기 is pressed there: the list's filter, and how it is called. */
export interface ExportView {
  filter: LineFilterInput;
  /** "Chapter 1", "전체 UI", "검토함". */
  label: string;
  /** How many filters narrow it. */
  filters: number;
}

/** Where the dialog was opened from: nothing (the whole project to pick from), a list, and the lines picked in it. */
export interface ExportStart {
  view?: ExportView;
  unitIds?: string[];
}

let current: (ExportStart & { id: number }) | null = null;
let opened = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** The one export dialog of a project (mounted beside its pages): every way to it, the palette's included, opens it here. */
export const exportDialog = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  get: () => current,
  open(start: ExportStart = {}) {
    current = { ...start, id: ++opened };
    emit();
  },
  close() {
    current = null;
    emit();
  },
};

export const useExportDialog = () => useSyncExternalStore(exportDialog.subscribe, exportDialog.get);
