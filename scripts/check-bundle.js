import { nodeFileTrace } from '@vercel/nft';
import { stat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
const { fileList, warnings } = await nodeFileTrace([path.join(root, 'server.js')], {
  base: root, processCwd: root,
  ignore: ['uploads/**', '.cache/**', '.env*', 'tests/**', 'node_modules/onnxruntime-node/bin/napi-v6/darwin/**', 'node_modules/onnxruntime-node/bin/napi-v6/win32/**', 'node_modules/onnxruntime-node/bin/napi-v6/linux/arm64/**'],
});
// includeFiles obliga a incluir los binarios CPU, incluso al inspeccionar desde macOS.
const nativeDir = 'node_modules/onnxruntime-node/bin/napi-v6/linux/x64';
for (const file of await readdir(path.join(root, nativeDir))) fileList.add(`${nativeDir}/${file}`);
let size = 0;
for (const file of fileList) size += (await stat(path.join(root, file))).size;
console.log(`Traza local + ONNX Linux CPU: ${(size / 1024 / 1024).toFixed(1)} MiB, ${fileList.size} archivos.`);
console.log(`Entrada Express: server.js; duración: ${config.functions['server.js'].maxDuration}s.`);
if (warnings.size) console.log(`Advertencias del trazador: ${warnings.size} (revisa módulos opcionales de otras plataformas).`);
const unexpected = [...warnings].filter(warning => !warning.message.includes('@img/sharp-'));
for (const warning of unexpected) console.warn(warning.message);
if (unexpected.length) throw new Error('Revisa las dependencias no resueltas.');
if (size > 250 * 1024 * 1024) throw new Error('El paquete estimado supera 250 MiB.');
if (![...fileList].some(file => file.endsWith('linux/x64/onnxruntime_binding.node'))) throw new Error('Falta el binding ONNX de Linux.');
