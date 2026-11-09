import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { MaskBrush } from '../public/mask-brush.js';

// Integración del servicio real sin abrir sockets. Conserva evidencias fuera de
// los uploads temporales y no toca ninguna imagen almacenada por el usuario.
const dir=await mkdtemp(path.join(tmpdir(),'claro-redmi-verify-'));
process.env.REMBG_UPLOADS_DIR=dir;
process.env.STORAGE_DRIVER='local';
const { initializeStorage, removeBackground, saveMask, compose, cleanup }=await import('../services/imageService.js');
const { releaseModels }=await import('../services/segmentation.js');
const inputPath=process.argv[2] || 'evidence/redmi/original.png';
const dest='evidence/redmi/export';await mkdir(dest,{recursive:true});
let id;
try {
  await initializeStorage();
  const input=await readFile(inputPath);
  const meta=await sharp(input).metadata();
  assert.equal(meta.width,1300);assert.equal(meta.height,1300);
  const result=await removeBackground({buffer:input,mimetype:meta.format==='jpeg'?'image/jpeg':'image/png'});id=result.imageId;
  const source=await sharp(input).rotate().ensureAlpha().raw().toBuffer();
  const output=await readFile(path.join(dir,`${id}.png`));
  const data=await sharp(output).ensureAlpha().raw().toBuffer();
  const a=(x,y)=>data[(y*1300+x)*4+3];
  for(const [x,y] of [[120,500],[150,500],[1200,500],[650,65],[650,1230]])assert.equal(a(x,y),0);
  for(const [x,y] of [[400,700],[1000,700],[900,1050],[400,250]])assert.equal(a(x,y),255);
  for(let i=0;i<data.length;i+=4)assert.deepEqual(data.subarray(i,i+3),source.subarray(i,i+3));
  await writeFile(path.join(dest,'automatic.png'),output);
  const body={imageId:id,background:{type:'transparent'},size:{width:1300,height:1300,maintainAspect:true},format:'png'};
  async function exportImage(body,filename){const composed=await compose(body);const buffer=await readFile(path.join(dir,composed.filename));await writeFile(path.join(dest,filename),buffer);return buffer;}
  const png=await exportImage(body,'final-transparent.png');
  const decoded=await sharp(png).ensureAlpha().raw().toBuffer();
  assert.equal(decoded[(500*1300+120)*4+3],0);assert.equal(decoded[(1050*1300+900)*4+3],255);
  const jpg=await exportImage({...body,format:'jpeg',background:{type:'color',value:'#ffffff'}},'final-white.jpg');
  assert.equal((await sharp(jpg).metadata()).hasAlpha,false);
  await exportImage({...body,background:{type:'color',value:'#000000'}},'final-black.png');
  const mask=await sharp(await readFile(path.join(dir,`${id}-mask.png`))).greyscale().raw().toBuffer();
  const brush=new MaskBrush(mask,1300,1300);
  const index=700*1300+400;
  brush.begin('erase',20,0.5);brush.move(400.5,700.5);brush.end();assert.equal(brush.alpha[index],0);
  const erased=brush.alpha.slice();brush.undo();assert.equal(brush.alpha[index],255);brush.redo();assert.equal(brush.alpha[index],0);
  const encode=alpha=>sharp(Buffer.from(alpha),{raw:{width:1300,height:1300,channels:1}}).png().toBuffer();
  const edit=await saveMask({buffer:await encode(erased),mimetype:'image/png'},id);
  const erasedPng=await exportImage({...body,maskId:edit.maskId},'manual-erased.png');
  assert.equal((await sharp(erasedPng).ensureAlpha().raw().toBuffer())[index*4+3],0);
  brush.begin('restore',20,0);brush.move(400.5,700.5);brush.end();assert.equal(brush.alpha[index],255);
  const restored=await saveMask({buffer:await encode(brush.alpha),mimetype:'image/png'},id);
  const restoredPng=await exportImage({...body,maskId:restored.maskId},'manual-restored.png');
  const restoredPixels=await sharp(restoredPng).ensureAlpha().raw().toBuffer();
  assert.deepEqual(restoredPixels.subarray(index*4,index*4+4),source.subarray(index*4,index*4+4));
  await assert.rejects(compose({...body,maskId:'../bad'}),{status:400});
  const report={engine:result.engine,dimensions:[1300,1300],backgroundProbesTransparent:true,productProbesOpaque:true,allOriginalRgbPreserved:true,pngAlpha:true,jpegOpaque:true,eraseUndoRedoRestoreExport:true,node:process.version};
  await writeFile(path.join(dest,'verification.json'),JSON.stringify(report,null,2));console.log(report);
} finally {if(id)await cleanup(id);await rm(dir,{recursive:true,force:true});await releaseModels();}
