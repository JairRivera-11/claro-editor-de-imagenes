// Ejecución aislada: IMAGE_MEMORY_PROFILE=serverless node scripts/stress-memory.js
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
const dir = await mkdtemp(path.join(tmpdir(), 'claro-memory-'));
process.env.REMBG_UPLOADS_DIR = dir;
process.env.STORAGE_DRIVER = 'local';
const { initializeStorage, removeBackground, compose, cleanup } = await import('../services/imageService.js');
const { releaseModels } = await import('../services/segmentation.js');
const checkpoints = [];
const record = stage => { const point = { stage, rssMiB: process.memoryUsage().rss / 1048576, peakRssMiB: process.resourceUsage().maxRSS / 1024 }; checkpoints.push(point); console.log(point); };
try {
  await initializeStorage();
  const original = await readFile('evidence/redmi/original.png');
  for (let i = 0; i < 3; i++) {
    // Máximo de entrada, seguido del máximo de salida y escala permitida.
    const buffer = await sharp(original).resize(6000,4000,{fit:'fill'}).png().toBuffer();
    const result = await removeBackground({ buffer, mimetype:'image/png' });
    record(`segment-24MP-${i+1}`);
    await compose({ imageId: result.imageId, size:{width:4000,height:4000,maintainAspect:true}, transform:{x:0,y:0,scale:2}, background:{type:'color',value:'#ffffff'}, format:'jpeg' });
    record(`compose-16MP-${i+1}`);
    await cleanup(result.imageId);
  }
  await writeFile('evidence/memory/service-stress.json', JSON.stringify({ node:process.version,platform:`${process.platform}/${process.arch}`,checkpoints },null,2));
} finally { await releaseModels(); await rm(dir,{recursive:true,force:true}); }
