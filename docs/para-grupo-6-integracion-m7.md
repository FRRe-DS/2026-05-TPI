# Integración M6 (Viajes, Grupo 5) ↔ M7 (Tarifas, Pagos y Liquidaciones, Grupo 6)

Fecha: 11/11/2026. De: Grupo 5 (M6 – Viajes y Ciclo de Vida). Para: Grupo 6 (M7).

Este documento explica qué hace hoy M6 contra M7, qué probamos y qué falta de cada lado para que
los dos módulos queden conectados. Está pensado para que lo lean ustedes y también el asistente
(Claude) que trabaja en su repositorio: cada punto indica qué revisar en su código y cuándo está
cumplido.

**En resumen:** del lado de M6 ya están programadas las tres llamadas que pide su contrato
(tarifa final, pago y cargo de cancelación). La tarifa final funciona contra su código. Para el
pago y el cargo falta que ustedes implementen las rutas y que confirmen tres decisiones (A, B y
C), sobre todo la A: **M6 no manda el medio de pago (`metodo`)**.

## Para el asistente del Grupo 6

1. El contrato que se aplica es el **contrato común de M7** (Grupos 6 y 11), que está en el repo de
   la cátedra `FRRe-DS/2026-TPI`, archivo `contratos/m7_tarifas/openapi.yml`. En el repo del
   Grupo 6 está en el submódulo `contratos`. **No lo cambien unilateralmente:** cualquier cambio
   (por ejemplo, el de la decisión A) se acuerda con el Grupo 11 y se hace por PR al repo de la
   cátedra.
2. Recorran la sección "Qué falta del lado de M7" punto por punto. Para cada uno, comparen con el
   código de `m7-tarifas/` y digan si ya está, si falta, o si hace falta una decisión del grupo.
3. Las decisiones A, B y C no se resuelven sólo con código: hay que confirmárselas (o
   rechazárselas) al Grupo 5.
4. Si encuentran algo que M6 manda distinto de lo que M7 espera, avísennos con el detalle (ruta,
   campo, valor). Lo que manda M6 está descrito acá abajo y en nuestro repo.

## Qué hace M6 hoy

Repo: `https://github.com/FRRe-DS/2026-05-TPI`, rama `integracion-m7-tarifa-final`.
Código: `m6-viajes/src/viajes/infraestructura/registrador-cobro.m7.ts` (llamadas a M7) y
`m6-viajes/src/viajes/dominio/cargo-cancelacion.ts` (cuándo hay cargo).

Se activa con `REGISTRO_TARIFA=m7` y `M7_URL` (la URL de **un solo** M7, no de los dos, para no
cobrar dos veces). Todos los pedidos llevan `X-Request-Id` y, si M6 tiene configurado `M7_TOKEN`,
`Authorization: Bearer <token de servicio>`.

### 1. Al completar el viaje: tarifa final y después el pago

```http
POST {M7_URL}/api/v1/tarifas/viajes/{viaje_id}/tarifa-final
Content-Type: application/json

{ "tipo_vehiculo": "moto", "distancia_real_km": 4.2, "duracion_real_min": 15 }
```

| Campo de M7 | Sale de M6 | Detalle |
|---|---|---|
| `viaje_id` (ruta) | `trip.id` | UUID |
| `tipo_vehiculo` | `vehicleType` (`AUTO`/`MOTO`) | En minúsculas: `auto`/`moto` |
| `distancia_real_km` | `closure.distanceKm` | Decimal, mínimo 0.1 (M6 no acepta menos) |
| `duracion_real_min` | `closure.durationSeconds / 60` | Decimal con 2 decimales, **nunca menor que 0.01** (el contrato exige más de 0) |
| `multiplicador_demanda` | — | No se manda (M7 usa 1) |

- Si responde `201`, M6 toma el total de `desglose.total` de la respuesta.
- Si responde `409` (ya estaba registrada), M6 lee el total con
  `GET {M7_URL}/api/v1/tarifas/viajes/{viaje_id}/tarifa-final`.
- Con cualquier otra respuesta (`422`, `5xx`, sin respuesta en 2 s), M6 deja el error en su log y
  **no manda el pago**.

Con el total, M6 registra el pago:

```http
POST {M7_URL}/api/v1/pagos
Content-Type: application/json
Idempotency-Key: m6-pago-{viaje_id}

{
  "viaje_id": "…",
  "reserva_id": "…",          (sólo si el viaje viene de una reserva)
  "cliente_id": "…",          (trip.clientId)
  "beneficiario_id": "…",     (trip.driverId: el conductor)
  "monto": 1760.5             (desglose.total de la tarifa final)
}
```

**No lleva `metodo`** (ver la decisión A). La `Idempotency-Key` es fija por viaje, así que un
reintento nunca cobra dos veces.

### 2. Al cancelar con cargo: cargo de cancelación

Sólo si corresponde según la regla de la decisión B:

```http
POST {M7_URL}/api/v1/cargos-cancelacion
Content-Type: application/json
Idempotency-Key: m6-cargo-{viaje_id}

{
  "viaje_id": "…",
  "reserva_id": "…",          (sólo si el viaje viene de una reserva)
  "cliente_id": "…",
  "tipo_vehiculo": "auto",
  "motivo": "CHANGE_OF_PLANS" (el código de motivo de la cancelación en M6)
}
```

**Tampoco lleva `metodo`** (decisión A).

### Cómo toma M6 las respuestas

| Respuesta de M7 | Qué hace M6 |
|---|---|
| `201`, `200` (misma `Idempotency-Key`), `409` (ya existía) | OK |
| Cualquier otra, o sin respuesta en 2 s | Deja el error en su log. **El viaje igual queda `COMPLETED` o `CANCELLED`** y no se reintenta |

### Qué probamos (11/11)

Contra su código (`main`, commit `4251193`), con `m7-tarifas` corriendo en Python 3.12, SQLite y
`AUTH_DISABLED=true`:
1. Creamos reglas para `auto` y `moto` con `POST /api/v1/tarifas/reglas`.
2. En M6 recorrimos un viaje en moto (crear, arribo, inicio y fin con 4.2 km).
3. Tarifa final: `201`. El `GET` devolvió el desglose con la regla de moto (total 1760.5).
4. Pago: M6 mandó `POST /api/v1/pagos` con monto 1760.5, y M7 respondió `404` porque la ruta
   todavía no existe. El viaje quedó completado igual.

El pago y el cargo los probamos con respuestas simuladas, no contra un M7 real.

## Decisiones que tomamos (confírmenlas o díganos qué cambiar)

**A. Medio de pago: lo resuelve M7, y M6 no manda `metodo`.**
El contrato exige `metodo` en el pago y en el cargo, pero ningún contrato se lo pasa a M6: ni M5
cuando crea el viaje, ni el de M6 (que compartimos con el Grupo 12). Como RF-7.2 ("el cliente
registra o selecciona un medio de pago") es un requisito de M7, proponemos:
- `metodo` pasa a ser **opcional** en `PagoNuevo` y en `CargoCancelacionNuevo`.
- Si no llega, M7 usa el medio que el cliente eligió en M7. Si el cliente no eligió ninguno:
  `efectivo` para el viaje y, para el cargo (que no acepta efectivo), lo que ustedes definan.
- Es un cambio en el contrato común: hay que acordarlo con el Grupo 11 y hacer el PR al repo de la
  cátedra.

**Importante:** hasta que el contrato acepte el pago y el cargo sin `metodo`, un M7 que cumpla el
contrato actual va a rechazar esos dos pedidos de M6 (`400`). Si prefieren otra solución, avisen y
la adaptamos. La alternativa es que el cliente elija el medio al pedir el viaje y que viaje por
M5 → M6 → M7, pero eso obliga a cambiar los contratos de M5 (Grupos 4 y 13) y de M6 (Grupos 5 y 12).

**B. Cuándo hay cargo de cancelación: la regla está en M6.**
El contrato dice que M6 registra el cargo "cuando, según sus reglas", corresponde. M6 aplica esta
regla:
- **Hay cargo** si cancela el cliente cuando el conductor ya llegó
  (`previousState = DRIVER_ARRIVED`), o si cancela el conductor con motivo `CLIENT_NO_SHOW` (el
  cliente no se presentó).
- **No hay cargo** en los demás casos: antes del arribo, si el conductor cancela por otro motivo o
  si cancela el operador.

El importe lo calcula M7 (`cargo_cancelacion` de la regla activa).

**C. Orden: primero la tarifa final y después el pago.**
M6 registra primero la tarifa final (`201`) y después el pago, con `monto = desglose.total`. Así
lo describe el contrato.

## Qué falta del lado de M7

### 1. Autenticación entre M6 y M7 (Grupo 6, y PR al repo de la cátedra)

- **Situación:** su código tiene la configuración (`auth_disabled`, `keycloak_issuer_uri` y
  `keycloak_jwks_uri` en `app/core/config.py`), pero **ninguna ruta valida todavía el token**. Hoy
  M7 acepta cualquier pedido.
- **Qué falta en Keycloak:** el realm común (`keycloak/realm-config/ds-2026-realm.json` en el repo
  de la cátedra) no tiene los scopes `tarifas:read`, `tarifas:write`, `pagos:read` ni
  `pagos:write`. El cliente de M6, `grupo-05`, solo tiene `conductores:read` y
  `conductores:write`.
- **Qué pedimos:**
  - Sumar esos scopes al realm por PR al repo de la cátedra, coordinado con el Grupo 11.
  - Asignarle `tarifas:read`, `tarifas:write`, `pagos:read` y `pagos:write` al cliente `grupo-05`.
    Conviene asignárselos también a `grupo-12`, la otra implementación de M6.
- **Cuándo está hecho:**
  - Un token pedido por *client credentials* con el cliente `grupo-05` trae esos scopes en su
    claim `scope`.
  - M7 lo acepta en las tres rutas.
  - M7 responde `401` sin token y `403` si al token le falta el scope.

### 2. `POST /api/v1/pagos` (Grupo 6)

- **Situación:** está en el contrato, pero todavía no está implementada (`404`).
- **Cuándo está hecho:**
  - Acepta el cuerpo que manda M6 (sin `metodo`, según la decisión A).
  - Controla que `monto` sea el total de la tarifa final.
  - Responde según el contrato: `201`; `200` si se repite la misma `Idempotency-Key`; `409` si ya
    hay otro pago del viaje; `422` si el monto no coincide.

### 3. `POST /api/v1/cargos-cancelacion` (Grupo 6)

- **Situación:** está en el contrato, pero todavía no está implementada.
- **Cuándo está hecho:**
  - Acepta el cuerpo que manda M6 (sin `metodo`).
  - Calcula el importe con el `cargo_cancelacion` de la regla activa del tipo de vehículo.
  - Responde según el contrato.

### 4. Lo que **no** necesitan hacer por M6

- No hace falta que consuman los eventos de M6 (`TripCompleted`, `TripCancelled`) para cobrar:
  M6 los llama por REST. Los eventos siguen existiendo para otros módulos.
- No hay nada que cambiar en la tarifa final (`POST .../tarifa-final`): ya funciona con lo que
  manda M6.
- No hay nada que cambiar en la estimación (`POST /api/v1/tarifas/estimaciones`): esa la usan M5 y
  M9, no M6.

## Cómo probar juntos

1. **M7 (Grupo 6):** levantar como dice su README (`docker compose up --build -d`, API en el puerto
   8000) y crear una regla activa para `auto` y otra para `moto` con `POST /api/v1/tarifas/reglas`.
   Para probar el cargo, la regla tiene que tener `cargo_cancelacion` mayor que 0.
2. **M6 (Grupo 5):** en `m6-viajes/.env` configurar:
   ```
   REGISTRO_TARIFA=m7
   M7_URL=http://localhost:8000      # con M6 en Docker: http://host.docker.internal:8000
   # M7_TOKEN=<token de servicio de grupo-05>   cuando M7 valide tokens
   ```
   y levantar con `npm run start:dev` (ver el README de nuestro repo). Swagger queda en
   `http://localhost:3000/docs`.
3. **Viaje completado:** `POST /trips` → `/arrived` → `/start` con
   `{"verificationToken": "QR-<id>"}` → `/complete` con `{"distanceKm": 4.2}`. En M7 tienen que
   aparecer la tarifa final y un pago del viaje por ese total.
4. **Cancelación con cargo:** `POST /trips` → `/arrived` → `/cancel` con el token del cliente y
   `{"reason": "CHANGE_OF_PLANS"}`. En M7 tiene que aparecer un pago de concepto
   `cargo_cancelacion`.

## Resumen

| Tema | Quién | Estado |
|---|---|---|
| Tarifa final al completar | M6 + M7 | ✅ Funciona y está probado |
| Pago al completar | M6 ✅ / M7 pendiente | Falta la ruta en M7 y confirmar A y C |
| Cargo al cancelar | M6 ✅ / M7 pendiente | Falta la ruta en M7 y confirmar A y B |
| `metodo` opcional en el contrato (decisión A) | Grupo 6 + Grupo 11 (PR a la cátedra) | Pendiente |
| Validar tokens en M7 | Grupo 6 | Pendiente |
| Scopes de tarifas y pagos en Keycloak para `grupo-05` | Grupo 6 + Grupo 11 (PR a la cátedra) | Pendiente |

¡Gracias! — Grupo 5 (M6)
