import { createApp } from '../../../apps/server/src/app.ts';
import { openDatabase } from '../../../apps/server/src/db/index.ts';
import * as s from '../../../apps/server/src/db/schema.ts';
import { startTurn, turnStartedAt } from '../../../apps/server/src/services/chat-turns.ts';
const db=openDatabase(':memory:');const project=db.insert(s.projects).values({name:'audit',sourceLanguage:'en',targetLanguage:'ko'}).returning().get();const chat=db.insert(s.chatSessions).values({projectId:project.id,title:'delete-test'}).returning().get();const turn=startTurn(project.id,chat.id);const app=createApp({db} as any);const response=await app.request(`http://localhost/api/chat/${chat.id}`,{method:'DELETE',headers:{host:'localhost'}});console.log(JSON.stringify({case:'chat_delete_leaves_turn',http:response.status,remainingChats:db.select().from(s.chatSessions).all().length,aborted:turn.signal.aborted,stillRunning:turnStartedAt(chat.id)!==null}));turn.end();db.$client.close();
