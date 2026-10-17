import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../apps/server/src/db/index.ts';
import { importProject } from '../apps/server/src/services/importer.ts';
import { importFileSchema } from '../packages/shared/src/index.ts';
import { config } from '../apps/server/src/config.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbFile = path.join(config.dataDir, 'workbench.sqlite');
const db = openDatabase(dbFile);

const sampleFiles = [
  path.join(root, 'samples/relay-station.json'),
  path.join(root, 'samples/realistic-9k.json'),
];

for (const file of sampleFiles) {
  if (!fs.existsSync(file)) {
    console.log(`Skipping non-existent sample: ${file}`);
    continue;
  }
  console.log(`Importing sample: ${file}`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const parsed = importFileSchema.parse(raw);
  const summary = importProject(db, parsed);
  console.log(`✓ Imported project "${parsed.project.name}" (ID: ${summary.projectId}) with ${summary.units} lines and ${summary.groups} groups`);
}

console.log('Seeding completed successfully!');
