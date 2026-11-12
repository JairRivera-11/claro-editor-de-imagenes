# Validación de segmentación y retoque — 9 de noviembre de 2026

## Referencia y resultados

La copia reproducible es `evidence/redmi/original.png` (1300 × 1300), SHA-256 `0d85698b62f34f8a9d369296d99f75f3b677289eedc24644573e1774cec1af69`. Procede del JPEG aportado por el usuario. El archivo externo fue modificado posteriormente a 1200 px; las verificaciones de esta auditoría usan la copia preservada de 1300 px.

Cada subcarpeta de `evidence/redmi` contiene máscara, PNG transparente, blanco, negro y métricas. `comparison.png` coloca Briaai, U2NetP, Lite y BiRefNet completo de izquierda a derecha; los recortes ampliados mantienen ese orden.

| Motor | Primera ejecución | Segunda | RSS máximo del proceso | Resultado observado |
|---|---:|---:|---:|---|
| Briaai | 2.62 s | 2.34 s | 981 MiB | Conserva fondo verde |
| U2NetP | 0.58 s | 0.67 s | 365 MiB | Borra gran parte de la pantalla inferior |
| BiRefNet Lite | 23.99 s | 22.76 s | 2420 MiB | Sin rectángulo; interiores evaluados intactos |
| BiRefNet | 46.08 s | 45.93 s | 2867 MiB | Sin rectángulo; interiores evaluados intactos |

Mediciones en Node 26.3.0, macOS ARM64, CPU, cuatro hilos. Pesos ya descargados. Primera ejecución incluye carga/optimización; cada motor se evaluó en un proceso independiente. RSS incluye todo el proceso; no es un presupuesto garantizado para Linux/Vercel. Dos ejecuciones por motor produjeron máscaras idénticas. No es una prueba de carga sostenida.

En Lite y completo, las cuatro regiones externas anotadas tuvieron alfa 0 y las cuatro regiones interiores alfa 255 en todos sus píxeles. Son regiones de control, no una máscara de referencia completa ni una medición IoU. Se inspeccionaron blanco, negro, el contorno lateral y la zona de superposición. No se dispone de una validación completa de todas las categorías de productos.

## Integración comprobada

`node scripts/verify-redmi.js` ejecuta el motor predeterminado, almacenamiento, composición, exportación PNG/JPG y retoque real sin servidor HTTP. Verifica RGB original en todos los píxeles del recorte automático, alfa en puntos externos/interiores, borrado, deshacer, rehacer, restauración y exportación. Los archivos resultantes y `verification.json` están en `evidence/redmi/export/`. Borrado/restauración son pruebas intencionales sobre la tapa: no son errores de segmentación.

Pasaron 21 pruebas aisladas: alfa, geometría, snapping, almacenamiento, pincel, normalización, sigmoid, descarga/caché/integridad de modelos y configuración temporal de Vercel. El build pasó. Antes de la integración pasó la suite HTTP existente: 26 correctas y una inferencia omitida. La nueva prueba HTTP de retoque permanece pendiente de ejecución en un entorno con servidor local permitido.

El navegador Chrome no pudo iniciarse dentro del sandbox; no se declara comprobada la consola ni la interacción visual completa. La última solicitud para ejecutar la suite fuera del sandbox fue rechazada por fallo de la revisión automática: créditos insuficientes del espacio de trabajo. No se ha validado un despliegue real de la nueva descarga en Vercel ni Node 22; el proyecto mantiene Node 22 como versión declarada.

## Reproducción

```bash
npm ci
npm run models:download -- all
npm run compare:segmentation -- evidence/redmi/original.png evidence/redmi
node scripts/verify-redmi.js
npm test
npm run build
```

Briaai y U2NetP descargan sus pesos con `rmbg` cuando no están en caché; la comparación es experimental, no una autorización de uso comercial de BRIA. Las fotos y los resultados permanecen locales. `evidence/` está excluida del envío a Vercel.

## Licencias y dependencias

Se declara directamente `onnxruntime-node@1.30.0` (MIT), que ya existía transitivamente. No se incorpora un servicio de IA ni un framework nuevo. Sharp mantiene su licencia Apache-2.0; Express y la librería rmbg son MIT. La licencia de los pesos se comprueba separadamente.

- Código BiRefNet MIT: https://github.com/ZhengPeng7/BiRefNet/blob/main/LICENSE (copia en `licenses/BiRefNet-MIT.txt`).
- Pesos oficiales MIT: https://huggingface.co/ZhengPeng7/BiRefNet y https://huggingface.co/ZhengPeng7/BiRefNet_lite.
- ONNX oficiales: https://github.com/ZhengPeng7/BiRefNet/releases/tag/v1. Nombres, tamaños y SHA-256 fijados en `services/modelStore.js`.
- Entrada y logits según tutorial oficial: https://github.com/ZhengPeng7/BiRefNet/blob/main/tutorials/BiRefNet_pth2onnx.ipynb. El relleno para conservar proporciones es una adaptación explícita de la aplicación.
- BRIA: https://huggingface.co/briaai/RMBG-1.4. No se presupone licencia comercial por la licencia MIT del wrapper.

## Vercel

El error de pesos ausentes se corrige mediante descarga en `/tmp/claro-birefnet`, streaming, SHA-256, publicación atómica y reutilización de sesión. Los tests simulan las respuestas de red y comprueban el archivo escrito, corrupción, truncamiento, reintento y concurrencia de descargas. No comprueban la conectividad de GitHub desde tu instancia desplegada. Consultar `VERCEL.md` antes de redeploy; el consumo de memoria medido localmente puede exceder una Function de 2 GB.


## Ajuste Vercel 2 GB — 2026-11-12

Motor añadido: `birefnet-lite-efficient`. Modelo MIT, sin nuevas dependencias npm.
Procedencia y especificación en `licenses/BiRefNet-efficient-model-card.txt`; licencia heredada en `licenses/BiRefNet-MIT.txt`. Revisión y SHA-256 fijados en `services/modelStore.js`.

Reproducción con Node 22:

```sh
npm run models:download -- birefnet-lite-efficient
IMAGE_MEMORY_PROFILE=serverless node scripts/verify-redmi.js evidence/redmi/original.png evidence/redmi/export-efficient
node scripts/profile-onnx.js .cache/birefnet/lite-efficient.onnx 1024 basic evidence/memory/lite-efficient-noarena-node22 10 false
IMAGE_MEMORY_PROFILE=serverless node scripts/stress-memory.js
npm test
npm run build
node scripts/check-bundle.js
```

`IMAGE_MEMORY_PROFILE=serverless` permite probar localmente los mismos límites de hilos y caché sin activar Blob. En Vercel se activa automáticamente.

Resultado: 42 pruebas pasan, una integración histórica opcional omitida; la inferencia real se validó por separado con `verify-redmi.js`. Exportación PNG/JPG, alfa del fondo, zonas internas del producto, igualdad RGB del original y borrar/deshacer/rehacer/restaurar/exportar pasan. Revisión visual del JPG blanco: sin rectángulo ni pérdida visible de pantalla. Bundle trazado: 65.5 MiB (37 avisos de dependencias opcionales/plataformas). No se verificó este cambio mediante navegador ni despliegue remoto.

Diez inferencias repetidas: pico 1457.3 MiB, máscaras idénticas; tiempos individuales en el JSON de evidencia. La medición es RSS del proceso en macOS ARM64, no un límite de memoria impuesto ni una prueba Linux. El perfil anterior 1024/basic alcanzó 1975.6 MiB; 512 no fue seleccionado para evitar reducir resolución de segmentación.

Estrés del servicio completo: tres ciclos consecutivos con entrada 6000 × 4000 (24 MP), exportación 4000 × 4000 (16 MP), escala 2 y limpieza. Pico RSS 1841.7 MiB; evidencia `evidence/memory/service-stress.json`. El margen restante local es de unos 206 MiB y puede variar en Vercel; verificar Observability antes de considerar cerrado el incidente remoto.
