import { models, createModelStore } from '../services/modelStore.js';
import { modelDir } from '../services/config.js';

const engine = process.argv[2] || 'birefnet-lite';
const selected = engine === 'all' ? Object.keys(models) : [engine];
const store = createModelStore({ dir: modelDir, autoDownload: true, timeoutMs: 900_000 });
for (const name of selected) {
  if (!Object.hasOwn(models, name)) throw new Error('Usa birefnet-lite, birefnet o all.');
  console.log(`Preparando ${name} (${Math.round(models[name].bytes / 1e6)} MB)…`);
  await store.ensure(name);
  console.log(`${name}: instalado y verificado.`);
}
