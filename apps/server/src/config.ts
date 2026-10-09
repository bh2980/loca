import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export const config = {
  root,
  port: Number(process.env.WORKBENCH_PORT ?? 4317),
  dataDir: path.resolve(process.env.WORKBENCH_DATA_DIR ?? path.join(root, '.workbench')),
  webDist: path.join(root, 'apps/web/dist'),
};
