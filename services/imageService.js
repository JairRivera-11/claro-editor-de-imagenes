import { visibleBounds, placement } from '../public/geometry.js';
import sharp from 'sharp';
import { rmbg } from 'rmbg';
import { createBriaaiModel } from 'rmbg/models';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { cacheDir, uploadsDir } from './config.js';
import { storage, initializeStorageAdapter } from './storage.js';
export { uploadsDir };
const model = createBriaaiModel();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const inputOptions = { limitInputPixels: 24_000_000, failOn: 'error' };
const active = new Set();
export const gradients = {
  sunset: ['#ff9966', '#ff5e62'], ocean: ['#43cea2', '#185a9d'],
  lavender: ['#c4b5fd', '#fbcfe8'], midnight: ['#0f172a', '#6366f1'],
};
export function httpError(status, message) { return Object.assign(new Error(message), { status }); }
function validateId(id) {
  if (typeof id !== 'string' || !uuid.test(id)) throw httpError(400, 'El identificador no es válido.');
  return id.toLowerCase();
}
export async function initializeStorage() {
  await Promise.all([initializeStorageAdapter(), mkdir(cacheDir, { recursive: true })]);
}
async function loadSource(id) {
  try { return await storage.read(`${id}.png`); }
  catch (error) {
    if (error.code === 'ENOENT') throw httpError(404, 'La imagen ha caducado o no existe. Vuelve a subirla.');
    throw error;
  }
}
async function normalize(file) {
  try {
    const image = sharp(file.buffer, inputOptions);
    const metadata = await image.metadata();
    const expected = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' };
    if (!expected[file.mimetype] || metadata.format !== expected[file.mimetype] || (metadata.pages || 1) > 1) {
      throw new Error('Invalid format');
    }
    // Aplica orientación EXIF antes del modelo y elimina metadatos al volver a codificar.
    return await image.rotate().toColourspace('srgb').png().toBuffer();
  } catch { throw httpError(400, 'Imagen dañada, animada o incompatible. Usa PNG, JPG o WebP estático de hasta 24 megapíxeles.'); }
}
async function withImage(imageId, operation) {
  const id = validateId(imageId);
  if (active.has(id)) throw httpError(409, 'Esta imagen está en uso. Reintenta en unos segundos.');
  active.add(id);
  try { return await operation(id); }
  finally { active.delete(id); }
}

export async function removeBackground(file) {
  const input = await normalize(file);
  const output = await rmbg(input, { model, cacheDir, maxResolution: 4096 });
  const id = randomUUID();
  const url = await storage.write(`${id}.png`, output);
  return { imageId: id, url };
}

export async function saveBackground(file, imageId) {
  return withImage(imageId, async id => {
    await loadSource(id);
    const buffer = await normalize(file);
    const fileId = randomUUID();
    // El prefijo vincula cada fondo con su sujeto y permite borrarlo en cleanup.
    await storage.write(`${id}-bg-${fileId}.png`, buffer);
    await touchGroup(id);
    return fileId;
  });
}

function dimensions(size) {
  if (!size || typeof size !== 'object' || typeof size.maintainAspect !== 'boolean') {
    throw httpError(400, 'size debe incluir width, height y maintainAspect booleano.');
  }
  const { width, height } = size;
  if (![width, height].every(n => Number.isInteger(n) && n >= 1 && n <= 4096) || width * height > 16_000_000) {
    throw httpError(400, 'Usa dimensiones enteras de 1 a 4096 px, hasta 16 megapíxeles.');
  }
  return { width, height };
}
async function backgroundBuffer(background, id, width, height) {
  if (!background || typeof background !== 'object') throw httpError(400, 'Selecciona un fondo válido.');
  if (background.type === 'transparent' || background.type === 'color') {
    if (background.type === 'color' && (typeof background.value !== 'string' || !/^#[0-9a-f]{6}$/i.test(background.value))) {
      throw httpError(400, 'El color debe tener formato #RRGGBB.');
    }
    return sharp({ create: { width, height, channels: 4, background: background.type === 'transparent'
      ? { r: 0, g: 0, b: 0, alpha: 0 } : background.value } }).png().toBuffer();
  }
  if (background.type === 'gradient') {
    const colors = typeof background.value === 'string' && Object.hasOwn(gradients, background.value) && gradients[background.value];
    if (!colors) throw httpError(400, 'Degradado desconocido: sunset, ocean, lavender o midnight.');
    // Solo interpolamos valores internos y dimensiones validadas; nunca SVG del usuario.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
  }
  if (background.type === 'image') {
    const fileId = validateId(background.fileId);
    const filename = `${id}-bg-${fileId}.png`;
    let buffer;
    try { buffer = await storage.read(filename); }
    catch (error) {
      if (error.code === 'ENOENT') throw httpError(404, 'El fondo no existe para esta imagen. Vuelve a subirlo.');
      throw error;
    }
    return sharp(buffer, inputOptions).resize(width, height, { fit: 'cover', position: 'centre' }).png().toBuffer();
  }
  throw httpError(400, 'Tipo de fondo no válido.');
}

export async function compose(body) {
  if (!body || typeof body !== 'object') throw httpError(400, 'Envía un cuerpo JSON válido.');
  const { width, height } = dimensions(body.size);
  const { format, quality = 90, centerSubject = false, transform = { x: 0, y: 0, scale: 1 } } = body;
  if (!transform || typeof transform !== 'object' ||
      ![transform.x, transform.y, transform.scale].every(n => typeof n === 'number' && Number.isFinite(n)) ||
      Math.abs(transform.x) > 2 || Math.abs(transform.y) > 2 || transform.scale < 0.1 || transform.scale > 2) {
    throw httpError(400, 'transform requiere x e y entre -2 y 2, y scale entre 0.1 y 2.');
  }
  if (typeof centerSubject !== 'boolean') throw httpError(400, 'centerSubject debe ser booleano.');
  if (!['png', 'jpeg'].includes(format)) throw httpError(400, 'El formato debe ser png o jpeg.');
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) throw httpError(400, 'La calidad debe ser un entero de 1 a 100.');
  return withImage(body.imageId, async id => {
    const source = await loadSource(id);
    const background = await backgroundBuffer(body.background, id, width, height);
    const decoded = await sharp(source, inputOptions).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const bounds = visibleBounds(decoded.data, decoded.info.width, decoded.info.height, decoded.info.channels);
    const box = placement(decoded.info.width, decoded.info.height, bounds, width, height, body.size.maintainAspect, centerSubject, transform);
    // sharp exige que la capa quepa en el fondo. Recortamos únicamente lo que sale
    // del lienzo después de mover/escalar, manteniendo las coordenadas de la vista previa.
    const left = Math.max(0, box.left), top = Math.max(0, box.top);
    const right = Math.min(width, box.left + box.width), bottom = Math.min(height, box.top + box.height);
    let layered = background;
    if (right > left && bottom > top) {
      const subject = await sharp(source, inputOptions).resize(box.width, box.height, { fit: 'fill' })
        .extract({ left: left - box.left, top: top - box.top, width: right - left, height: bottom - top }).png().toBuffer();
      layered = await sharp(background).composite([{ input: subject, left, top }]).png().toBuffer();
    }
    // Otra pasada aplica flatten a la composición completa (incluyendo el sujeto).
    const output = format === 'jpeg'
      ? await sharp(layered).flatten({ background: '#ffffff' }).jpeg({ quality }).toBuffer()
      : await sharp(layered).png().toBuffer();
    const filename = `${id}-result-${randomUUID()}.${format === 'jpeg' ? 'jpg' : 'png'}`;
    const url = await storage.write(filename, output);
    await touchGroup(id);
    return { url, filename, width, height };
  });
}

function belongsTo(name, id) { return name === `${id}.png` || name.startsWith(`${id}-bg-`) || name.startsWith(`${id}-result-`) || name.startsWith(`${id}-touch-`); }
async function removeGroup(id) {
  const names = (await storage.list(id)).map(file => file.name).filter(name => belongsTo(name, id));
  await storage.remove(names);
}
async function touchGroup(id) {
  const names = (await storage.list(id)).map(file => file.name).filter(name => belongsTo(name, id));
  await storage.touch(id, names);
}
export async function cleanup(imageId) { return withImage(imageId, removeGroup); }
export async function cleanupExpired(now = Date.now()) {
  const files = await storage.list();
  const ids = new Set(files.map(file => file.name.slice(0, 36)).filter(id => uuid.test(id)));
  let deleted = 0;
  for (const id of ids) {
    if (active.has(id)) continue;
    const group = files.filter(file => belongsTo(file.name, id));
    if (Math.max(...group.map(file => file.modified)) >= now - 60 * 60 * 1000) continue;
    await withImage(id, async () => {
      // Relee antes de borrar para respetar actividad de otras instancias.
      const current = (await storage.list(id)).filter(file => belongsTo(file.name, id));
      if (current.length && Math.max(...current.map(file => file.modified)) < now - 60 * 60 * 1000) {
        await storage.remove(current.map(file => file.name)); deleted++;
      }
    });
  }
  return deleted;
}
