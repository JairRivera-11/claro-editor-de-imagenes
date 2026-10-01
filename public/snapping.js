export const SNAP_HOLD_MS = 120;
const CAPTURE_PX = 8;
const RELEASE_PX = 16;

// Histéresis: entrar requiere 8 px; salir requiere 16 px y una pausa de 120 ms.
// Se mide en píxeles de pantalla para mantener el tacto con cualquier zoom o lienzo.
export function snapAxis(axis, raw, target, screenSize, now) {
  const distance = (raw - target) * screenSize;
  const previous = (axis.previous - target) * screenSize;
  axis.previous = raw;
  if (axis.locked) {
    if (now < axis.until || Math.abs(distance) <= RELEASE_PX) return target;
    axis.locked = false;
    return raw;
  }
  const crossed = previous * distance < 0;
  if (Math.abs(distance) <= CAPTURE_PX || crossed) {
    axis.locked = true;
    axis.until = now + SNAP_HOLD_MS;
    return target;
  }
  return raw;
}
