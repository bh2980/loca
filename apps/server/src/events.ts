import { EventEmitter } from 'node:events';

/** Query families the web client caches. A change event tells it which ones to refetch. */
export type Topic =
  | 'projects'
  | 'units'
  | 'graph'
  | 'statuses'
  | 'terms'
  | 'knowledge'
  | 'connections'
  | 'profiles'
  | 'workflows'
  | 'runs'
  | 'reviews'
  | 'chat';

export interface ChangeEvent {
  projectId?: string;
  topics: Topic[];
}

class Events extends EventEmitter<{ change: [ChangeEvent] }> {
  changed(projectId: string | undefined, ...topics: Topic[]) {
    this.emit('change', { projectId, topics });
  }
}

export const events = new Events();
events.setMaxListeners(100);
