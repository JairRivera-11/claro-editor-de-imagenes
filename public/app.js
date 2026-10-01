import { snapAxis } from './snapping.js';
import { visibleBounds, placement } from './geometry.js';
const $ = id => document.getElementById(id);
const state = { imageId: null, backgroundId: null, background: 'transparent', gradient: 'sunset', busy: false, originalUrl: null, originalWidth: 0, originalHeight: 0, finalUrl: null, subject: null, backgroundImage: null, bounds: null, centerSubject: false, transform: { x: 0, y: 0, scale: 1 } };
const allowed = { 'image/png': /\.png$/i, 'image/jpeg': /\.jpe?g$/i, 'image/webp': /\.webp$/i };
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function busy(value, message = '') {
  state.busy = value;
  $('editor').disabled = value || !state.imageId;
  $('replace').disabled = value;
  $('dropzone').disabled = value;
  $('loading').hidden = !value;
  $('loading-title').textContent = message;
  $('preview-area').setAttribute('aria-busy', String(value));
  if (value) $('download').classList.add('disabled');
  else if (state.finalUrl) $('download').classList.remove('disabled');
  $('download').setAttribute('aria-disabled', String(value || !state.finalUrl));
}
function validateFile(file) {
  if (!file || !allowed[file.type]?.test(file.name)) throw new Error('Selecciona una imagen PNG, JPG o WebP.');
  if (file.size > 10 * 1024 * 1024) throw new Error('El archivo supera el límite de 10 MB.');
}
async function request(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => { throw new Error('El servidor devolvió una respuesta inesperada.'); });
  if (!response.ok || !body.success) throw new Error(body.error || 'No se pudo completar la solicitud.');
  return body;
}
function preload(url) {
  return new Promise((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('No se pudo cargar la vista previa. Vuelve a intentarlo.')); if (/^https?:/.test(url)) image.crossOrigin = 'anonymous'; image.src = url;
  });
}
function download(url, filename) {
  state.finalUrl = url;
  $('download').href = url; $('download').download = filename;
  $('download').classList.remove('disabled'); $('download').setAttribute('aria-disabled', 'false');
}
function invalidate() {
  state.finalUrl = null;
  $('download').removeAttribute('href'); $('download').classList.add('disabled'); $('download').setAttribute('aria-disabled', 'true');
  $('download-note').textContent = 'Aplica los cambios para actualizar la descarga.';
  render();
  status('Vista previa actualizada. Pulsa “Aplicar cambios” para preparar la descarga.');
}
async function upload(file) {
  if (state.busy || !file) return;
  let newId;
  try {
    validateFile(file); busy(true, 'Quitando el fondo…'); status('Procesando tu imagen. La primera ejecución descarga el modelo de IA.');
    const result = await uploadFile('/api/remove-bg', file);
    newId = result.imageId;
    const image = await preload(result.url);
    const oldId = state.imageId;
    state.imageId = newId; state.backgroundId = null; state.originalUrl = result.url;
    state.subject = image; state.backgroundImage = null; state.centerSubject = false; state.transform = { x: 0, y: 0, scale: 1 };
    const probe = document.createElement('canvas'); probe.width = image.naturalWidth; probe.height = image.naturalHeight;
    const context = probe.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0);
    state.bounds = visibleBounds(context.getImageData(0, 0, probe.width, probe.height).data, probe.width, probe.height);
    state.originalWidth = image.naturalWidth; state.originalHeight = image.naturalHeight;
    $('width').value = image.naturalWidth; $('height').value = image.naturalHeight;
    $('background-input').value = ''; $('background-name').textContent = 'PNG, JPG o WebP · Hasta 10 MB';
    $('format').value = 'png'; $('quality-control').hidden = true; $('maintain-aspect').checked = true; $('scale').value = 100; $('scale-value').textContent = '100%';
    selectBackground('transparent', false);
    $('preview-label').textContent = 'Arrastra para mover';
    $('dropzone').hidden = true; $('preview-area').hidden = false; $('replace').hidden = false; render();
    $('image-details').textContent = `${image.naturalWidth} × ${image.naturalHeight} px · PNG transparente`;
    download(result.url, 'claro-sin-fondo.png'); $('download-note').textContent = 'Tu PNG transparente está listo para descargar.';
    status('Fondo eliminado. Descarga el PNG o personaliza tu imagen.');
    if (oldId) request(`/api/cleanup/${oldId}`, { method: 'DELETE' }).catch(() => {});
  } catch (error) {
    status(error.message, true);
    if (newId && newId !== state.imageId) request(`/api/cleanup/${newId}`, { method: 'DELETE' }).catch(() => {});
  } finally { busy(false); $('image-input').value = ''; }
}
function selectBackground(type, markDirty = true) {
  state.background = type;
  document.querySelectorAll('[data-bg]').forEach(button => {
    const selected = button.dataset.bg === type;
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
    $(`bg-${button.dataset.bg}`).hidden = !selected;
  });
  if (markDirty) invalidate();
}
$('dropzone').addEventListener('click', () => $('image-input').click());
$('replace').addEventListener('click', () => $('image-input').click());
$('image-input').addEventListener('change', event => upload(event.target.files[0]));
for (const event of ['dragenter', 'dragover']) $('dropzone').addEventListener(event, e => { e.preventDefault(); $('dropzone').classList.add('dragover'); });
for (const event of ['dragleave', 'drop']) $('dropzone').addEventListener(event, e => { e.preventDefault(); $('dropzone').classList.remove('dragover'); });
$('dropzone').addEventListener('drop', event => {
  if (event.dataTransfer.files.length !== 1) return status('Arrastra una sola imagen.', true);
  upload(event.dataTransfer.files[0]);
});
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => event.preventDefault());
document.querySelectorAll('[data-bg]').forEach(button => button.addEventListener('click', () => selectBackground(button.dataset.bg)));
document.querySelectorAll('[data-gradient]').forEach(button => button.addEventListener('click', () => {
  state.gradient = button.dataset.gradient;
  document.querySelectorAll('[data-gradient]').forEach(item => { item.classList.toggle('selected', item === button); item.setAttribute('aria-pressed', String(item === button)); });
  invalidate();
}));
$('color').addEventListener('input', () => { $('color-value').textContent = $('color').value.toUpperCase(); invalidate(); });
$('background-input').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file || state.busy) return;
  try {
    validateFile(file); busy(true, 'Preparando tu nuevo fondo…');
    const result = await uploadFile('/api/background', file, state.imageId);
    const localUrl = URL.createObjectURL(file);
    try { state.backgroundImage = await preload(localUrl); } finally { URL.revokeObjectURL(localUrl); }
    state.backgroundId = result.fileId; $('background-name').textContent = file.name; invalidate();
  } catch (error) { status(error.message, true); }
  finally { event.target.value = ''; busy(false); }
});
for (const id of ['width', 'height', 'maintain-aspect']) $(id).addEventListener('input', invalidate);
document.querySelectorAll('[data-size]').forEach(button => button.addEventListener('click', () => {
  const [width, height] = button.dataset.size.split(','); $('width').value = width; $('height').value = height; invalidate();
}));
$('format').addEventListener('change', () => { $('quality-control').hidden = $('format').value !== 'jpeg'; invalidate(); });
$('quality').addEventListener('input', () => { $('quality-value').textContent = `${$('quality').value}%`; invalidate(); });
$('editor-form').addEventListener('submit', async event => {
  event.preventDefault(); if (state.busy || !state.imageId) return;
  try {
    if (state.background === 'image' && !state.backgroundId) throw new Error('Sube una imagen para el fondo.');
    const width = Number($('width').value), height = Number($('height').value);
    if (width * height > 16_000_000) throw new Error('El tamaño final debe tener un máximo de 16 megapíxeles.');
    busy(true, 'Creando tu composición…'); status('Aplicando tus cambios…');
    const background = { type: state.background };
    if (state.background === 'color') background.value = $('color').value;
    if (state.background === 'gradient') background.value = state.gradient;
    if (state.background === 'image') background.fileId = state.backgroundId;
    const result = await request('/api/compose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      imageId: state.imageId, background, centerSubject: state.centerSubject, transform: state.transform, size: { width, height, maintainAspect: $('maintain-aspect').checked }, format: $('format').value, quality: Number($('quality').value),
    }) });
    await preload(result.url);
    render(); $('preview-label').textContent = 'Arrastra para seguir ajustando';
    $('image-details').textContent = `${result.width} × ${result.height} px · ${$('format').value === 'jpeg' ? 'JPG' : 'PNG'}`;
    download(result.url, `claro-${result.width}x${result.height}.${$('format').value === 'jpeg' ? 'jpg' : 'png'}`);
    $('download-note').textContent = 'Todo listo. Llévate tu creación.'; status('Cambios aplicados. Tu imagen está lista para descargar.');
  } catch (error) { status(error.message, true); }
  finally { busy(false); }
});
$('download').addEventListener('click', async event => {
  if (state.busy || !state.finalUrl) { event.preventDefault(); return; }
  if (new URL(state.finalUrl, location.href).origin === location.origin) return;
  // El atributo download no funciona con URLs de otro origen. Descargamos desde
  // Blob directamente y creamos una URL local, sin pasar binarios por la Function.
  event.preventDefault();
  const url = state.finalUrl, filename = $('download').download;
  try {
    busy(true, 'Preparando la descarga…');
    const response = await fetch(url);
    if (!response.ok) throw new Error('La imagen ya no está disponible para descargar.');
    const local = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = local; link.download = filename;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(local), 60_000);
  } catch (error) { status(error.message, true); }
  finally { busy(false); }
});

let runtimeConfig;
function getRuntimeConfig() {
  runtimeConfig ||= request('/api/config').then(config => {
    if (config.storage === 'blob') {
      document.querySelector('.local-badge').innerHTML = '<i></i> Estudio en la nube';
      $('retention-note').textContent = 'Archivos temporales en la nube. Limpieza automática diaria de imágenes inactivas.';
    }
    return config;
  }).catch(error => { runtimeConfig = undefined; throw error; });
  return runtimeConfig;
}
async function uploadFile(endpoint, file, imageId) {
  const config = await getRuntimeConfig();
  if (config.storage !== 'blob') {
    const form = new FormData(); form.append('image', file);
    if (imageId) form.append('imageId', imageId);
    return request(endpoint, { method: 'POST', body: form });
  }
  const { upload } = await import('./blob-client.js');
  const extension = file.name.split('.').at(-1).toLowerCase();
  const result = await upload(`claro/incoming/${crypto.randomUUID()}.${extension}`, file, {
    access: 'public', handleUploadUrl: '/api/blob-upload', contentType: file.type,
  });
  return request(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadPath: result.pathname, ...(imageId ? { imageId } : {}) }),
  });
}
getRuntimeConfig().catch(error => status(error.message, true));

const gradientColors = { sunset: ['#ff9966', '#ff5e62'], ocean: ['#43cea2', '#185a9d'], lavender: ['#c4b5fd', '#fbcfe8'], midnight: ['#0f172a', '#6366f1'] };
let frame;
function render() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    if (!state.subject) return;
    const width = Number($('width').value), height = Number($('height').value);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 16_000_000) return;
    const canvas = $('preview');
    const factor = Math.min(1, 1400 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * factor)); canvas.height = Math.max(1, Math.round(height * factor));
    const area = $('preview-area');
    const displayScale = Math.min((area.clientWidth - 24) / width, (area.clientHeight - 24) / height);
    canvas.style.width = `${width * displayScale}px`; canvas.style.height = `${height * displayScale}px`;
    const context = canvas.getContext('2d');
    context.scale(canvas.width / width, canvas.height / height);
    if ($('format').value === 'jpeg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height); }
    if (state.background === 'color') { context.fillStyle = $('color').value; context.fillRect(0, 0, width, height); }
    if (state.background === 'gradient') {
      // Equivale al SVG con gradiente diagonal en coordenadas objectBoundingBox.
      const denominator = 1 / (width * width) + 1 / (height * height);
      const dx = 1 / width / denominator, dy = 1 / height / denominator;
      const gradient = context.createLinearGradient(width / 2 - dx, height / 2 - dy, width / 2 + dx, height / 2 + dy);
      gradientColors[state.gradient].forEach((color, index) => gradient.addColorStop(index, color));
      context.fillStyle = gradient; context.fillRect(0, 0, width, height);
    }
    if (state.background === 'image' && state.backgroundImage) {
      const image = state.backgroundImage;
      const fit = Math.max(width / image.naturalWidth, height / image.naturalHeight);
      const w = image.naturalWidth * fit, h = image.naturalHeight * fit;
      context.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
    }
    const box = placement(state.originalWidth, state.originalHeight, state.bounds, width, height, $('maintain-aspect').checked, state.centerSubject, state.transform);
    context.drawImage(state.subject, box.left, box.top, box.width, box.height);
    // Las guías viven sobre el canvas; no forman parte de la imagen descargada.
    const guides = $('alignment-guides');
    guides.style.width = canvas.style.width; guides.style.height = canvas.style.height;
    guides.style.left = `${(area.clientWidth - width * displayScale) / 2}px`;
    guides.style.top = `${(area.clientHeight - height * displayScale) / 2}px`;
    const cx = box.left + (state.bounds.left + state.bounds.width / 2) / state.originalWidth * box.width;
    const cy = box.top + (state.bounds.top + state.bounds.height / 2) / state.originalHeight * box.height;
    const alignedX = Math.abs(cx - width / 2) <= 0.51;
    const alignedY = Math.abs(cy - height / 2) <= 0.51;
    $('guide-vertical').hidden = !alignedX;
    $('guide-horizontal').hidden = !alignedY;
    $('alignment-label').hidden = !alignedX && !alignedY;
    $('alignment-label').textContent = alignedX && alignedY ? '✛ Centrado' : alignedX ? '↔ Centro horizontal' : '↕ Centro vertical';
    $('image-details').textContent = `${width} × ${height} px · Vista previa editable`;
  });
}
new ResizeObserver(render).observe($('preview-area'));
$('center-subject').addEventListener('click', () => {
  state.centerSubject = true; state.transform.x = 0; state.transform.y = 0;
  invalidate(); status('Imagen centrada. Pulsa “Aplicar cambios” para actualizar la descarga.');
});
$('reset-position').addEventListener('click', () => {
  state.centerSubject = false; state.transform = { x: 0, y: 0, scale: 1 };
  $('scale').value = 100; $('scale-value').textContent = '100%'; invalidate();
});
function setScale(value) {
  const percent = Math.max(10, Math.min(200, Math.round(value)));
  state.transform.scale = percent / 100; $('scale').value = percent; $('scale-value').textContent = `${percent}%`; invalidate();
}
$('scale').addEventListener('input', () => setScale(Number($('scale').value)));
let drag = null;
const clampOffset = value => Math.max(-2, Math.min(2, value));
$('preview').addEventListener('pointerdown', event => {
  if (state.busy || !state.subject || (event.pointerType === 'mouse' && event.button !== 0) || drag) return;
  event.preventDefault(); $('preview').focus();
  const width = Number($('width').value), height = Number($('height').value);
  if (!width || !height) return;
  const box = placement(state.originalWidth, state.originalHeight, state.bounds, width, height, $('maintain-aspect').checked, state.centerSubject, state.transform);
  const cx = (state.bounds.left + state.bounds.width / 2) / state.originalWidth;
  const cy = (state.bounds.top + state.bounds.height / 2) / state.originalHeight;
  drag = {
    id: event.pointerId, x: event.clientX, y: event.clientY, startX: state.transform.x, startY: state.transform.y,
    rawX: state.transform.x, rawY: state.transform.y, rect: $('preview').getBoundingClientRect(),
    targetX: state.centerSubject ? 0 : (0.5 - cx) * box.width / width,
    targetY: state.centerSubject ? 0 : (0.5 - cy) * box.height / height,
    axes: { x: { previous: state.transform.x, locked: false }, y: { previous: state.transform.y, locked: false } },
    timer: null,
  };
  $('preview').setPointerCapture(event.pointerId); $('preview').classList.add('dragging');
});
$('preview').addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.id || state.busy) return;
  drag.rawX = clampOffset(drag.startX + (event.clientX - drag.x) / drag.rect.width);
  drag.rawY = clampOffset(drag.startY + (event.clientY - drag.y) / drag.rect.height);
  applyDrag();
});
function applyDrag() {
  if (!drag || state.busy) return;
  const now = performance.now();
  state.transform.x = snapAxis(drag.axes.x, drag.rawX, drag.targetX, drag.rect.width, now);
  state.transform.y = snapAxis(drag.axes.y, drag.rawY, drag.targetY, drag.rect.height, now);
  clearTimeout(drag.timer);
  const deadlines = Object.values(drag.axes).filter(axis => axis.locked && axis.until > now).map(axis => axis.until);
  // Liberación no bloqueante aunque el mouse deje de emitir eventos tras la pausa.
  if (deadlines.length) drag.timer = setTimeout(applyDrag, Math.min(...deadlines) - now + 1);
  invalidate();
}
function stopDrag(event) {
  if (!drag || event.pointerId !== drag.id) return;
  clearTimeout(drag.timer);
  if ($('preview').hasPointerCapture(event.pointerId)) $('preview').releasePointerCapture(event.pointerId);
  drag = null; $('preview').classList.remove('dragging');
}
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) $('preview').addEventListener(name, stopDrag);
$('preview').addEventListener('wheel', event => {
  if (state.busy || !state.subject || drag) return;
  event.preventDefault(); setScale(state.transform.scale * 100 - Math.sign(event.deltaY) * 5);
}, { passive: false });
$('preview').addEventListener('keydown', event => {
  if (state.busy || !state.subject || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const step = event.shiftKey ? 10 : 1;
  const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
  const key = horizontal ? 'x' : 'y';
  const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
  const size = Number($(horizontal ? 'width' : 'height').value);
  if (size > 0) { state.transform[key] = clampOffset(state.transform[key] + direction * step / size); invalidate(); }
});
