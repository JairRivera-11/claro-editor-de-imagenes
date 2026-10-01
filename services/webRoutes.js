import { Router } from 'express';

export function createWebRouter(loadAssets) {
  const router = Router();
  // Los iconos antiguos redirigen a un favicon real para evitar 404 del navegador.
  router.get(['/favicon.ico', '/favicon.png'], (req, res) => res.redirect(302, '/favicon.svg'));
  let assets;
  router.use(async (req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) return next();
    try {
      assets ||= Promise.resolve().then(loadAssets).catch(error => { assets = undefined; throw error; });
      const files = await assets;
      if (!Object.hasOwn(files, req.path)) return next();
      const asset = files[req.path];
      res.set({
        'Content-Type': asset.type,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=0, must-revalidate',
      }).send(Buffer.from(asset.content, 'base64'));
    } catch (error) { next(error); }
  });
  return router;
}

// El build integra los recursos en un módulo JavaScript que viaja con la Function.
// No depende del directorio de trabajo ni de express.static(), omitido por Vercel.
export const vercelWebRouter = createWebRouter(async () => (await import('./webAssets.generated.js')).default);
