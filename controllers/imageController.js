import { resolveUpload } from '../services/cloudUploads.js';
import * as images from '../services/imageService.js';

export async function removeBackground(req, res, next) {
  let uploaded;
  try {
    uploaded = await resolveUpload(req);
    const result = await images.removeBackground(uploaded.file);
    await uploaded.dispose().catch(console.error); uploaded = undefined;
    res.json({ success: true, ...result });
  } catch (error) {
    await uploaded?.dispose().catch(console.error);
    next(error);
  } finally { res.locals.releaseSlot?.(); }
}

export async function uploadBackground(req, res, next) {
  let uploaded;
  try {
    uploaded = await resolveUpload(req);
    const fileId = await images.saveBackground(uploaded.file, req.body.imageId);
    await uploaded.dispose().catch(console.error); uploaded = undefined;
    res.json({ success: true, fileId });
  } catch (error) {
    await uploaded?.dispose().catch(console.error);
    next(error);
  }
}

export async function compose(req, res, next) {
  try {
    const result = await images.compose(req.body);
    res.json({ success: true, ...result });
  } catch (error) { next(error); }
}

export async function cleanup(req, res, next) {
  try {
    await images.cleanup(req.params.imageId);
    res.json({ success: true });
  } catch (error) { next(error); }
}
