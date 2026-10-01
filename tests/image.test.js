import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
// Aísla todos los uploads, incluida la prueba de caducidad, de los datos del usuario.
const testDir = await mkdtemp(path.join(tmpdir(), 'claro-test-'));
process.env.REMBG_UPLOADS_DIR = testDir;
const { startServer } = await import('../server.js');
const { uploadsDir, cleanup, cleanupExpired } = await import('../services/imageService.js');

let server, base, subject;
const ids = new Set();
const imageId = randomUUID(); ids.add(imageId);
before(async () => {
  await writeFile(path.join(testDir, '.gitkeep'), '');
  server = await startServer(0);
  await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  subject = await sharp({ create: { width: 80, height: 40, channels: 4, background: '#ff0000' } }).png().toBuffer();
  await writeFile(path.join(uploadsDir, `${imageId}.png`), subject);
});
after(async () => {
  await Promise.all([...ids].map(id => cleanup(id)));
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(testDir, { recursive: true, force: true });
});
const payload = (background, extra = {}) => ({ imageId, background, size: { width: 100, height: 100, maintainAspect: true }, format: 'png', quality: 90, ...extra });
async function compose(body) {
  const response = await fetch(`${base}/api/compose`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { response, body: await response.json() };
}
async function pixels(url) {
  const response = await fetch(`${base}${url}`);
  assert.equal(response.status, 200);
  const buffer = Buffer.from(await response.arrayBuffer());
  return sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}
const pixel = (data, info, x, y) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)];

test('sirve la página y devuelve errores JSON para rutas y JSON inválidos', async () => {
  assert.match(await (await fetch(base)).text(), /Tu imagen/);
  const missing = await fetch(`${base}/unknown`);
  assert.equal(missing.status, 404); assert.equal((await missing.json()).success, false);
  const malformed = await fetch(`${base}/api/compose`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400); assert.equal((await malformed.json()).success, false);
});
test('configuración pública sin secretos y cron protegido', async () => {
  const config = await (await fetch(`${base}/api/config`)).json();
  assert.deepEqual(config, { success: true, storage: 'local', maxUploadBytes: 10 * 1024 * 1024 });
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'test-only-secret';
  try {
    assert.equal((await fetch(`${base}/api/cron/cleanup`)).status, 401);
    assert.equal((await fetch(`${base}/api/cron/cleanup`, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    const response = await fetch(`${base}/api/cron/cleanup`, { headers: { Authorization: 'Bearer test-only-secret' } });
    assert.equal(response.status, 200); assert.equal((await response.json()).success, true);
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous;
  }
});
test('mantiene proporción, transparencia y centrado en un lienzo exacto', async () => {
  const { response, body } = await compose(payload({ type: 'transparent' }));
  assert.equal(response.status, 200);
  const { data, info } = await pixels(body.url);
  assert.equal(info.width, 100); assert.equal(info.height, 100);
  assert.equal(pixel(data, info, 50, 0)[3], 0);
  assert.deepEqual(pixel(data, info, 50, 50), [255, 0, 0, 255]);
  assert.equal(pixel(data, info, 50, 24)[3], 0);
  assert.equal(pixel(data, info, 50, 25)[3], 255);
});
test('centra el contenido visible en ambos ejes sin cambiar su escala ni su alfa', async () => {
  const id = randomUUID(); ids.add(id);
  const rgba = Buffer.alloc(100 * 100 * 4);
  for (let y = 0; y < 30; y++) {
    for (let x = 70; x < 90; x++) {
      const offset = (y * 100 + x) * 4;
      rgba[offset] = 255;
      rgba[offset + 3] = x === 70 ? 64 : 255;
    }
  }
  await writeFile(path.join(uploadsDir, `${id}.png`), await sharp(rgba, { raw: { width: 100, height: 100, channels: 4 } }).png().toBuffer());
  for (const maintainAspect of [true, false]) {
    const result = await compose(payload({ type: 'transparent' }, { imageId: id, centerSubject: true, size: { width: 100, height: 100, maintainAspect } }));
    assert.equal(result.response.status, 200);
    const { data, info } = await pixels(result.body.url);
    assert.equal(info.width, 100); assert.equal(info.height, 100);
    // Compara todos los píxeles: solo debe cambiar la posición del rectángulo visible.
    for (let y = 0; y < 100; y++) {
      for (let x = 0; x < 100; x++) {
        const alpha = x >= 40 && x < 60 && y >= 35 && y < 65 ? (x === 40 ? 64 : 255) : 0;
        assert.equal(pixel(data, info, x, y)[3], alpha);
      }
    }
  }
  const original = await compose(payload({ type: 'transparent' }, { imageId: id, centerSubject: false }));
  const restored = await pixels(original.body.url);
  assert.equal(pixel(restored.data, restored.info, 70, 0)[3], 64);
  assert.equal(pixel(restored.data, restored.info, 50, 50)[3], 0);
});
test('centrar conserva imágenes vacías y sujetos que ya están centrados', async () => {
  const id = randomUUID(); ids.add(id);
  await writeFile(path.join(uploadsDir, `${id}.png`), await sharp({ create: { width: 100, height: 100, channels: 4, background: '#00000000' } }).png().toBuffer());
  const empty = await compose(payload({ type: 'transparent' }, { imageId: id, centerSubject: true }));
  assert.equal(empty.response.status, 200);
  const blank = await pixels(empty.body.url);
  assert.equal(blank.data.every(value => value === 0), true);
  const centered = await compose(payload({ type: 'transparent' }, { centerSubject: true }));
  const original = await compose(payload({ type: 'transparent' }));
  assert.deepEqual((await pixels(centered.body.url)).data, (await pixels(original.body.url)).data);
  for (const value of ['true', null, 1]) {
    assert.equal((await compose(payload({ type: 'transparent' }, { centerSubject: value }))).response.status, 400);
  }
});
test('ignora residuos casi transparentes al centrar y conserva los píxeles', async () => {
  const id = randomUUID(); ids.add(id);
  const data = Buffer.alloc(100 * 100 * 4);
  for (let y = 10; y < 30; y++) for (let x = 70; x < 90; x++) {
    const offset = (y * 100 + x) * 4; data[offset] = 255; data[offset + 3] = 255;
  }
  data[3] = 1; data[(99 * 100 + 99) * 4 + 3] = 1;
  await writeFile(path.join(uploadsDir, `${id}.png`), await sharp(data, { raw: { width: 100, height: 100, channels: 4 } }).png().toBuffer());
  const result = await compose(payload({ type: 'transparent' }, { imageId: id, centerSubject: true }));
  assert.equal(result.response.status, 200);
  const output = await pixels(result.body.url);
  assert.deepEqual(pixel(output.data, output.info, 40, 40), [255, 0, 0, 255]);
  assert.equal(pixel(output.data, output.info, 59, 59)[3], 255);
  assert.equal(pixel(output.data, output.info, 60, 60)[3], 0);
});
test('exporta desplazamiento, escala y recorte fuera del lienzo', async () => {
  const id = randomUUID(); ids.add(id);
  const small = await sharp({ create: { width: 20, height: 20, channels: 4, background: '#ff0000' } }).png().toBuffer();
  const source = await sharp({ create: { width: 100, height: 100, channels: 4, background: '#00000000' } }).composite([{ input: small, left: 40, top: 40 }]).png().toBuffer();
  await writeFile(path.join(uploadsDir, `${id}.png`), source);
  const moved = await compose(payload({ type: 'transparent' }, { imageId: id, centerSubject: true, transform: { x: 0.2, y: -0.1, scale: 1 } }));
  assert.equal(moved.response.status, 200);
  const out = await pixels(moved.body.url);
  assert.equal(pixel(out.data, out.info, 60, 30)[3], 255);
  assert.equal(pixel(out.data, out.info, 79, 49)[3], 255);
  assert.equal(pixel(out.data, out.info, 50, 50)[3], 0);
  const enlarged = await compose(payload({ type: 'transparent' }, { imageId: id, centerSubject: true, transform: { x: 0, y: 0, scale: 2 } }));
  assert.equal(enlarged.response.status, 200);
  const zoom = await pixels(enlarged.body.url);
  assert.equal(pixel(zoom.data, zoom.info, 35, 35)[3], 255);
  const clipped = await compose(payload({ type: 'transparent' }, { imageId: id, transform: { x: 0.5, y: 0, scale: 1 } }));
  assert.equal(clipped.response.status, 200);
  const clip = await pixels(clipped.body.url);
  assert.equal(pixel(clip.data, clip.info, 99, 50)[3], 255);
  assert.equal(pixel(clip.data, clip.info, 89, 50)[3], 0);
  const outside = await compose(payload({ type: 'color', value: '#00ff00' }, { imageId: id, transform: { x: 2, y: 2, scale: 1 } }));
  assert.equal(outside.response.status, 200);
  const empty = await pixels(outside.body.url);
  assert.deepEqual(pixel(empty.data, empty.info, 50, 50), [0, 255, 0, 255]);
  for (const transform of [null, {}, { x: '0', y: 0, scale: 1 }, { x: 3, y: 0, scale: 1 }, { x: 0, y: 0, scale: 0 }, { x: 0, y: 0, scale: 2.1 }]) {
    assert.equal((await compose(payload({ type: 'transparent' }, { transform }))).response.status, 400);
  }
});
test('permite estirar el sujeto y genera color sólido', async () => {
  const preserved = await compose(payload({ type: 'color', value: '#00ff00' }));
  const first = await pixels(preserved.body.url);
  assert.deepEqual(pixel(first.data, first.info, 0, 0), [0, 255, 0, 255]);
  const stretched = await compose(payload({ type: 'color', value: '#00ff00' }, { size: { width: 100, height: 100, maintainAspect: false } }));
  const second = await pixels(stretched.body.url);
  assert.deepEqual(pixel(second.data, second.info, 0, 0), [255, 0, 0, 255]);
});
test('genera los cuatro degradados sin aceptar SVG arbitrario', async () => {
  for (const value of ['sunset', 'ocean', 'lavender', 'midnight']) {
    const result = await compose(payload({ type: 'gradient', value }));
    assert.equal(result.response.status, 200);
    const { data, info } = await pixels(result.body.url);
    assert.notDeepEqual(pixel(data, info, 0, 0), pixel(data, info, 99, 99));
  }
  assert.equal((await compose(payload({ type: 'gradient', value: '<svg/>' }))).response.status, 400);
});
test('exporta JPEG y aplana la transparencia sobre blanco', async () => {
  const result = await compose(payload({ type: 'transparent' }, { format: 'jpeg' }));
  const buffer = Buffer.from(await (await fetch(`${base}${result.body.url}`)).arrayBuffer());
  const meta = await sharp(buffer).metadata();
  assert.equal(meta.format, 'jpeg'); assert.equal(meta.hasAlpha, false);
  const { data, info } = await pixels(result.body.url);
  assert.ok(pixel(data, info, 0, 0).slice(0, 3).every(value => value > 245));
});
test('sube un fondo, lo vincula al sujeto y compone la imagen', async () => {
  const blue = await sharp({ create: { width: 30, height: 60, channels: 3, background: '#0000ff' } }).png().toBuffer();
  const form = new FormData(); form.append('image', new Blob([blue], { type: 'image/png' }), 'blue.png'); form.append('imageId', imageId);
  const uploaded = await fetch(`${base}/api/background`, { method: 'POST', body: form });
  assert.equal(uploaded.status, 200);
  const { fileId } = await uploaded.json();
  const result = await compose(payload({ type: 'image', fileId }));
  const { data, info } = await pixels(result.body.url);
  assert.deepEqual(pixel(data, info, 0, 0), [0, 0, 255, 255]);
  assert.equal((await compose(payload({ type: 'image', fileId: randomUUID() }))).response.status, 404);
});
test('rechaza tamaños, identificadores, formatos y calidades inválidos', async () => {
  for (const extra of [
    { imageId: '../../etc/passwd' }, { size: { width: 4096, height: 4096, maintainAspect: true } },
    { size: { width: 0, height: 100, maintainAspect: true } }, { size: { width: 1.5, height: 100, maintainAspect: true } },
    { size: { width: 100, height: 100, maintainAspect: 'true' } }, { format: 'svg' }, { quality: 101 },
  ]) {
    const result = await compose(payload({ type: 'transparent' }, extra));
    assert.equal(result.response.status, 400); assert.equal(result.body.success, false);
  }
  assert.equal((await compose(payload({ type: 'transparent' }, { imageId: randomUUID() }))).response.status, 404);
});
test('valida MIME, extensión, contenido real, archivo obligatorio y límite de 10 MB', async () => {
  for (const [data, mime, filename, expected] of [
    [subject, 'text/plain', 'test.png', 400], [subject, 'image/png', 'test.txt', 400],
    [Buffer.from('fake png'), 'image/png', 'test.png', 400],
    [subject, 'image/jpeg', 'test.jpg', 400], [Buffer.alloc(10 * 1024 * 1024 + 1), 'image/png', 'big.png', 413],
  ]) {
    const form = new FormData(); form.append('image', new Blob([data], { type: mime }), filename);
    const response = await fetch(`${base}/api/remove-bg`, { method: 'POST', body: form });
    assert.equal(response.status, expected); assert.equal((await response.json()).success, false);
  }
  const missing = await fetch(`${base}/api/remove-bg`, { method: 'POST', body: new FormData() });
  assert.equal(missing.status, 400);
});
test('borra sujeto, fondos y composiciones; cleanup es idempotente', async () => {
  const id = randomUUID(); ids.add(id);
  await writeFile(path.join(uploadsDir, `${id}.png`), subject);
  await compose(payload({ type: 'transparent' }, { imageId: id }));
  await writeFile(path.join(uploadsDir, `${id}-bg-${randomUUID()}.png`), subject);
  for (let i = 0; i < 2; i++) {
    const response = await fetch(`${base}/api/cleanup/${id}`, { method: 'DELETE' }); assert.equal(response.status, 200);
  }
  assert.equal((await readdir(uploadsDir)).some(name => name.startsWith(id)), false);
});
test('limpia grupos inactivos durante más de una hora y conserva .gitkeep', async () => {
  await cleanupExpired(Date.now() + 61 * 60 * 1000);
  const names = await readdir(uploadsDir);
  assert.equal(names.some(name => name.startsWith(imageId)), false);
  assert.equal(names.includes('.gitkeep'), true);
});
test('inferencia real con rmbg/Briaai y descarga del PNG resultante', { skip: process.env.RMBG_INTEGRATION !== '1', timeout: 300_000 }, async () => {
  const image = await sharp(Buffer.from('<svg width="256" height="256"><rect width="256" height="256" fill="white"/><circle cx="128" cy="128" r="75" fill="red"/></svg>')).png().toBuffer();
  const form = new FormData(); form.append('image', new Blob([image], { type: 'image/png' }), 'circle.png');
  const response = await fetch(`${base}/api/remove-bg`, { method: 'POST', body: form });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result)); ids.add(result.imageId);
  const { data, info } = await pixels(result.url);
  assert.equal(info.width, 256); assert.equal(info.height, 256);
  assert.ok(pixel(data, info, 0, 0)[3] < 128, 'el fondo debe ser transparente');
  assert.ok(pixel(data, info, 128, 128)[3] > 128, 'el sujeto debe conservarse');
});
