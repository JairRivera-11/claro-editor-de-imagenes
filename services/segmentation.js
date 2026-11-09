import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import { rmbg } from 'rmbg';
import { createBriaaiModel, createU2netpModel } from 'rmbg/models';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { root, cacheDir } from './config.js';

export const models = Object.freeze({
  birefnet: { file: 'general.onnx', bytes: 972666916, asset: 'BiRefNet-general-epoch_244.onnx', sha256: '58f621f00f5d756097615970a88a791584600dcf7c45b18a0a6267535a1ebd3c' },
  'birefnet-lite': { file: 'lite.onnx', bytes: 224005088, asset: 'BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx', sha256: '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333' },
});
// Validado con la comparación Redmi; el anterior continúa disponible por configuración.
export const defaultEngine = process.env.SEGMENTATION_ENGINE || 'birefnet-lite';
const modelDir = process.env.BIREFNET_MODEL_DIR || path.join(root, '.cache/birefnet');
let sessionEntry;
let running = false;
const exposed = (status, message) => Object.assign(new Error(message), { status, expose: true });

export function letterbox(width, height, resolution = 1024) {
  const scale = Math.min(resolution / width, resolution / height);
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  return { width: w, height: h, left: Math.floor((resolution - w) / 2), top: Math.floor((resolution - h) / 2), resolution };
}

export function normalizedTensor(rgb, width, height) {
  const count = width * height;
  if (rgb.length !== count * 3) throw new Error('Entrada RGB incompatible.');
  const result = new Float32Array(count * 3);
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  for (let c = 0; c < 3; c++) for (let i = 0; i < count; i++) result[c * count + i] = (rgb[i * 3 + c] / 255 - mean[c]) / std[c];
  return result;
}

export function logitsToMask(values) {
  const mask = Buffer.alloc(values.length);
  for (let i = 0; i < values.length; i++) {
    const x = values[i];
    if (!Number.isFinite(x)) throw new Error('El modelo devolvió una máscara no finita.');
    mask[i] = Math.round(255 / (1 + Math.exp(-x)));
  }
  return mask;
}

async function getSession(engine) {
  if (sessionEntry?.engine === engine) return sessionEntry.session;
  if (sessionEntry) { await sessionEntry.session.release(); sessionEntry = undefined; }
  const model = models[engine], filename = path.join(modelDir, model.file);
  const size = await stat(filename).then(s => s.size).catch(() => 0);
  if (size !== model.bytes) throw exposed(503, `Falta el modelo ${engine} o está incompleto. Ejecuta npm run models:download -- ${engine}.`);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  if (hash.digest('hex') !== model.sha256) throw exposed(503, `Los pesos de ${engine} no superaron la verificación SHA-256. Descárgalos de nuevo.`);
  const threads = Number(process.env.ONNX_THREADS || 4);
  if (!Number.isInteger(threads) || threads < 1 || threads > 8) throw exposed(503, 'ONNX_THREADS debe ser un entero entre 1 y 8.');
  try {
    const session = await ort.InferenceSession.create(filename, {
      executionProviders: ['cpu'], graphOptimizationLevel: 'all',
      intraOpNumThreads: threads, interOpNumThreads: 1, executionMode: 'sequential',
      enableCpuMemArena: false, enableMemPattern: false,
    });
    sessionEntry = { engine, session };
    return session;
  } catch (error) {
    console.error('No se pudo cargar ONNX:', error.message);
    throw exposed(503, `No se pudo cargar ${engine}. Verifica los pesos y la memoria disponible.`);
  }
}

export async function releaseModels() {
  if (running) throw new Error('Hay una inferencia activa.');
  if (sessionEntry) { await sessionEntry.session.release(); sessionEntry = undefined; }
}

// Solo cambia alfa: el RGB procede siempre de la foto normalizada, también al restaurar.
export async function applyMask(source, mask) {
  const original = await sharp(source).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const decoded = await sharp(mask).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = original.info;
  if (decoded.info.width !== width || decoded.info.height !== height) throw exposed(400, 'La máscara debe tener las dimensiones de la imagen original.');
  for (let i = 0; i < width * height; i++) original.data[i * 4 + 3] = Math.round(original.data[i * 4 + 3] * decoded.data[i] / 255);
  return sharp(original.data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

export async function segment(source, engine = defaultEngine) {
  if (!['briaai', 'u2netp', ...Object.keys(models)].includes(engine)) throw exposed(400, 'Motor de segmentación desconocido.');
  if (running) throw exposed(429, 'Hay otra imagen en proceso. Inténtalo de nuevo en unos segundos.');
  running = true;
  try {
    const { width, height } = await sharp(source).metadata();
    let mask;
    if (engine === 'briaai' || engine === 'u2netp') {
      const output = await rmbg(source, { model: engine === 'briaai' ? createBriaaiModel() : createU2netpModel(), cacheDir, maxResolution: Math.max(width, height) });
      mask = await sharp(output).extractChannel('alpha').png().toBuffer();
    } else {
      const session = await getSession(engine), box = letterbox(width, height);
      // Letterbox explícito: ningún eje se estira. Se retira el relleno de la máscara.
      const rgb = await sharp(source).flatten({ background: '#ffffff' }).toColourspace('srgb')
        .resize(box.width, box.height, { fit: 'fill', kernel: 'linear' })
        .extend({ left: box.left, right: 1024 - box.width - box.left, top: box.top, bottom: 1024 - box.height - box.top, background: '#ffffff' })
        .removeAlpha().raw().toBuffer();
      const input = new ort.Tensor('float32', normalizedTensor(rgb, 1024, 1024), [1, 3, 1024, 1024]);
      let outputs;
      try {
        // La exportación oficial devuelve logits; la predicción refinada es la última.
        const name = session.outputNames.at(-1);
        outputs = await session.run({ [session.inputNames[0]]: input }, [name]);
        const output = outputs[name];
        if (output.type !== 'float32' || output.dims.join(',') !== '1,1,1024,1024') throw new Error('Salida ONNX incompatible con el modelo oficial.');
        const pixels = logitsToMask(output.data);
        mask = await sharp(pixels, { raw: { width: 1024, height: 1024, channels: 1 } })
          .extract({ left: box.left, top: box.top, width: box.width, height: box.height })
          .resize(width, height, { fit: 'fill', kernel: 'linear' }).png().toBuffer();
      } finally {
        input.dispose();
        for (const tensor of Object.values(outputs || {})) tensor.dispose();
      }
    }
    return { mask, output: await applyMask(source, mask), engine };
  } finally { running = false; }
}
