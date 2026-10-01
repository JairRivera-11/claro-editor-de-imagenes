import { mkdir, readFile, writeFile, readdir, stat, unlink, utimes } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as blobSdk from '@vercel/blob';
import { storageMode, uploadsDir, assertStorageConfigured } from './config.js';
const prefix = 'claro/uploads/';
function missing(error) {
  if (error?.name === 'BlobNotFoundError') error.code = 'ENOENT';
  throw error;
}
export async function readResponse(response, limit = 100 * 1024 * 1024) {
  if (!response.ok) throw new Error(`No se pudo leer la imagen almacenada (${response.status}).`);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('El archivo supera el tamaño permitido.'), { status: 413 });
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
// Una sola interfaz permite que diferentes instancias serverless compartan los PNG.
export function createStorage({ mode, dir, blob = blobSdk, fetchImpl = fetch }) {
  return {
    async initialize() { if (mode === 'local') await mkdir(dir, { recursive: true }); },
    async write(name, buffer) {
      if (mode === 'local') { await writeFile(path.join(dir, name), buffer); return `/uploads/${name}`; }
      const result = await blob.put(prefix + name, buffer, {
        access: 'public', addRandomSuffix: false, cacheControlMaxAge: 60,
        contentType: name.endsWith('.png') ? 'image/png' : name.endsWith('.jpg') ? 'image/jpeg' : 'application/json',
      });
      return result.url;
    },
    async read(name) {
      if (mode === 'local') return readFile(path.join(dir, name));
      const metadata = await blob.head(prefix + name).catch(missing);
      return readResponse(await fetchImpl(metadata.url, { signal: AbortSignal.timeout(30_000), redirect: 'error' }));
    },
    async list(group = '') {
      if (mode === 'local') {
        const names = (await readdir(dir)).filter(name => name.startsWith(group));
        return Promise.all(names.map(async name => ({ name, modified: await stat(path.join(dir, name)).then(s => s.mtimeMs).catch(e => { if (e.code === 'ENOENT') return 0; throw e; }) })));
      }
      let cursor; const files = [];
      do {
        const page = await blob.list({ prefix: prefix + group, cursor, limit: 1000 });
        files.push(...page.blobs.map(item => ({ name: item.pathname.slice(prefix.length), modified: new Date(item.uploadedAt).getTime() })));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return files;
    },
    async remove(names) {
      if (!names.length) return;
      if (mode === 'local') {
        await Promise.all(names.map(name => unlink(path.join(dir, name)).catch(e => { if (e.code !== 'ENOENT') throw e; })));
      } else {
        for (let i = 0; i < names.length; i += 100) await blob.del(names.slice(i, i + 100).map(name => prefix + name));
      }
    },
    async touch(id, names) {
      if (mode === 'local') {
        const now = new Date();
        await Promise.all(names.map(name => utimes(path.join(dir, name), now, now)));
      } else {
        // Marcadores inmutables: evitan lecturas de metadatos antiguos en la caché CDN.
        await this.write(`${id}-touch-${randomUUID()}.json`, Buffer.from('{}'));
      }
    },
  };
}
export const storage = createStorage({ mode: storageMode, dir: uploadsDir });
export async function initializeStorageAdapter() {
  assertStorageConfigured();
  await storage.initialize();
}
