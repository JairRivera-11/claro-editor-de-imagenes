import dotenv from 'dotenv';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
export const isVercel = process.env.VERCEL === '1';
export const storageMode = isVercel ? 'blob' : (process.env.STORAGE_DRIVER || 'local');
if (!['local', 'blob'].includes(storageMode)) throw new Error('STORAGE_DRIVER debe ser local o blob.');
export const uploadsDir = process.env.REMBG_UPLOADS_DIR || path.join(isVercel ? tmpdir() : root, 'uploads');
export const cacheDir = isVercel ? path.join(tmpdir(), 'claro-rmbg') : path.join(root, '.cache', 'rmbg');
export const maxUploadBytes = 10 * 1024 * 1024;
export const ttl = 60 * 60 * 1000;
export function assertStorageConfigured() {
  if (storageMode === 'blob' && !process.env.BLOB_READ_WRITE_TOKEN) {
    throw Object.assign(new Error('Conecta un almacén público de Vercel Blob y configura BLOB_READ_WRITE_TOKEN.'), { status: 503, expose: true });
  }
}
