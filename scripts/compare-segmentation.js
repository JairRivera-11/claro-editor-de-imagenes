import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import { segment, releaseModels } from '../services/segmentation.js';

const [inputPath, destination = 'evidence/redmi', worker] = process.argv.slice(2);
if (!inputPath) throw new Error('Uso: node scripts/compare-segmentation.js foto.jpg evidence/caso [motor]');
await mkdir(destination, { recursive: true });
const input = await readFile(inputPath);
const source = await sharp(input).rotate().toColourspace('srgb').png().toBuffer();
const isRedmi = createHash('sha256').update(source).digest('hex') === '0d85698b62f34f8a9d369296d99f75f3b677289eedc24644573e1774cec1af69';
if (worker) {
  const dir = path.join(destination, worker); await mkdir(dir, { recursive: true });
  const start = performance.now();
  const result = await segment(source, worker);
  const coldMs = performance.now() - start;
  const warmStart = performance.now();
  const second = await segment(source, worker);
  const warmMs = performance.now() - warmStart;
  const identical = result.mask.equals(second.mask);
  await Promise.all([
    writeFile(path.join(dir, 'mask.png'), result.mask),
    writeFile(path.join(dir, 'transparent.png'), result.output),
    sharp(result.output).flatten({ background: '#fff' }).png().toFile(path.join(dir, 'white.png')),
    sharp(result.output).flatten({ background: '#000' }).png().toFile(path.join(dir, 'black.png')),
  ]);
  const { data, info } = await sharp(result.output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // Zonas interiores/externas anotadas visualmente SOLO para la referencia Redmi 1300².
  // No constituyen un ground truth completo ni miden precisión en todo el contorno.
  const regions = isRedmi ? {
    fondoIzquierdo: [60, 70, 120, 1150], fondoDerecho: [1120, 70, 120, 1150],
    fondoSuperior: [200, 55, 880, 30], fondoInferior: [200, 1220, 880, 25],
    tapa: [230, 480, 460, 670], pantallaInferior: [750, 880, 300, 275],
    pantallaSuperior: [740, 180, 300, 650], camaras: [300, 190, 325, 270],
  } : {};
  const measures = {};
  for (const [name, [x,y,w,h]] of Object.entries(regions)) {
    let min = 255, max = 0, sum = 0, transparent = 0, opaque = 0;
    for (let j = y; j < y+h; j++) for (let i = x; i < x+w; i++) {
      const alpha = data[(j * info.width + i) * 4 + 3];
      min = Math.min(min, alpha); max = Math.max(max, alpha); sum += alpha;
      if (alpha <= 5) transparent++; if (alpha >= 250) opaque++;
    }
    measures[name] = { rectangle: [x,y,w,h], min, max, mean: sum/(w*h), transparentFraction: transparent/(w*h), opaqueFraction: opaque/(w*h) };
  }
  const metrics = { engine: worker, node: process.version, platform: `${process.platform}/${process.arch}`, coldMs, warmMs,
    peakRssMiB: process.resourceUsage().maxRSS / 1024, identicalRepeatedMask: identical,
    inputSha256: createHash('sha256').update(input).digest('hex'), measures };
  await writeFile(path.join(dir, 'metrics.json'), JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify(metrics));
  await releaseModels();
} else {
  await writeFile(path.join(destination, 'original.png'), source);
  const engines = ['briaai', 'u2netp', 'birefnet-lite', 'birefnet'];
  const metrics = [];
  for (const engine of engines) {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), inputPath, destination, engine], { stdio: 'inherit' });
      child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${engine}: salida ${code}`)));
    });
    metrics.push(JSON.parse(await readFile(path.join(destination, engine, 'metrics.json'))));
  }
  const layers = [];
  for (let i = 0; i < engines.length; i++) {
    const label = Buffer.from(`<svg width="400" height="40"><rect width="400" height="40" fill="white"/><text x="12" y="27" font-size="20">${engines[i]}</text></svg>`);
    layers.push({ input: label, left: i*400, top: 0 });
    for (let j = 0; j < 3; j++) {
      const file = ['mask', 'white', 'black'][j];
      layers.push({ input: await sharp(path.join(destination, engines[i], file+'.png')).resize(400,400,{fit:'contain'}).png().toBuffer(), left:i*400,top:40+j*400 });
    }
  }
  await sharp({create:{width:1600,height:1240,channels:3,background:'#ddd'}}).composite(layers).png().toFile(path.join(destination,'comparison.png'));
  // Recortes comunes a 2×: borde exterior, cámaras, unión y pantalla inferior.
  const crops = { borde:[180,350,100,220], camaras:[280,160,350,330], union:[680,460,100,300], pantalla:[720,850,365,345] };
  const meta = await sharp(source).metadata();
  if (isRedmi) for (const [name,[left,top,width,height]] of Object.entries(crops)) {
    const cols = [];
    for (let i = 0; i < engines.length; i++) cols.push({ input: await sharp(path.join(destination,engines[i],'white.png')).extract({left,top,width,height}).resize(width*2,height*2,{kernel:'nearest'}).png().toBuffer(),left:i*width*2,top:0 });
    await sharp({create:{width:width*8,height:height*2,channels:3,background:'#fff'}}).composite(cols).png().toFile(path.join(destination,`crop-${name}.png`));
  }
  await writeFile(path.join(destination,'metrics.json'),JSON.stringify(metrics,null,2));
}
