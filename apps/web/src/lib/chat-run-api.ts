import type { ChatChip, RunCard } from '@tw/shared';
import { client, unwrap } from './api';

/** The chat's 실행 확인 card lives on the server, in the conversation: it is made from the picks, then answered once. */
export const makeRunCard = async (sessionId: string, workflowId: string, chips: ChatChip[]) =>
  (await unwrap(client.chat[':sessionId']['run-cards'].$post({ param: { sessionId }, json: { workflowId, chips } }))) as RunCard;

export const answerRunCard = async (sessionId: string, cardId: string, answer: 'start' | 'cancel') =>
  (await unwrap(client.chat[':sessionId']['run-cards'][':cardId'][answer].$post({ param: { sessionId, cardId } }))) as RunCard;
