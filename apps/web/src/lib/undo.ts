import { ApiError, client } from './api';
import { sent } from './collections';
import { undoHistory } from './undo-history';

/**
 * Taking back an edit by the token its answer carried (POST /undo: the server's undo record puts the rows back,
 * whatever kind of edit it was). Done once the feed has brought the restored rows.
 */
export const undoChange = (projectId: string, token: string) => sent(projectId, client.projects[':projectId'].undo.$post({ param: { projectId }, json: { token } }));

/**
 * A screen's undo history over server tokens (lib/undo-history.ts). A step the server refuses (4xx: what it would
 * take back has changed since) is dropped; one that failed for another reason (the server is away) stays to be tried again.
 */
export const serverUndoHistory = () => undoHistory({ gone: (error) => error instanceof ApiError && error.status >= 400 && error.status < 500 });
