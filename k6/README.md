# Pruebas de carga con k6 — M6 · Grupo 5

Runbook operativo para ejecutar y reproducir las pruebas de carga de **M6 — Viajes y Ciclo de Vida (Grupo 5)** según la especificación cerrada en [PROPUESTA.md](./PROPUESTA.md).

## 1. Requisitos previos

* **Docker** instalado y en ejecución (se utiliza la imagen `grafana/k6:0.54.0`; no requiere instalar k6 localmente).
* **`curl`** disponible en el host para la verificación previa de `GET /health`.
* Servicio M6 levantado con:
  * `VALIDADOR_QR=simulado` (para validar tokens `QR-<id>` sin depender de M8).
  * `REGISTRO_TARIFA=ninguno` (para no llamar a M7 al finalizar el viaje).
  * `JWT_SECRETO` de al menos 16 caracteres (exclusivo del entorno de prueba; nunca reutilizar el de producción).

## 2. Escenario y modos

Cada iteración ejecuta el ciclo completo de un viaje:

1. `SYSTEM` crea el viaje (`POST /trips`, espera `201`).
2. `DRIVER` registra arribo (`POST /trips/:id/arrived`, espera `200`).
3. 15% cancela con `CLIENT` (`POST /trips/:id/cancel`, motivo `CHANGE_OF_PLANS`, sin lecturas).
4. 85% inicia con `DRIVER` (`POST /trips/:id/start`, `verificationToken: "QR-<id>"`) y finaliza (`POST /trips/:id/complete`, `distanceKm` entre 2 y 12).
5. 20% de los viajes completados ejecutan lecturas (`GET /trips/:id` y `GET /trips/:id/history`) con `DRIVER`.

| Modo | VUs | Perfil (rampa / régimen / bajada) | IDs y pool `SYSTEM` | Umbrales |
|---|---|---|---|---|
| `smoke` | 2 | `10s / 20s / 20s` | Nuevos por iteración + pool `ceil(VUs/20)+2` | `http_req_failed < 1%`, `checks > 99%`, `m6_viajes_completados > 0` |
| `serie` | 50, 100, 500, 1000 (secuencial, 30s enfriamiento) | `1m / 3m / 20s` | Nuevos por iteración + pool `ceil(VUs/20)+2` | `http_req_failed < 5%`, `p95 < 1500ms`, `checks > 99%`, `m6_http_429 == 0` |
| `limites` | 500 | `1m / 3m / 20s` | Fijos por VU + único `m5-despacho-1` | `m6_http_5xx == 0`, `p95(expected_response:true) < 1500ms`, `m6_http_429 > 0` |
| `individual` | Configurable (`50`, `100`, `500`, `1000`) | Configurable (default `1m / 3m / 20s`) | Nuevos por iteración + pool `ceil(VUs/20)+2` | Igual que `serie` |

## 3. Ejecución local

### 3.1 Levantar el servicio local para smoke

Para una validación rápida de funcionamiento sin dependencias externas:

```bash
cd m6-viajes
JWT_SECRETO="secreto-local-de-prueba-1234" \
PERSISTENCIA=memoria \
PUBLICADOR_EVENTOS=log \
IDEMPOTENCIA=memoria \
VALIDADOR_QR=simulado \
REGISTRO_TARIFA=ninguno \
npm run start:dev
```

### 3.2 Correr k6 en local

Desde la raíz del repositorio:

```bash
# Smoke test (2 VUs, 10s rampa / 20s régimen)
JWT_SECRETO="secreto-local-de-prueba-1234" ./k6/correr-local.sh smoke

# Corrida individual (ej. 100 VUs)
JWT_SECRETO="secreto-local-de-prueba-1234" ./k6/correr-local.sh individual 100

# Corrida individual con duración personalizada
JWT_SECRETO="secreto-local-de-prueba-1234" RAMPA=30s DURACION=1m LECTURAS=20 ./k6/correr-local.sh individual 50

# Corrida de límites (500 VUs alcanzando 429 a propósito)
JWT_SECRETO="secreto-local-de-prueba-1234" ./k6/correr-local.sh limites

# Serie completa secuencial (50 -> 100 -> 500 -> 1000 VUs, ~23 min)
JWT_SECRETO="secreto-local-de-prueba-1234" ./k6/correr-local.sh serie
```

Si el entorno exige `iss` o `aud`, exportar además `JWT_EMISOR` y/o `JWT_AUDIENCIA`.

> **Windows con Docker Desktop:** si `--network host` no resuelve `localhost` desde el contenedor, pasar `BASE_URL="http://host.docker.internal:3000"`.

### 3.3 Corrida local opcional con límites desactivados (100 VUs)

Esta corrida es únicamente local y preliminar (queda fuera de la evidencia cloud). En G5, `0` desactiva el limitador de pedidos. Reiniciar el servicio local con:

```bash
LIMITE_PEDIDOS_POR_MINUTO=0
LIMITE_PEDIDOS_SERVICIO_POR_MINUTO=0
```

Y ejecutar:

```bash
JWT_SECRETO="secreto-local-de-prueba-1234" MODO_ETIQUETA=local ./k6/correr-local.sh individual 100
```

## 4. Ejecución en GitHub Actions (cloud)

Workflow: [`.github/workflows/k6.yml`](../.github/workflows/k6.yml). Se dispara únicamente de forma manual mediante **`workflow_dispatch`** desde la pestaña **Actions → M6 Viajes - Pruebas de carga (k6)**.

### 4.1 Secrets y variables requeridos en el repositorio

| Nombre | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `K6_BASE_URL` | Secret | Sí | URL pública del servicio de prueba (sin barra final o con ella, se normaliza). |
| `K6_JWT_SECRETO` | Secret | Sí | Secreto HS256 exclusivo del entorno de prueba (mínimo 16 caracteres). |
| `K6_JWT_EMISOR` | Variable | No | Valor esperado en claim `iss` si el servicio valida emisor. |
| `K6_JWT_AUDIENCIA` | Variable | No | Valor esperado en claim `aud` si el servicio valida audiencia. |

### 4.2 Entradas del workflow

* `modo`: `smoke` | `serie` | `limites` | `individual`
* `vus`: `50` | `100` | `500` | `1000` (solo aplica en `individual`)
* `rampa`: texto, default `1m` (solo aplica en `individual`)
* `duracion`: texto, default `3m` (solo aplica en `individual`)
* `lecturas`: texto, default `20` (porcentaje de lecturas GET)

### 4.3 Protocolo de ejecución en cloud

1. Reiniciar el servicio de prueba antes de iniciar la serie (no truncar tablas; registrar volumen acumulado en bitácora).
2. Ejecutar primero `modo=smoke` para validar conectividad, autenticación y `/health`.
3. Ejecutar `modo=serie` (un solo job que corre 50, 100, 500 y 1000 VUs con 30s de enfriamiento; ~23 minutos).
4. Al terminar la serie, ejecutar `modo=limites` (500 VUs con IDs fijos por VU).
5. Descargar los artifacts `k6-<modo>-<run_id>` para consolidar la tabla comparativa junto con G12.

> **Nota sobre concurrencia:** el workflow define `concurrency` con `cancel-in-progress: false` para impedir que dos corridas se superpongan sobre el mismo servicio.

## 5. Evidencia y resultados

* En local, los archivos se guardan en `k6/resultados/` (ignorado por Git).
* En Actions, se suben siempre (`if: always()`) en el artifact `k6-<modo>-<run_id>`.
* Archivos generados por cada nivel (`testid = g5-<modo>-<vus>vu-<timestamp>`):
  * `resumen-<testid>.json`: percentiles (`avg`, `min`, `med`, `p90`, `p95`, `p99`, `max`), tasas, `dropped_iterations` y contadores propios (`m6_viajes_completados`, `m6_viajes_cancelados`, `m6_ciclos_fallidos`, `m6_http_429`, `m6_http_5xx`, `m6_lecturas`).
  * `salida-<testid>.txt`: salida completa de consola y diagnóstico de CPU del runner.

Plantilla de tabla comparativa:

| Corrida | VUs | p50 | p95 | p99 | req/s | % errores | 429 | 5xx | Viajes completados | Cancelados |
|---|---|---|---|---|---|---|---|---|---|---|
| serie | 50 | | | | | | | | | |
| serie | 100 | | | | | | | | | |
| serie | 500 | | | | | | | | | |
| serie | 1000 | | | | | | | | | |
| limites | 500 | | | | | | | | | |
