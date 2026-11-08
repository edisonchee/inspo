// Validate data/gallery.json against data/media/. Exits non-zero on any problem.
// Unreferenced files in media/ are not problems (removed clips land there); they're listed for information.
import path from 'node:path';
import { createStore } from '../server/store.ts';
import { validateGallery } from '../src/lib/validate.ts';

const dataDir = process.env.INSPO_DATA_DIR ?? path.resolve('data');
const store = createStore(dataDir);
const g = await store.read();
const errors = validateGallery(g, { mediaFiles: await store.listMediaFiles() });
if (errors.length) {
  for (const e of errors) console.error(`✗ ${e}`);
  console.error(`\n${errors.length} problem(s) in ${store.galleryPath}`);
  process.exit(1);
}
const counts = g.categories.map((c) => `${c.id} ${g.entries.filter((e) => e.category === c.id).length}`);
console.log(`✓ ${g.entries.length} entries, ${g.tags.length} tags (${counts.join(', ')}); next_id ${g.next_id}`);
const loose = await store.unreferenced();
if (loose.length) console.log(`ℹ ${loose.length} unreferenced file(s) in media/, attachable from the editor:\n  ${loose.join('\n  ')}`);
