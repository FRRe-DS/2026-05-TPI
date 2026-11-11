# Demo: inicio de viaje con QR real (M6 + M8 de los grupos 7 y 10)

Levanta **M6** (nosotros) y los **dos M8** (grupos 7 y 10) desde sus propios repositorios, y
recorre el inicio de un viaje con un QR generado por M8 (RF-6.4, RF-8.3).

## Requisitos

- Docker Desktop encendido.
- Node.js 22.
- Los repos de los grupos 7 y 10 clonados al lado de este repo, en `../otros grupos/2026-07-TPI`
  y `../otros grupos/2026-10-TPI`. Si están en otro lugar, crear un `.env` en esta carpeta con
  `G7_REPO=...` y `G10_REPO=...`.
- El repo del Grupo 10 en su rama **`develop`** (`git checkout develop`): es la que implementa el
  contrato coordinado con el G7. Su `main` todavía no tiene esas rutas.

## Cómo correrla

Desde esta carpeta (`demo/integracion-m8`):

```bash
docker compose up -d --build --wait   # la primera vez tarda ~10 min (compila los tres servicios)
node demo.mjs                         # corre la demo y abre las imágenes de los QR
docker compose down -v                # al terminar: apaga y borra todo
```

## Qué muestra

| Caso | Qué pasa | Resultado esperado |
|---|---|---|
| 1 | Viaje con QR del **Grupo 7**: primero un código falso, después el real | `422` y luego `IN_PROGRESS` |
| 2 | Viaje con QR del **Grupo 10** | `IN_PROGRESS` |
| 3 | Se reusa el QR del caso 2 en otro viaje | `422`: es de un solo uso |
| 4 | Un QR del viaje A se escanea en el viaje B | `422`: M6 compara el viaje (el G7 no lo hace) |

Cada paso imprime el pedido HTTP y la respuesta. Al final, el resumen separa lo que es de M6 de
los problemas encontrados en los otros grupos.

## Dónde mirar mientras corre

| Qué | Dónde |
|---|---|
| Imágenes de los QR generados | `salida/` (se abren solas) |
| Qué hace M6 por dentro (llamadas a cada M8) | `docker compose logs -f m6` |
| API del M8 del Grupo 10 (Swagger) | http://localhost:3010/api/docs |
| Contrato del M8 del Grupo 7 | http://localhost:8088/swagger/v1/swagger.json |
| Emails que manda el M8 del Grupo 10 | http://localhost:8025 |
| Estado de cada contenedor | Docker Desktop → Containers → `lab-m6-m8` |

## Problemas de los otros grupos que el laboratorio rodea

- **G7:** generar el QR responde `500` siempre: el atributo `[property: Range(30, 3600)]` en un
  `record` hace fallar la validación de ASP.NET. La demo guarda el QR en su Redis con el mismo
  formato que usa su código, para poder probar igual su **validación**, que es la que usa M6.
  Además valida en `/api/Documentos/qr/validar` y no en la ruta de su contrato (por eso
  `M8_G7_RUTA_QR`).
- **G10:** la imagen de su `main` no arranca tal como está (OpenSSL, permisos y migraciones de
  Prisma); en `develop` lo arreglaron. El `docker-compose.yml` arranca bien con las dos ramas, sin
  tocar su repositorio.
