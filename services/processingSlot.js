// Se adquiere antes de almacenar el multipart en memoria. Las cuatro rutas
// de imágenes comparten el mismo cupo, también con Fluid Compute concurrente.
export function createProcessingSlot() {
  let active = false;
  return function processingSlot(req, res, next) {
    if (active) return next(Object.assign(new Error('Hay otra imagen en proceso. Inténtalo de nuevo en unos segundos.'), { status: 429 }));
    active = true;
    let released = false;
    const release = () => {
      if (released) return;
      released = true; active = false; req.off('aborted', onAbort);
    };
    const onAbort = () => { if (!req.complete) release(); };
    res.locals.releaseSlot = release;
    req.once('aborted', onAbort);
    if (req.aborted) { release(); return next(Object.assign(new Error('Subida cancelada.'), { status: 400 })); }
    // No liberamos al cerrar la respuesta: ONNX podría seguir trabajando.
    // Cada controlador libera en finally, incluso al fallar Blob o Sharp.
    next();
  };
}

export function releaseOnUploadError(error, req, res, next) {
  res.locals.releaseSlot?.(); next(error);
}
