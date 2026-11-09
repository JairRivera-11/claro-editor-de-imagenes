import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { preserveOriginalAlpha } from '../services/imageService.js';

test('combina la máscara con el alfa original y conserva los colores de entrada', async () => {
  const raw = { width: 3, height: 1, channels: 4 };
  const source = await sharp(Buffer.from([10, 20, 30, 0, 40, 50, 60, 128, 70, 80, 90, 255]), { raw }).png().toBuffer();
  const mask = await sharp(Buffer.from([200, 200, 200, 255, 200, 200, 200, 128, 200, 200, 200, 0]), { raw }).png().toBuffer();
  const result = await sharp(await preserveOriginalAlpha(source, mask)).raw().toBuffer();
  assert.deepEqual([...result], [10, 20, 30, 0, 40, 50, 60, 64, 70, 80, 90, 0]);
  const wrongSize = await sharp({ create: { width: 2, height: 1, channels: 4, background: '#fff' } }).png().toBuffer();
  await assert.rejects(preserveOriginalAlpha(source, wrongSize), /dimensiones/);
});
