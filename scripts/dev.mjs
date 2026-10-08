import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const children=[spawn(process.execPath,['--import','tsx','apps/worker/src/server.ts'],{cwd:root,stdio:'inherit'}),spawn(process.execPath,[resolve(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','4318','--strictPort'],{cwd:resolve(root,'apps/web'),stdio:'inherit'})];
let stopping=false;
const stop=()=>{if(stopping)return;stopping=true;for(const child of children)child.kill();};
children.forEach(child=>child.on('exit',code=>{stop();process.exitCode=code??0;}));
process.on('SIGINT',stop);process.on('SIGTERM',stop);
