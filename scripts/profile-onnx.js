import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizedTensor, logitsToMask, letterbox, applyMask } from '../services/segmentation.js';

const [filename, size='1024', optimization='all', destination='evidence/memory/profile', iterations='3', arena='false'] = process.argv.slice(2);
if (!filename) throw new Error('Uso: node scripts/profile-onnx.js modelo.onnx resolución optimización carpeta [repeticiones]');
const resolution=Number(size), source=await readFile('evidence/redmi/original.png');
await mkdir(destination,{recursive:true});
const {width,height}=await sharp(source).metadata(),box=letterbox(width,height,resolution);
const checkpoints=[];
function checkpoint(stage) {
  const entry={stage,rssMiB:process.memoryUsage().rss/1048576,peakRssMiB:process.resourceUsage().maxRSS/1024};
  checkpoints.push(entry);console.log(JSON.stringify(entry));
}
checkpoint('before-load');
const loadStart=performance.now();
const session=await ort.InferenceSession.create(filename,{
  executionProviders:['cpu'],graphOptimizationLevel:optimization,
  intraOpNumThreads:1,interOpNumThreads:1,executionMode:'sequential',enableCpuMemArena:arena==='true',enableMemPattern:arena==='true',
});
const loadMs=performance.now()-loadStart;checkpoint('after-load');
console.log(JSON.stringify({inputs:session.inputMetadata,outputs:session.outputMetadata}));
const rgb=await sharp(source).flatten({background:'#fff'}).toColourspace('srgb')
  .resize(box.width,box.height,{fit:'fill',kernel:'linear'})
  .extend({left:box.left,right:resolution-box.width-box.left,top:box.top,bottom:resolution-box.height-box.top,background:'#fff'})
  .removeAlpha().raw().toBuffer();
const input=new ort.Tensor('float32',normalizedTensor(rgb,resolution,resolution),[1,3,resolution,resolution]);
const runs=[];let previousMask;
try {
  for(let i=0;i<Number(iterations);i++) {
    const start=performance.now(),name=session.outputNames.at(-1);
    const outputs=await session.run({[session.inputNames[0]]:input},[name]);
    const inferenceMs=performance.now()-start,output=outputs[name];
    if(output.dims.join(',')!==`1,1,${resolution},${resolution}`)throw new Error('Dimensiones inesperadas');
    const mask=await sharp(logitsToMask(output.data),{raw:{width:resolution,height:resolution,channels:1}})
      .extract({left:box.left,top:box.top,width:box.width,height:box.height}).resize(width,height,{kernel:'linear'}).png().toBuffer();
    runs.push({inferenceMs,identicalToPrevious:previousMask?mask.equals(previousMask):null});previousMask=mask;
    for(const tensor of Object.values(outputs))tensor.dispose();
    checkpoint(`after-inference-${i+1}`);
  }
  const png=await applyMask(source,previousMask);
  await Promise.all([
    writeFile(path.join(destination,'mask.png'),previousMask),writeFile(path.join(destination,'transparent.png'),png),
    sharp(png).flatten({background:'#fff'}).png().toFile(path.join(destination,'white.png')),
    sharp(png).flatten({background:'#000'}).png().toFile(path.join(destination,'black.png')),
  ]);
  checkpoint('after-export');
  const result={node:process.version,platform:`${process.platform}/${process.arch}`,resolution,optimization,arena:arena==='true',threads:1,loadMs,runs,checkpoints};
  await writeFile(path.join(destination,'metrics.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {input.dispose();await session.release();}
