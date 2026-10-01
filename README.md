# Claro · Editor de fondos

Aplicación de una sola página en español, con Node.js, Express, JavaScript vanilla, `rmbg`, ONNX Runtime y `sharp`. Elimina el fondo, permite previsualizar la transparencia, componer fondos, ajustar el tamaño y descargar PNG/JPG.

## Vercel

El proyecto incluye soporte para Express en Vercel, subidas directas de hasta 10 MB mediante Vercel Blob, caché del modelo en `/tmp` y limpieza programada. Consulta la [guía de despliegue en Vercel](./VERCEL.md). Requiere conectar un almacén Blob público y configurar `BLOB_READ_WRITE_TOKEN` y `CRON_SECRET`.

Las instrucciones de almacenamiento local y limpieza cada cinco minutos que siguen corresponden a `npm start`/`npm run dev` en tu equipo. En Vercel las URLs provienen de Blob y la limpieza incluida es diaria, compatible con Hobby.

## Requisitos y arranque

Node.js **22.x** (22.12 o posterior dentro de esa rama), npm y conexión a Internet para instalar dependencias y descargar el modelo por primera vez. No requiere Python ni claves API.

```bash
cd rembg-app
npm install
npm run dev
```

Abre **http://localhost:3000**. Para arrancar sin nodemon:

```bash
npm start
```

El archivo `.env` incluido contiene `PORT=3000`. Puedes cambiarlo. Si copias el proyecto desde un repositorio que omite `.env`, créalo con ese contenido; el puerto por defecto también es 3000.

### Primera ejecución

Se usa explícitamente `createBriaaiModel()` de `rmbg@0.1.0`. Al eliminar el primer fondo, **rmbg descargará automáticamente el modelo de IA (~44 MB)**. Esta petición puede tardar más; la interfaz muestra un indicador de procesamiento. El modelo se conserva en `.cache/rmbg/` y las siguientes ejecuciones reutilizan la descarga.

Las imágenes se procesan en el servidor Express; no se envían a un servicio de IA externo. En Vercel se almacenan temporalmente en Vercel Blob. ONNX Runtime ejecuta el modelo localmente en CPU. `rmbg` usa JavaScript con los binarios nativos de ONNX Runtime y sharp.

API verificada en el [SDK oficial de rmbg](https://github.com/mrgoonie/rmbg/tree/main/packages/node): `rmbg(buffer, { model, cacheDir, maxResolution })`, con `createBriaaiModel` importado desde `rmbg/models`.

`package.json` fija las versiones consultadas en npm e incluye un override de `sharp` dentro de `rmbg` para usar la misma versión actual en toda la aplicación. Esto evita la versión antigua de libvips incluida por el rango original de rmbg. El lockfile hace reproducible la instalación.

## Uso

1. Arrastra o selecciona un PNG, JPG o WebP estático de hasta 10 MB y 24 megapíxeles.
2. Espera a que aparezca el resultado transparente sobre la cuadrícula. Ya puedes descargar ese PNG.
3. Selecciona transparencia, color sólido, uno de los cuatro degradados o una imagen de fondo propia.
4. Ajusta el ancho y alto, o utiliza Instagram, Story, Facebook o HD.
5. Pulsa **Centrar imagen** para centrar el sujeto al instante. Arrástralo con el mouse o el dedo y ajusta su escala con el deslizador o la rueda del mouse.
6. Elige PNG o JPG y, para JPG, una calidad de 1 a 100.
7. Pulsa **Aplicar cambios**, revisa el resultado y descarga la imagen.

**Mantener proporción** conserva la proporción del sujeto y lo centra dentro del lienzo, cuyas dimensiones finales son exactamente las indicadas. No modifica automáticamente el otro campo: así un sujeto horizontal puede colocarse sin deformaciones en un Story vertical. Si desmarcas la casilla, el sujeto se estira para ocupar todo el lienzo. Los fondos propios se recortan al centro con `cover`.

**Centrar imagen** es un botón que centra el sujeto visible al instante y mantiene su escala. Ignora los restos con alfa inferior a 16/255 al calcular el centro (si toda la imagen tiene alfa bajo, usa todos los píxeles no transparentes). Además, ignora fragmentos desconectados cuya área sea menor al 0.1% de la del componente mayor; así las motas residuales no desplazan el centro. Conserva los objetos separados de tamaño relevante. Estos filtros solo determinan la posición: no eliminan sombras ni píxeles. **Restablecer** recupera el encuadre original y la escala del 100%.

La página usa el tema violeta `#6012C3`. Al arrastrar cerca del centro, el ajuste magnético captura cada eje a 8 píxeles de pantalla, lo retiene durante 120 ms y lo libera al separarse más de 16 píxeles. También detecta cruces rápidos del centro. Las guías horizontal y vertical se muestran al alinear el sujeto y no forman parte de la imagen exportada.

El editor permite arrastrar con mouse o dedo, escalar del 10% al 200% con el deslizador o la rueda del mouse, y mover con las flechas cuando el lienzo tiene el foco (1 píxel, o 10 con Shift). La vista previa se actualiza al instante. **Aplicar cambios** genera la descarga con la misma geometría. El contenido que sale del lienzo queda recortado. Cada composición parte del PNG original, por lo que puedes moverlo de vuelta sin perderlo.

Límites de salida: 1–4096 px por dimensión y hasta 16 megapíxeles. La eliminación limita el lado mayor a 4096 px conservando la proporción. JPG no admite transparencia: las zonas transparentes se rellenan de blanco. PNG conserva el canal alfa.

## Estructura

```text
rembg-app/
├── package.json
├── package-lock.json
├── .env
├── .gitignore
├── README.md
├── server.js
├── routes/imageRoutes.js
├── controllers/imageController.js
├── services/imageService.js
├── public/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   ├── geometry.js
│   └── snapping.js
├── tests/image.test.js
├── tests/snapping.test.js
├── tests/geometry.test.js
└── uploads/.gitkeep
```

`.cache/rmbg/` se crea automáticamente. Los uploads y la caché están excluidos de Git. Nodemon ignora ambos directorios para que una subida no reinicie el servidor.

## API y ejemplos curl

Todos los errores tienen el formato:

```json
{ "success": false, "error": "Mensaje descriptivo" }
```

Códigos: 400 para datos inválidos, 404 para recursos ausentes, 409 para operaciones simultáneas sobre la misma imagen, 413 para archivos demasiado grandes, 429 cuando otra eliminación está en proceso, y 500 para errores internos. Cada subida acepta un único archivo en el campo `image`. Se comprueban extensión, MIME y contenido decodificado; se rechazan archivos animados.

### POST /api/remove-bg

```bash
curl -X POST http://localhost:3000/api/remove-bg \
  -F 'image=@foto.jpg'
```

Respuesta:

```json
{ "success": true, "imageId": "550e8400-e29b-41d4-a716-446655440000", "url": "/uploads/550e8400-e29b-41d4-a716-446655440000.png" }
```

En los siguientes comandos sustituye `IMAGE_ID` por el identificador real devuelto. El PNG conserva transparencia y puede descargarse directamente desde la URL.

### POST /api/background

Endpoint adicional necesario para subir fondos propios. Recibe `image` y el `imageId` del sujeto al que pertenece el fondo.

```bash
curl -X POST http://localhost:3000/api/background \
  -F 'image=@paisaje.jpg' \
  -F 'imageId=IMAGE_ID'
```

Respuesta: `{ "success": true, "fileId": "uuid" }`. El `fileId` solo puede usarse con ese sujeto.

### POST /api/compose

```bash
curl -X POST http://localhost:3000/api/compose \
  -H 'Content-Type: application/json' \
  -d '{"imageId":"IMAGE_ID","background":{"type":"color","value":"#e9e6df"},"size":{"width":1080,"height":1080,"maintainAspect":true},"format":"png","quality":90}'
```

El campo opcional `"centerSubject": true` activa el centrado del contenido visible. Su valor por defecto es `false`, conservando el encuadre anterior. El objeto opcional `transform` controla el ajuste libre:

```json
{ "centerSubject": true, "transform": { "x": 0.15, "y": -0.1, "scale": 1.25 } }
```

`x` e `y` son desplazamientos relativos al ancho/alto del lienzo: 0.15 mueve a la derecha un 15% del ancho; -0.1 mueve hacia arriba un 10% del alto. Rango: -2 a 2. `scale` va de 0.1 a 2, con 1 como tamaño original ajustado al lienzo. Por defecto: `{ "x": 0, "y": 0, "scale": 1 }`. El centrado y los desplazamientos se aplican al sujeto, sin mover el fondo.

Opciones de `background`:

```json
{ "type": "transparent" }
{ "type": "color", "value": "#ffffff" }
{ "type": "gradient", "value": "sunset" }
{ "type": "image", "fileId": "UUID_DEL_FONDO" }
```

Degradados disponibles: `sunset`, `ocean`, `lavender`, `midnight`. Se generan mediante SVG interno; no se admite SVG arbitrario ni URLs externas. Para JPG usa `"format":"jpeg"`; calidad por defecto: 90.

Respuesta de éxito:

```json
{
  "success": true,
  "url": "/uploads/IMAGE_ID-result-UUID.png",
  "filename": "IMAGE_ID-result-UUID.png",
  "width": 1080,
  "height": 1080
}
```

Descarga usando la URL exacta recibida:

```bash
curl 'http://localhost:3000/uploads/IMAGE_ID-result-UUID.png' -o resultado.png
```

### DELETE /api/cleanup/:imageId

Elimina el PNG del sujeto, todos sus fondos propios y sus resultados. Es idempotente.

```bash
curl -X DELETE 'http://localhost:3000/api/cleanup/IMAGE_ID'
```

Respuesta: `{ "success": true }`.

### Limpieza automática

Al arrancar y cada cinco minutos se eliminan los grupos de archivos que llevan **más de una hora sin actividad**. Una composición o subida de fondo renueva la fecha de modificación del grupo. Las operaciones activas quedan protegidas frente a la limpieza. Al reemplazar el sujeto, el frontend solicita borrar el grupo anterior. Cerrar la pestaña deja los archivos para la limpieza automática.

La aplicación está pensada para uso local: los recursos de `/uploads` son accesibles a quien conoce su URL y no hay cuentas de usuario. El modelo en caché se conserva para evitar descargarlo otra vez.

## Pruebas

```bash
npm test
```

Prueba la API HTTP con imágenes generadas: centrado con residuos casi transparentes, desplazamiento, escala, recorte, transparencia y centrado, dimensiones exactas, estiramiento, colores, cuatro degradados, JPG, fondo propio, validación de archivos, tamaño máximo, errores JSON y limpieza.

Para incluir la inferencia real y la descarga del modelo:

```bash
RMBG_INTEGRATION=1 npm test
```

En PowerShell: `$env:RMBG_INTEGRATION='1'; npm test`.

Las pruebas levantan un servidor en un puerto libre y usan un directorio temporal aislado; no modifican las imágenes de `uploads/`.
