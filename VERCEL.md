# Desplegar Claro en Vercel

## 1. Importar el proyecto

Sube el código a tu repositorio e impórtalo en Vercel. Si el repositorio contiene también Shopify Channel Sync, selecciona **Root Directory: `rembg-app`**. Si subes únicamente el contenido de esta carpeta, usa la raíz del repositorio.

Configuración:

| Ajuste | Valor |
| --- | --- |
| Framework Preset | Express |
| Node.js | 22.x |
| Install Command | `ONNXRUNTIME_NODE_INSTALL=skip npm ci` |
| Build Command | `npm run build` |
| Output Directory | Predeterminado de Express; no configurar `dist` |
| Fluid Compute | Activado |

Estos valores ya están definidos en `package.json` y `vercel.json`. `server.js` exporta Express como handler; en Vercel no abre un puerto ni arranca el temporizador local. Los archivos de `public/` pueden servirse desde el CDN. Además, el build los integra en la Function y Express atiende `/`, `/index.html`, CSS y JavaScript explícitamente. Esto evita depender de `express.static()` para la interfaz. No se necesita una reescritura de `/`.

## 2. Conectar Vercel Blob

En **Storage → Create Database/Store → Blob**, crea un almacén de acceso **Public** y conéctalo al proyecto, en Production y Preview.

Comprueba que exista **`BLOB_READ_WRITE_TOKEN`** en las variables de entorno del proyecto. El flujo de subida usado aquí necesita ese token de lectura/escritura, incluso si el almacén también tiene una conexión OIDC. No lo copies al frontend ni lo subas al repositorio.

El navegador sube el original directamente a Blob, con un permiso temporal limitado a una ruta UUID, el MIME esperado y 10 MB. Después envía a Express un JSON pequeño con `uploadPath`. Los resultados se guardan también en Blob y se descargan directamente desde allí. Esto permite mantener el límite de 10 MB sin pasar archivos grandes por la Function.

Las imágenes se almacenan bajo `claro/incoming/` y `claro/uploads/`. Sus URLs son públicas para quien las conozca, como los recursos locales de `/uploads`. El sitio conserva el acceso anónimo del editor original; usa Deployment Protection si el despliegue debe ser solo para tu equipo. No se han añadido cuentas de usuario.

## 3. Configurar la limpieza

Crea **`CRON_SECRET`** en las variables de entorno de Vercel, con un valor aleatorio. Puedes generarlo localmente:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Vercel envía este secreto en la cabecera de autorización al ejecutar `/api/cron/cleanup`. La ruta rechaza peticiones sin él.

El cron incluido corre una vez al día (`0 6 * * *`, UTC), compatible con Hobby. Borra grupos sin actividad durante más de una hora y subidas originales abandonadas. **En Vercel el borrado físico es diario, no exactamente una hora después de subir la imagen.** El CDN puede conservar temporalmente objetos borrados durante su tiempo de caché. En Pro puedes cambiar el cron a `*/5 * * * *` para revisar cada cinco minutos. Los crons de Vercel se ejecutan en Production; en Preview usa la ruta protegida manualmente si necesitas limpiar los archivos de pruebas.

Al reemplazar una imagen, el editor sigue pidiendo el borrado del grupo anterior. Los originales de entrada se borran al terminar su procesamiento, incluso si falla la validación.

## 4. Desplegar y verificar

Haz Deploy o Redeploy después de conectar Blob y configurar las variables.

1. Abre `/api/config`: debe responder `success: true` y `storage: "blob"`.
2. Sube una imagen pequeña y espera a la descarga inicial del modelo.
3. Centra y arrastra el sujeto, aplica un fondo y descarga PNG/JPG.
4. Prueba también una imagen de más de 4,5 MB y menos de 10 MB.
5. Comprueba la ejecución del cron en la sección Cron Jobs del proyecto.

El modelo Briaai (~44 MB) se descarga en `/tmp/claro-rmbg`. Puede reutilizarse en una instancia caliente; una instancia nueva puede necesitar descargarlo de nuevo. El modelo se ejecuta en CPU, con un máximo de 300 segundos por petición.

Las imágenes nunca dependen de `/tmp`: cualquier instancia puede recuperar el sujeto y el fondo desde Blob. La caché del modelo sí es temporal. El build conserva los binarios ONNX de Linux x64 y elimina plataformas y proveedores GPU innecesarios para reducir el paquete.

## Variables

| Variable | Local | Vercel |
| --- | --- | --- |
| `PORT` | Opcional, 3000 por defecto | No se utiliza |
| `STORAGE_DRIVER` | `local` por defecto; `blob` para probar con Blob | Se fuerza `blob` |
| `BLOB_READ_WRITE_TOKEN` | Solo si eliges Blob | Obligatoria |
| `CRON_SECRET` | Solo para probar el cron | Necesaria para limpieza programada |
| `VERCEL` | No configurarla manualmente | Vercel la inyecta automáticamente |

Para probar Blob desde tu equipo, copia `.env.example` a `.env`, usa `STORAGE_DRIVER=blob` y un token de un almacén de desarrollo. Ejecuta `npm run build` para generar el módulo de subida y después `npm run dev`.

## API en la nube

Los endpoints existentes permanecen. `POST /api/remove-bg` y `POST /api/background` aceptan además JSON:

```json
{
  "uploadPath": "claro/incoming/550e8400-e29b-41d4-a716-446655440000.png",
  "imageId": "UUID_DEL_SUJETO_SOLO_PARA_BACKGROUND"
}
```

`uploadPath` debe corresponder a un objeto existente subido mediante `POST /api/blob-upload`. No se aceptan URLs arbitrarias. El servidor vuelve a comprobar tamaño, MIME, extensión, caducidad y contenido decodificado. El frontend selecciona automáticamente este flujo en modo Blob.

`POST /api/compose` devuelve una URL HTTPS de Blob. La previsualización usa CORS y la descarga crea una URL local del navegador para conservar el nombre del archivo.

El contrato multipart sigue funcionando para clientes locales. En Vercel, un cuerpo multipart de más de 4,5 MB puede ser rechazado por la plataforma antes de llegar a Express: utiliza la subida directa del editor.

## Comprobaciones de desarrollo

```bash
npm install
npm run build
npm test
RMBG_INTEGRATION=1 npm test
node scripts/check-bundle.js
```

Las pruebas del adaptador Blob usan un almacén simulado para comprobar lecturas entre instancias, paginación, actividad y borrado. La inferencia de IA se verifica localmente. La comprobación del paquete traza las dependencias y añade explícitamente los binarios Linux; no sustituye un despliegue real.

Para terminar la verificación remota se necesita el proyecto y almacén Blob de tu cuenta. Este cambio prepara el código; no crea recursos de pago ni publica un despliegue.

## Referencias

- [Express en Vercel](https://vercel.com/docs/frameworks/backend/express)
- [Límites de Functions](https://vercel.com/docs/functions/limitations)
- [Subidas directas con Blob](https://vercel.com/docs/vercel-blob/client-upload)
- [SDK de Blob](https://vercel.com/docs/vercel-blob/using-blob-sdk)
- [Frecuencia de Cron según el plan](https://vercel.com/docs/cron-jobs/usage-and-pricing)


## Corrección del 404 en la página de inicio

Si el despliegue anterior mostraba `{"success":false,"error":"Recurso no encontrado."}` al abrir `/`:

1. Publica esta versión del código, incluidos `services/webRoutes.js` y `scripts/web-assets.js`.
2. Conserva **Build Command: `npm run build`**. Genera el cliente de Blob y `services/webAssets.generated.js`.
3. Usa el `vercel.json` actualizado, sin la reescritura de `/` a `/index.html`.
4. Genera un nuevo despliegue desde el commit actualizado. Redeploy del commit antiguo vuelve a desplegar el mismo fallo.
5. Comprueba `/`, `/index.html`, `/styles.css` y `/app.js`: deben responder 200 con su tipo de contenido correspondiente. `/favicon.ico` y `/favicon.png` redirigen al icono SVG.

No cambies Output Directory a `public` o `dist`; conserva el valor predeterminado del preset Express. Si este repositorio contiene directamente `server.js` y `package.json` en la raíz, Root Directory debe ser la raíz, no una subcarpeta inexistente.
