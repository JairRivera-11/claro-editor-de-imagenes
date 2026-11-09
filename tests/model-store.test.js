import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createModelStore } from '../services/modelStore.js';

const bytes = Buffer.from('modelo de prueba con contenido verificable');
const catalog = { test: { file: 'test.onnx', asset: 'test.onnx', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } };
async function fixture(t) { const dir = await mkdtemp(path.join(tmpdir(),'claro-model-test-')); t.after(()=>rm(dir,{recursive:true,force:true})); return dir; }

test('arranque sin pesos: descarga una sola vez, verifica y reutiliza caché', async t => {
  const dir=await fixture(t);let requests=0;
  const store=createModelStore({dir,autoDownload:true,catalog,fetchImpl:async()=>{requests++;return new Response(bytes);}});
  const paths=await Promise.all([store.ensure('test'),store.ensure('test'),store.ensure('test')]);
  assert.equal(requests,1);assert.equal(new Set(paths).size,1);
  assert.deepEqual(await readFile(paths[0]),bytes);
  await store.ensure('test');assert.equal(requests,1);
  assert.deepEqual(await readdir(dir),['test.onnx']);
});
test('un peso corrupto se reemplaza; nunca se publica una descarga truncada o alterada', async t => {
  const dir=await fixture(t);const target=path.join(dir,'test.onnx');
  await writeFile(target,Buffer.alloc(bytes.length));
  const store=createModelStore({dir,autoDownload:true,catalog,fetchImpl:async()=>new Response(bytes)});
  await store.ensure('test');assert.deepEqual(await readFile(target),bytes);
  for(const invalid of [bytes.subarray(0,5),Buffer.alloc(bytes.length),Buffer.alloc(bytes.length+1)]) {
    await rm(target);
    const broken=createModelStore({dir,autoDownload:true,catalog,fetchImpl:async()=>new Response(invalid)});
    await assert.rejects(broken.ensure('test'),{status:503,expose:true});
    assert.deepEqual(await readdir(dir),[]);
    // Restituye el archivo para la siguiente iteración.
    await writeFile(target,bytes);
  }
});
test('un fallo de red libera el bloqueo y permite reintentar',async t=>{
  const dir=await fixture(t);let calls=0;
  const store=createModelStore({dir,autoDownload:true,catalog,fetchImpl:async()=>++calls===1?new Response('',{status:503}):new Response(bytes)});
  await assert.rejects(store.ensure('test'),{status:503});
  await store.ensure('test');assert.equal(calls,2);
});
test('modo local sin descarga explica cómo instalar y no llama a la red',async t=>{
  const dir=await fixture(t);
  const store=createModelStore({dir,catalog,fetchImpl:()=>{throw new Error('No debe acceder a red');}});
  await assert.rejects(store.ensure('test'),/models:download/);
  await assert.rejects(store.ensure('constructor'),/desconocido/);
});
test('Vercel usa directorio temporal y habilita descarga sin depender del build',()=>{
  const env={...process.env,VERCEL:'1'};delete env.BIREFNET_MODEL_DIR;delete env.BIREFNET_AUTO_DOWNLOAD;
  const output=execFileSync(process.execPath,['--input-type=module','-e',"import {modelDir,autoDownloadModels} from './services/config.js'; console.log(JSON.stringify({modelDir,autoDownloadModels}));"],{env,encoding:'utf8'});
  const config=JSON.parse(output.trim());
  assert.equal(config.modelDir,path.join(tmpdir(),'claro-birefnet'));assert.equal(config.autoDownloadModels,true);
});
