import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function generateWebAssets(root) {
  // Lista explícita: solo archivos públicos, nunca .env, uploads ni credenciales.
  const files = {
    'index.html': 'text/html; charset=utf-8',
    'styles.css': 'text/css; charset=utf-8',
    'app.js': 'text/javascript; charset=utf-8',
    'geometry.js': 'text/javascript; charset=utf-8',
    'snapping.js': 'text/javascript; charset=utf-8',
    'blob-client.js': 'text/javascript; charset=utf-8',
    'favicon.svg': 'image/svg+xml',
  };
  const assets = {};
  for (const [file, type] of Object.entries(files)) {
    assets[`/${file}`] = { type, content: (await readFile(path.join(root, 'public', file))).toString('base64') };
  }
  assets['/'] = assets['/index.html'];
  await writeFile(path.join(root, 'services/webAssets.generated.js'),
    `// Generado por npm run build. No editar.\nexport default ${JSON.stringify(assets)};\n`);
}
