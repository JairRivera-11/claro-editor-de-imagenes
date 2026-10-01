import * as blob from '@vercel/blob';
import { handleUpload } from '@vercel/blob/client';
import { storageMode, maxUploadBytes, ttl } from './config.js';
import { readResponse } from './storage.js';
const incomingPrefix = 'claro/incoming/';
const uploadPattern = /^claro\/incoming\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|jpeg|webp)$/;
const mimeByExtension = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const error = (status, message) => Object.assign(new Error(message), { status });
export function validateUploadPath(pathname) {
  if (typeof pathname !== 'string' || !uploadPattern.test(pathname)) throw error(400, 'Ruta de subida no válida.');
  return pathname;
}
export async function uploadToken(req, res, next) {
  try {
    if (storageMode !== 'blob') throw error(400, 'La subida directa solo está disponible con Vercel Blob.');
    if (req.body?.type !== 'blob.generate-client-token') throw error(400, 'Solicitud de subida no válida.');
    const result = await handleUpload({
      request: req, body: req.body,
      onBeforeGenerateToken: async pathname => {
        validateUploadPath(pathname);
        return {
          allowedContentTypes: [mimeByExtension[pathname.split('.').at(-1)]],
          maximumSizeInBytes: maxUploadBytes, validUntil: Date.now() + 5 * 60 * 1000,
          addRandomSuffix: false, allowOverwrite: false, cacheControlMaxAge: 60,
        };
      },
    });
    res.set('Cache-Control', 'no-store').json(result);
  } catch (cause) { next(cause); }
}
export async function resolveUpload(req) {
  if (req.file) return { file: req.file, dispose: async () => {} };
  if (storageMode !== 'blob') throw error(400, 'Selecciona una imagen.');
  const pathname = validateUploadPath(req.body?.uploadPath);
  let metadata;
  try { metadata = await blob.head(pathname); }
  catch (cause) { if (cause.name === 'BlobNotFoundError') throw error(404, 'La subida ya no existe. Vuelve a subir la imagen.'); throw cause; }
  // Solo se leen objetos del almacén propio; el usuario nunca decide una URL a fetch.
  const dispose = () => blob.del(pathname);
  try {
    if (Date.now() - new Date(metadata.uploadedAt).getTime() > ttl) throw error(410, 'La subida ha caducado.');
    if (metadata.size > maxUploadBytes) throw error(413, 'La imagen supera el límite de 10 MB.');
    const mimetype = mimeByExtension[pathname.split('.').at(-1)];
    if (metadata.contentType !== mimetype) throw error(400, 'El tipo de imagen no coincide con su extensión.');
    const buffer = await readResponse(await fetch(metadata.url, { signal: AbortSignal.timeout(30_000), redirect: 'error' }), maxUploadBytes);
    return { file: { buffer, mimetype, originalname: pathname.split('/').at(-1) }, dispose };
  } catch (cause) { await dispose().catch(console.error); throw cause; }
}
export async function cleanupIncoming(now = Date.now()) {
  if (storageMode !== 'blob') return;
  let cursor;
  do {
    const page = await blob.list({ prefix: incomingPrefix, cursor, limit: 1000 });
    const expired = page.blobs.filter(item => new Date(item.uploadedAt).getTime() < now - ttl).map(item => item.pathname);
    for (let i = 0; i < expired.length; i += 100) await blob.del(expired.slice(i, i + 100));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
}
