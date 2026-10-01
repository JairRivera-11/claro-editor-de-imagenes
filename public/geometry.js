// Compartido por el editor y el servidor para usar las mismas coordenadas.
export function visibleBounds(data, width, height, channels = 4) {
  const count = width * height;
  const mask = new Uint8Array(count);
  const queue = new Uint32Array(count);
  let maximumAlpha = 0;
  for (let i = 0; i < count; i++) maximumAlpha = Math.max(maximumAlpha, data[i * channels + channels - 1]);
  if (!maximumAlpha) return { left: 0, top: 0, width, height };
  const threshold = maximumAlpha >= 16 ? 16 : 1;
  function fillMask() {
    for (let i = 0; i < count; i++) mask[i] = data[i * channels + channels - 1] >= threshold ? 1 : 0;
  }
  function component(start) {
    let read = 0, length = 1, left = width, right = -1, top = height, bottom = -1;
    queue[0] = start; mask[start] = 0;
    while (read < length) {
      const index = queue[read++], x = index % width, y = Math.floor(index / width);
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
      // Ocho vecinos mantienen unidos los contornos diagonales y detalles finos.
      for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
          const neighbor = ny * width + nx;
          if (mask[neighbor]) { mask[neighbor] = 0; queue[length++] = neighbor; }
        }
      }
    }
    return { area: length, left, right, top, bottom };
  }
  // Dos recorridos acotan la memoria incluso si hay millones de motas aisladas.
  // Conservamos componentes con al menos el 0.1% del área del mayor, incluidos
  // sujetos separados de tamaño relevante. Las motas no desvían el centro.
  fillMask();
  let largest = 0;
  for (let i = 0; i < count; i++) if (mask[i]) largest = Math.max(largest, component(i).area);
  fillMask();
  let left = width, right = -1, top = height, bottom = -1;
  for (let i = 0; i < count; i++) {
    if (!mask[i]) continue;
    const part = component(i);
    if (part.area < largest * 0.001) continue;
    left = Math.min(left, part.left); right = Math.max(right, part.right);
    top = Math.min(top, part.top); bottom = Math.max(bottom, part.bottom);
  }
  // Solo calcula el centro: no elimina residuos, sombras ni objetos del PNG.
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}
export function placement(originalWidth, originalHeight, bounds, width, height, maintainAspect, centerSubject, transform) {
  const fit = Math.min(width / originalWidth, height / originalHeight);
  const subjectWidth = Math.max(1, Math.round((maintainAspect ? originalWidth * fit : width) * transform.scale));
  const subjectHeight = Math.max(1, Math.round((maintainAspect ? originalHeight * fit : height) * transform.scale));
  const centerX = centerSubject ? (bounds.left + bounds.width / 2) / originalWidth : 0.5;
  const centerY = centerSubject ? (bounds.top + bounds.height / 2) / originalHeight : 0.5;
  return {
    width: subjectWidth, height: subjectHeight,
    left: Math.round(width / 2 - centerX * subjectWidth + transform.x * width),
    top: Math.round(height / 2 - centerY * subjectHeight + transform.y * height),
  };
}
