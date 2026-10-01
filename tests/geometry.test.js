import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleBounds, placement } from '../public/geometry.js';
function fixture() {
  const data = new Uint8Array(200 * 200 * 4);
  function rect(x, y, w, h, alpha = 255) {
    for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) data[(row * 200 + col) * 4 + 3] = alpha;
  }
  return { data, rect };
}
test('centra el producto sin incluir motas desconectadas incluso opacas', () => {
  const { data, rect } = fixture(); rect(40, 20, 100, 120);
  rect(60, 185, 3, 2, 20); rect(10, 180, 2, 2); rect(170, 2, 1, 1);
  const before = data.slice();
  const bounds = visibleBounds(data, 200, 200);
  assert.deepEqual(bounds, { left: 40, top: 20, width: 100, height: 120 });
  const box = placement(200, 200, bounds, 200, 200, true, true, { x: 0, y: 0, scale: 1 });
  assert.equal(box.top + bounds.top, 40);
  assert.equal(200 - (box.top + bounds.top + bounds.height), 40);
  assert.deepEqual(data, before, 'el cálculo no altera los píxeles');
});
test('conserva varios objetos separados y detalles unidos por diagonales', () => {
  const { data, rect } = fixture(); rect(10, 20, 80, 100); rect(120, 30, 30, 70);
  rect(90, 120, 1, 1); rect(91, 121, 1, 1);
  assert.deepEqual(visibleBounds(data, 200, 200), { left: 10, top: 20, width: 140, height: 102 });
});
test('maneja un sujeto tenue y una imagen completamente transparente', () => {
  const { data, rect } = fixture();
  assert.deepEqual(visibleBounds(data, 200, 200), { left: 0, top: 0, width: 200, height: 200 });
  rect(30, 50, 40, 70, 8);
  assert.deepEqual(visibleBounds(data, 200, 200), { left: 30, top: 50, width: 40, height: 70 });
});
