import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const execute = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('la Function empaquetada sirve la interfaz sin public, express.static ni credenciales Blob', async () => {
  await execute(process.execPath, ['scripts/build.js'], { cwd: root });
  // El bundle se coloca fuera de services/ y public/ para detectar rutas relativas rotas.
  const dir = await mkdtemp(path.join(root, '.web-test-'));
  const outfile = path.join(dir, 'function.mjs');
  try {
    await build({ entryPoints: [path.join(root, 'server.js')], outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
    const program = `
      import assert from 'node:assert/strict';
      import app from ${JSON.stringify(outfile)};
      // La rama Vercel no registra express.static para servir la interfaz.
      const server = app.listen(0, '127.0.0.1');
      await new Promise(resolve => server.once('listening', resolve));
      const base = 'http://127.0.0.1:' + server.address().port;
      try {
        for (const [url, type, contains] of [
          ['/', 'text/html', 'Tu imagen'], ['/index.html', 'text/html', 'Tu imagen'],
          ['/styles.css', 'text/css', '#6012C3'], ['/app.js', 'javascript', 'uploadFile'],
          ['/geometry.js', 'javascript', 'visibleBounds'], ['/snapping.js', 'javascript', 'snapAxis'],
          ['/blob-client.js', 'javascript', 'upload'], ['/favicon.svg', 'image/svg+xml', '<svg'],
        ]) {
          const response = await fetch(base + url);
          assert.equal(response.status, 200, url);
          assert.ok(response.headers.get('content-type').includes(type), url);
          assert.ok((await response.text()).includes(contains), url);
        }
        const head = await fetch(base + '/', { method: 'HEAD' });
        assert.equal(head.status, 200); assert.equal(await head.text(), '');
        for (const icon of ['/favicon.ico', '/favicon.png']) {
          const response = await fetch(base + icon);
          assert.equal(response.status, 200); assert.ok(response.url.endsWith('/favicon.svg'));
        }
        assert.equal((await fetch(base + '/missing')).status, 404);
        assert.equal((await fetch(base + '/.env')).status, 404);
        assert.equal((await fetch(base + '/server.js')).status, 404);
        const api = await fetch(base + '/api/config');
        assert.equal(api.status, 503); // Falta Blob, pero el HTML sigue estando disponible.
        assert.equal((await api.json()).success, false);
        console.log('WEB_ROUTES_OK');
      } finally { await new Promise(resolve => server.close(resolve)); }
    `;
    const result = await execute(process.execPath, ['--input-type=module', '-e', program], {
      cwd: root,
      env: { ...process.env, VERCEL: '1', BLOB_READ_WRITE_TOKEN: '', STORAGE_DRIVER: 'blob' },
      timeout: 30_000,
    });
    assert.match(result.stdout, /WEB_ROUTES_OK/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
