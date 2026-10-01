import { root, isVercel } from './services/config.js';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import imageRoutes from './routes/imageRoutes.js';
import { initializeStorage, cleanupExpired, uploadsDir } from './services/imageService.js';

export const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
// La inicialización ocurre también cuando Vercel importa el handler sin app.listen().
let initialization;
app.use('/api', async (req, res, next) => {
  try {
    initialization ||= initializeStorage().catch(error => { initialization = undefined; throw error; });
    await initialization;
    next();
  } catch (error) { next(error); }
});
app.use('/api', imageRoutes);
app.use('/uploads', express.static(uploadsDir, {
  dotfiles: 'deny', maxAge: 0, setHeaders: res => res.setHeader('X-Content-Type-Options', 'nosniff'),
}));
app.use(express.static(path.join(root, 'public')));
app.use((req, res) => res.status(404).json({ success: false, error: 'Recurso no encontrado.' }));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  let status = error.status || 500;
  let message = error.message;
  if (error instanceof multer.MulterError) {
    status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    message = error.code === 'LIMIT_FILE_SIZE'
      ? 'La imagen supera el límite de 10 MB.' : 'Sube un único archivo en el campo image.';
  }
  if (error.type === 'entity.parse.failed') message = 'El cuerpo JSON no es válido.';
  if (error.type === 'entity.too.large') message = 'La solicitud es demasiado grande.';
  if (status >= 500 && !error.expose) {
    console.error(error);
    message = 'No se pudo procesar la imagen. Reintenta; la primera descarga del modelo requiere conexión a Internet.';
  }
  res.status(status).json({ success: false, error: message });
});

export async function startServer(port = Number(process.env.PORT || 3000)) {
  await initializeStorage();
  await cleanupExpired();
  const timer = setInterval(() => cleanupExpired().catch(console.error), 5 * 60 * 1000);
  timer.unref();
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log(`Editor disponible en http://localhost:${server.address().port}`);
      resolve(server);
    });
    server.on('close', () => clearInterval(timer));
    server.once('error', error => { clearInterval(timer); reject(error); });
  });
}

export default app;

if (!isVercel && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().catch(error => { console.error(error); process.exitCode = 1; });
}
