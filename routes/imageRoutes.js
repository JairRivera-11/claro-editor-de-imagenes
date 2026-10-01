import { uploadToken, cleanupIncoming } from '../services/cloudUploads.js';
import { storageMode, maxUploadBytes } from '../services/config.js';
import { cleanupExpired } from '../services/imageService.js';
import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { removeBackground, uploadBackground, compose, cleanup } from '../controllers/imageController.js';
import { httpError } from '../services/imageService.js';

const types = { 'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/webp': ['.webp'] };
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxUploadBytes, files: 1, fields: 2, parts: 3 },
  fileFilter(req, file, callback) {
    const valid = types[file.mimetype]?.includes(path.extname(file.originalname).toLowerCase());
    callback(valid ? null : httpError(400, 'Usa una imagen PNG, JPG o WebP con extensión y MIME coincidentes.'), Boolean(valid));
  },
});

// Evita acumular buffers y ejecuciones ONNX simultáneas en una aplicación local.
let processing = false;
function processingSlot(req, res, next) {
  if (processing) return next(httpError(429, 'Hay otra imagen en proceso. Inténtalo de nuevo en unos segundos.'));
  processing = true;
  res.locals.releaseSlot = () => { processing = false; };
  next();
}
function releaseOnUploadError(error, req, res, next) {
  res.locals.releaseSlot?.();
  next(error);
}
const router = Router();
router.get('/config', (req, res) => res.set('Cache-Control', 'no-store').json({ success: true, storage: storageMode, maxUploadBytes }));
router.post('/blob-upload', uploadToken);
router.get('/cron/cleanup', async (req, res, next) => {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) throw httpError(503, 'Configura CRON_SECRET para habilitar la limpieza programada.');
    const expected = Buffer.from(`Bearer ${secret}`), received = Buffer.from(req.get('authorization') || '');
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw httpError(401, 'No autorizado.');
    const deleted = await cleanupExpired();
    await cleanupIncoming();
    res.set('Cache-Control', 'no-store').json({ success: true, deleted });
  } catch (error) { next(error); }
});
router.post('/remove-bg', processingSlot, upload.single('image'), removeBackground, releaseOnUploadError);
router.post('/background', upload.single('image'), uploadBackground);
router.post('/compose', compose);
router.delete('/cleanup/:imageId', cleanup);
export default router;
