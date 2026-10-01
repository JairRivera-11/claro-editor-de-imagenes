import { build } from 'esbuild';
import { rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await build({ entryPoints: [path.join(root, 'client/blobUpload.js')], outfile: path.join(root, 'public/blob-client.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true });
// ONNX publica binarios para todos los sistemas. Vercel solo necesita CPU Linux x64.
// No se modifica la instalación de macOS/Windows al ejecutar el build local.
if (process.env.VERCEL === '1' && process.platform === 'linux') {
  const binaries = path.join(root, 'node_modules/onnxruntime-node/bin/napi-v6');
  for (const platform of ['darwin', 'win32']) await rm(path.join(binaries, platform), { recursive: true, force: true });
  await rm(path.join(binaries, 'linux/arm64'), { recursive: true, force: true });
  const linux = path.join(binaries, 'linux/x64');
  for (const name of await readdir(linux)) {
    if (/providers_(cuda|tensorrt)/.test(name)) await rm(path.join(linux, name), { force: true });
  }
}
console.log('Cliente Blob generado; aplicación lista para empaquetar.');
