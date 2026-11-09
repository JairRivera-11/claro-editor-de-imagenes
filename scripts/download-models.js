import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import path from 'node:path';
import { models } from '../services/segmentation.js';
import { root } from '../services/config.js';

const engine = process.argv[2] || 'birefnet-lite';
const selected = engine === 'all' ? Object.keys(models) : [engine];
const dir = process.env.BIREFNET_MODEL_DIR || path.join(root, '.cache/birefnet');
await mkdir(dir, { recursive: true });
for (const name of selected) {
  const model=models[name]; if(!model)throw new Error('Usa birefnet-lite, birefnet o all.');
  const target=path.join(dir,model.file);
  if(await stat(target).then(s=>s.size===model.bytes).catch(()=>false)) {
    const hash=createHash('sha256');for await(const chunk of createReadStream(target))hash.update(chunk);
    if(hash.digest('hex')===model.sha256){console.log(`${name}: ya instalado y verificado.`);continue;}
  }
  const url=`https://github.com/ZhengPeng7/BiRefNet/releases/download/v1/${model.asset}`;
  const temp=target+'.'+randomUUID()+'.part';
  try {
    console.log(`Descargando ${name} (${Math.round(model.bytes/1e6)} MB) desde el repositorio oficial…`);
    const response=await fetch(url,{signal:AbortSignal.timeout(900_000)});
    if(!response.ok||!response.body)throw new Error(`HTTP ${response.status} al descargar el modelo.`);
    let bytes=0;const hash=createHash('sha256');
    const check=new Transform({transform(chunk,encoding,callback){bytes+=chunk.length;if(bytes>model.bytes)return callback(new Error('Modelo mayor de lo esperado.'));hash.update(chunk);callback(null,chunk);}});
    await pipeline(response.body,check,createWriteStream(temp,{flags:'wx'}));
    if(bytes!==model.bytes||hash.digest('hex')!==model.sha256)throw new Error('El modelo descargado no coincide con el SHA-256 esperado.');
    await rename(temp,target);console.log(`${name}: instalado y verificado.`);
  } finally {await rm(temp,{force:true});}
}
