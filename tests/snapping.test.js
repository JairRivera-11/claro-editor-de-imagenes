import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapAxis, SNAP_HOLD_MS } from '../public/snapping.js';

test('captura cerca del centro y mantiene una pausa antes de liberar', () => {
  const axis = { previous: -0.1, locked: false };
  assert.equal(snapAxis(axis, -0.01, 0, 500, 0), 0);
  assert.equal(snapAxis(axis, 0.1, 0, 500, SNAP_HOLD_MS - 1), 0);
  assert.equal(snapAxis(axis, 0.1, 0, 500, SNAP_HOLD_MS + 1), 0.1);
  assert.equal(axis.locked, false);
});
test('el cruce rápido también activa el ajuste y puede volver a capturarlo', () => {
  const axis = { previous: -0.2, locked: false };
  assert.equal(snapAxis(axis, 0.2, 0, 500, 0), 0);
  assert.equal(snapAxis(axis, 0.2, 0, 500, 121), 0.2);
  assert.equal(snapAxis(axis, -0.2, 0, 500, 150), 0);
});
test('la zona de salida evita vibraciones y usa píxeles de pantalla', () => {
  for (const screen of [200, 1000]) {
    const axis = { previous: 0.5, locked: false };
    const target = 0.25;
    assert.equal(snapAxis(axis, target + 7 / screen, target, screen, 0), target);
    assert.equal(snapAxis(axis, target + 14 / screen, target, screen, 1000), target);
    assert.equal(snapAxis(axis, target + 17 / screen, target, screen, 1001), target + 17 / screen);
  }
});
