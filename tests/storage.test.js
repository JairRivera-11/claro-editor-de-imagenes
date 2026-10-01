import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStorage, readResponse } from '../services/storage.js';
import { validateUploadPath } from '../services/cloudUploads.js';

function cloud() {
  const files = new Map();
  const blob = {
    async put(pathname, body) {
      const file = { pathname, body: Buffer.from(body), uploadedAt: new Date(), url: `https://test.public.blob.vercel-storage.com/${pathname}` };
      files.set(pathname, file); return file;
    },
    async head(pathname) {
      if (!files.has(pathname)) { const error = new Error('Missing'); error.name = 'BlobNotFoundError'; throw error; }
      return files.get(pathname);
    },
    async list({ prefix, cursor }) {
      const offset = Number(cursor || 0), items = [...files.values()].filter(f => f.pathname.startsWith(prefix));
      return { blobs: items.slice(offset, offset + 2), hasMore: offset + 2 < items.length, cursor: String(offset + 2) };
    },
    async del(names) { for (const name of names) files.delete(name); },
  };
  const fetchImpl = async url => new Response(files.get(new URL(url).pathname.slice(1)).body);
  return { blob, files, fetchImpl };
}
test('dos instancias sin disco comparten imágenes y marcadores de actividad en Blob', async () => {
  const fake = cloud();
  const first = createStorage({ mode: 'blob', ...fake });
  await first.initialize();
  await first.write('subject.png', Buffer.from('png'));
  // Instancia nueva: no hereda memoria ni archivos de la anterior.
  const second = createStorage({ mode: 'blob', ...fake });
  assert.equal((await second.read('subject.png')).toString(), 'png');
  await second.touch('subject', ['subject.png']);
  await second.write('subject-result-a.png', Buffer.from('result'));
  await second.write('unrelated.png', Buffer.from('other'));
  const group = await first.list('subject');
  assert.equal(group.length, 3); // Verifica paginación de más de dos objetos.
  await first.remove(group.map(file => file.name));
  await assert.rejects(second.read('subject.png'), { code: 'ENOENT' });
  assert.equal((await second.read('unrelated.png')).toString(), 'other');
});
test('solo admite rutas UUID del prefijo de entrada, nunca URLs ni archivos de salida', () => {
  assert.equal(validateUploadPath('claro/incoming/550e8400-e29b-41d4-a716-446655440000.png'), 'claro/incoming/550e8400-e29b-41d4-a716-446655440000.png');
  for (const pathname of [undefined, '../secret', 'https://example.com/image.png', 'claro/uploads/file.png', 'claro/incoming/not-a-uuid.png']) {
    assert.throws(() => validateUploadPath(pathname), { status: 400 });
  }
});
test('limita la lectura descargada incluso sin cabecera Content-Length', async () => {
  await assert.rejects(readResponse(new Response(new Uint8Array(20)), 10), { status: 413 });
  assert.equal((await readResponse(new Response('abc'), 10)).toString(), 'abc');
});
