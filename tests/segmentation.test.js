import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { letterbox, normalizedTensor, logitsToMask, applyMask, segment } from '../services/segmentation.js';

test('letterbox conserva proporciones y centra el relleno para fotos rectangulares',()=>{
  assert.deepEqual(letterbox(1600,800),{width:1024,height:512,left:0,top:256,resolution:1024});
  assert.deepEqual(letterbox(800,1600),{width:512,height:1024,left:256,top:0,resolution:1024});
});
test('normalización RGB en NCHW y sigmoid única sobre logits oficiales',()=>{
  const tensor=normalizedTensor(Uint8Array.from([255,0,128]),1,1);
  assert.ok(Math.abs(tensor[0]-(1-.485)/.229)<1e-6);
  assert.ok(Math.abs(tensor[1]-(0-.456)/.224)<1e-6);
  assert.ok(Math.abs(tensor[2]-(128/255-.406)/.225)<1e-6);
  assert.deepEqual([...logitsToMask([-20,0,20])],[0,128,255]);
  assert.throws(()=>logitsToMask([NaN]));
});
test('aplicar máscara conserva RGB y transparencia legítima, incluso al restaurar',async()=>{
  const raw={width:3,height:1,channels:4};
  const source=await sharp(Buffer.from([10,20,30,0,40,50,60,128,70,80,90,255]),{raw}).png().toBuffer();
  const mask=await sharp(Buffer.from([255,255,128]),{raw:{width:3,height:1,channels:1}}).png().toBuffer();
  const out=await sharp(await applyMask(source,mask)).raw().toBuffer();
  assert.deepEqual([...out],[10,20,30,0,40,50,60,128,70,80,90,128]);
  const invalid=await sharp({create:{width:1,height:1,channels:3,background:'#fff'}}).png().toBuffer();
  await assert.rejects(applyMask(source,invalid),/dimensiones/);
  await assert.rejects(segment(source,'unknown'),/desconocido/);
});
