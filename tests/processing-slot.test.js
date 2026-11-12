import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createProcessingSlot, releaseOnUploadError } from '../services/processingSlot.js';
import { resolveEngine } from '../services/segmentation.js';
const request = () => Object.assign(new EventEmitter(), { complete: true });
const response = () => Object.assign(new EventEmitter(), { locals: {} });
test('un solo cupo, cierre de respuesta no libera inferencia y release es idempotente', () => {
  const slot = createProcessingSlot(), req = request(), res = response();
  slot(req, res, assert.ifError);
  res.emit('close'); req.emit('aborted');
  slot(request(), response(), error => assert.equal(error.status, 429));
  res.locals.releaseSlot();
  const second = response(); slot(request(), second, assert.ifError);
  res.locals.releaseSlot();
  slot(request(), response(), error => assert.equal(error.status, 429));
  second.locals.releaseSlot(); slot(request(), response(), assert.ifError);
});
test('subida interrumpida y errores de multer liberan el cupo', () => {
  const slot = createProcessingSlot(), req = request(), res = response(); req.complete = false;
  slot(req, res, assert.ifError); req.emit('aborted');
  const second = response(); slot(request(), second, assert.ifError);
  const error = new Error('multipart'); releaseOnUploadError(error, request(), second, e => assert.equal(e, error));
  slot(request(), response(), assert.ifError);
});
test('perfil de 2 GB migra Lite previo y bloquea motores pesados', () => {
  assert.equal(resolveEngine('birefnet-lite', true), 'birefnet-lite-efficient');
  assert.equal(resolveEngine('birefnet-lite-efficient', true), 'birefnet-lite-efficient');
  assert.equal(resolveEngine('birefnet-lite', false), 'birefnet-lite');
  assert.throws(() => resolveEngine('birefnet', true), { status: 503 });
});
