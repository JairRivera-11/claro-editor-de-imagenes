import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import path from 'node:path';

export const models = Object.freeze({
  birefnet: { file: 'general.onnx', bytes: 972666916, asset: 'BiRefNet-general-epoch_244.onnx', sha256: '58f621f00f5d756097615970a88a791584600dcf7c45b18a0a6267535a1ebd3c' },
  'birefnet-lite': { file: 'lite.onnx', bytes: 224005088, asset: 'BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx', sha256: '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333' },
});
const exposed = message => Object.assign(new Error(message), { status: 503, expose: true });

// Una descarga por modelo/instancia. Solo se publica después de verificar tamaño
// y SHA-256: nunca se carga un archivo parcial en ONNX.
export function createModelStore({ dir, autoDownload = false, fetchImpl = fetch, catalog = models, timeoutMs = 120_000 }) {
  const pending = new Map();
  async function ensure(engine) {
    const model = Object.hasOwn(catalog, engine) && catalog[engine];
    if (!model) throw exposed('Motor de segmentación desconocido.');
    const target = path.join(dir, model.file);
    if (await stat(target).then(s => s.size === model.bytes).catch(() => false)) {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(target)) hash.update(chunk);
      if (hash.digest('hex') === model.sha256) return target;
    }
    if (!autoDownload) throw exposed(`Falta el modelo ${engine} o está incompleto. Ejecuta npm run models:download -- ${engine}.`);
    await mkdir(dir, { recursive: true });
    const temp = target + '.' + randomUUID() + '.part';
    const url = `https://github.com/ZhengPeng7/BiRefNet/releases/download/v1/${model.asset}`;
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      let bytes = 0;
      const hash = createHash('sha256');
      const check = new Transform({ transform(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes > model.bytes) return callback(new Error('Tamaño de modelo inesperado.'));
        hash.update(chunk); callback(null, chunk);
      }});
      await pipeline(response.body, check, createWriteStream(temp, { flags: 'wx' }));
      if (bytes !== model.bytes || hash.digest('hex') !== model.sha256) throw new Error('El modelo no coincide con el SHA-256 esperado.');
      await rename(temp, target);
      return target;
    } catch (error) {
      console.error(`Descarga de ${engine}: ${error.message}`);
      throw exposed(`No se pudo preparar ${engine}. Reintenta la carga; se necesita conexión a GitHub y espacio temporal para el modelo.`);
    } finally { await rm(temp, { force: true }); }
  }
  return { ensure(engine) {
    if (!pending.has(engine)) pending.set(engine, ensure(engine).finally(() => pending.delete(engine)));
    return pending.get(engine);
  }};
}
