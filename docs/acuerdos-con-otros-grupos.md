# Acuerdos de integración con otros grupos

M6 depende de que los demás módulos lo invoquen y consuman sus eventos de la forma que definimos.
Este documento reúne, para cada grupo:
- qué necesitamos acordar;
- nuestra propuesta concreta;
- las preguntas abiertas;
- un **mensaje listo para mandar** (WhatsApp, Discord o mail).

Cada módulo tiene **dos implementaciones**, por lo que el mismo mensaje se envía a los dos grupos
de ese módulo (según la tabla de "Grupos y Módulos" de la consigna). Como la consigna no asigna
grupo a M1, esa consulta se dirige a la cátedra.

Cuando se cierra un acuerdo:
1. marcarlo en la tabla de seguimiento;
2. anotar lo decidido en la sección del módulo;
3. si cambia algo del contrato, actualizar `contratos/` y registrar el cambio en la bitácora.

## Seguimiento

| Módulo | Grupos | Tema principal | Prioridad | Estado |
|---|---|---|---|---|
| M5 Despacho | 4 y 13 | Cómo se crea el viaje y cómo vuelve una solicitud al despacho | Alta | Repos revisados; mensajes listos para enviar (ninguno implementó todavía la llamada a M6) |
| M8 Notificaciones | 7 y 10 | Generación y validación del QR, eventos | Alta | Repos revisados; M6 adaptado a ambos; mensajes listos para enviar |
| Cátedra | — | Quién hace M1, formato del token y aprobación del stack (RNF-01) | Alta | Sin enviar |
| M6 (otra impl.) | 12 | Unificar el contrato de M6 (guía paso a paso de qué cambia cada uno) | Alta | Sin enviar |
| M7 Pagos | 6 y 11 | Datos para cobro y cargo de cancelación | Media | Sin enviar |
| M4 Ubicación | 3 y 14 | Liberar al conductor al terminar o cancelar | Media | Sin enviar |
| M2 Clientes | 1 y 17 | Historial de viajes y calificación | Baja | Sin enviar |
| M3 Conductores | 2 y 15 | Calificación del cliente | Baja | Sin enviar |
| M9 Reservas | 8 y 9 | Viajes originados en reservas | Baja | Sin enviar |
| Todos | — | Convenciones comunes (errores, eventos, correlación, límites, tokens) | Alta | Sin enviar |
| Equipo integrador | Todos | Infraestructura compartida, puertos, credenciales y datos de demo | Media | Sin enviar |

Estados posibles: Sin enviar, Enviado, En discusión y Acordado.

### Novedades desde la primera versión de este documento

Estos puntos se incorporaron a los mensajes porque cambian la forma en que otros módulos invocan a M6 o consumen sus eventos:

| Novedad | A quién afecta | Qué tienen que hacer |
|---|---|---|
| **Límite de pedidos:** 120 por minuto por usuario y 1200 para servicios. Al pasarse responde `429` con `Retry-After` | Todos los que llaman a la API (M5, M2, apps) | Esperar los segundos de `Retry-After` y reintentar |
| **El token debe traer `exp`** (vencimiento); si no, `401` | M1 y quien genere tokens de servicio | Emitir tokens con vencimiento |
| **Los eventos pueden llegar repetidos** (entrega "al menos una vez", por el outbox) | Todos los que escuchan eventos (M5, M7, M8, M4, M2, M3, M9) | Ignorar los `eventId` ya procesados. **Clave para M7: si no, cobraría dos veces** |
| **`Idempotency-Key`** en las acciones: repetir un pedido no lo ejecuta dos veces | Apps de cliente y conductor | Mandar una clave única por acción (por ejemplo un UUID) y reusarla al reintentar |
| **Health checks:** `GET /health` (vivo) y `GET /health/details` (estado de la base, RabbitMQ y Redis) | Equipo integrador | Usarlos para monitorear |
| **Contrato en inglés:** rutas `/trips/...`, estados `PENDING_ARRIVAL`…`COMPLETED`/`CANCELLED`, roles `CLIENT`/`DRIVER`/`OPERATOR`/`SYSTEM` (claim `role`), campos como `clientId` y `requestId`, eventos `TripCreated`…`TripCancelled` | Todos los que llaman a M6 o escuchan sus eventos | Usar los nombres nuevos (están en los contratos de `contratos/`) |
| **Ubicaciones y distancia:** cuatro campos `double` (`originLatitude`, …) y `distanceKm` decimal | M5 (crea el viaje), M7 (cobra por distancia) | Mandar las coordenadas sueltas; leer `distanceKm` en km |
| **Creación idempotente por `requestId`** (ya no existe `assignmentId`): una solicitud tiene un único viaje | M5 | Al re-despachar tras una cancelación, usar un `requestId` nuevo |
| **Errores con `code`, `message` y `timestamp`** (además de los campos de RFC 9457) | Todos los que llaman a la API | Leer `code` (en inglés) para decidir |

Los contratos completos están en el repositorio:
- `contratos/openapi.yaml`: la API.
- `contratos/eventos/m6-viajes.asyncapi.yaml`: los eventos.
- `docs/catalogo-eventos.md`: versión legible de los eventos.

Junto con cada mensaje conviene adjuntar los archivos o compartir el enlace al repositorio.

---

## Para todos: convenciones comunes

**Por qué:** si cada grupo usa un formato distinto de error, de evento o de token, la integración
del TP2 se complica considerablemente. Lo conveniente es acordarlo una sola vez para todos.

**Propuesta:**

| Tema | Propuesta |
|---|---|
| Errores HTTP | `application/problem+json` (RFC 9457) con un campo `code` estable en MAYÚSCULAS, más `message` y `timestamp`. Ej.: `{ "status": 409, "code": "INVALID_STATE_TRANSITION", "message": "...", "timestamp": "..." }` |
| Correlación | Header `X-Correlation-Id`: si llega se propaga a las llamadas y eventos siguientes; si no, se genera. |
| Broker | RabbitMQ, un exchange `movilidad.eventos` de tipo `topic`. |
| Routing key | `<modulo>.<entidad>.<hecho-en-pasado>`. Ej.: `trips.trip.completed`, `despacho.asignacion.confirmada`. |
| Sobre de eventos | `{ eventId, eventType, eventVersion, occurredAt, producer, correlationId, payload }` |
| Entrega | Al menos una vez: cada consumidor descarta duplicados por `eventId`. |
| Privacidad | Los eventos no llevan coordenadas, datos personales ni secretos. |
| Ids y fechas | UUID para ids; fechas ISO 8601 en UTC. |
| Tokens | JWT con `sub`, `role` y **`exp` obligatorio** (ver la sección de la cátedra). |
| Límite de pedidos | Headers `RateLimit-Limit`, `RateLimit-Remaining` y `RateLimit-Reset`; al superarlo, `429` con `Retry-After`. |
| Reintentos seguros | Header `Idempotency-Key` en las operaciones que cambian datos. |
| Salud | `GET /health` (el proceso está vivo) y `GET /health/details` (estado de las dependencias). |

**Mensaje para el grupo general:**

> Hola a todos, somos el Grupo 5 (M6 – Viajes). Para que la integración del TP2 sea más simple,
> proponemos usar las mismas convenciones en todos los módulos:
> - Errores HTTP en formato `application/problem+json` con un campo `code` fijo, más `message` y `timestamp` (ej. `"code": "INVALID_STATE_TRANSITION"`).
> - Header `X-Correlation-Id` para seguir un pedido entre módulos.
> - RabbitMQ con un único exchange `movilidad.eventos` (topic) y routing keys `<modulo>.<entidad>.<hecho>` (ej. `trips.trip.completed`).
> - Todos los eventos con el mismo sobre: `eventId, eventType, eventVersion, occurredAt, producer, correlationId, payload`.
> - Ids UUID y fechas ISO 8601 en UTC.
> - Como los eventos se entregan "al menos una vez", cada consumidor ignora los `eventId` que ya procesó.
> - Tokens JWT siempre con vencimiento (`exp`).
> - Para reintentar sin duplicar: header `Idempotency-Key`. Ante un `429`, esperar lo que diga `Retry-After`.
> - Health checks en `GET /health` y `GET /health/details`, para que el equipo integrador pueda monitorear.
>
> Lo tenemos documentado en `docs/catalogo-eventos.md` de nuestro repo. ¿Les sirve? ¿Alguien
> prefiere otra cosa? Si les parece, armamos un catálogo común donde cada grupo agregue sus eventos.

---

## M5 – Solicitud y Despacho (Grupos 4 y 13)

**Qué necesitamos:** M5 es el módulo que **crea** el viaje en M6. Además, cuando un conductor
cancela antes de iniciar, la solicitud debe **volver** a M5 para que busque otro conductor.

**Propuesta:**

1. **Creación síncrona.** Cuando M5 confirma la asignación de un conductor, llama a `POST /trips` con un
   token de servicio:
   ```json
   {
     "requestId": "uuid",
     "reservationId": "uuid o null",
     "clientId": "uuid",
     "driverId": "uuid",
     "vehicleId": "uuid",
     "vehicleType": "AUTO | MOTO",
     "originLatitude": -34.60,
     "originLongitude": -58.38,
     "destinationLatitude": -34.58,
     "destinationLongitude": -58.39,
     "originAddress": "opcional",
     "destinationAddress": "opcional"
   }
   ```
   Respuestas posibles:
   - `201`: viaje creado.
   - `200`: ya existía un viaje para ese `requestId` con los mismos datos; M5 puede reintentar sin
     duplicar. Se devuelve el viaje en su estado actual.
   - `409 REQUEST_ID_CONFLICT`: el `requestId` ya existe, pero con datos distintos.

   La idempotencia es por `requestId`, igual que en el contrato del Grupo 12: una solicitud tiene un
   único viaje.
2. **Vuelta al despacho por evento.** M5 escucha `trips.trip.cancelled`. Si
   `payload.requiresRedispatch` es `true`, vuelve a buscar conductor. Como una solicitud tiene un
   único viaje, al re-despachar M5 debe crear el nuevo viaje con un `requestId` **nuevo**.

3. **Límite de pedidos:** como servicio, M5 puede hacer hasta **1200 pedidos por minuto**. Si lo
   supera recibe `429` con `Retry-After`. Reintentar `POST /trips` es seguro: con el mismo
   `requestId` y los mismos datos no se duplica el viaje.
4. **Eventos repetidos:** `TripCancelled` puede llegar más de una vez. Hay que ignorar los
   `eventId` ya procesados, para no redespachar dos veces.

**Preguntas abiertas:**
- Al re-despachar tras una cancelación, ¿pueden generar un `requestId` nuevo para el viaje nuevo?
  Es lo que necesitamos, porque `requestId` es la clave de idempotencia de la creación.
- ¿Prefieren avisar la asignación por evento (`despacho.asignacion.confirmada`) en lugar de llamar
  a `POST /trips`? Podemos adaptarnos.
- ¿Quién le avisa a M4 que el conductor quedó ocupado: M5 al asignar, o M4 escuchando eventos?

**Mensaje:**

> Hola, somos el Grupo 5 (M6 – Viajes y Ciclo de Vida). Queremos cerrar con ustedes cómo se
> conectan M5 y M6:
>
> **1) Creación del viaje:** cuando confirman la asignación de un conductor, nos llaman a
> `POST /trips` (con token de servicio) con `requestId, reservationId (o null),
> clientId, driverId, vehicleId, vehicleType (AUTO|MOTO), originLatitude/originLongitude y destinationLatitude/destinationLongitude (campos sueltos, tipo double)`. Respondemos
> 201 con el viaje, o 200 si ya existía para ese `requestId` con los mismos datos (así pueden
> reintentar sin duplicar), o 409 si el `requestId` existe con datos distintos.
>
> **2) Devolución al despacho:** si el conductor cancela antes de iniciar, publicamos
> `TripCancelled` (routing key `trips.trip.cancelled`) con `requiresRedispatch: true` y el
> `requestId`. Ustedes lo escuchan y vuelven a buscar conductor. Ojo: un evento puede llegar
> repetido, así que conviene ignorar los `eventId` que ya procesaron.
>
> **3) Límites:** con token de servicio pueden hacer hasta 1200 pedidos por minuto; si se pasan,
> respondemos `429` con `Retry-After`. Reintentar `POST /trips` es seguro.
>
> Preguntas: si un conductor cancela y re-despachan, ¿pueden usar un `requestId` nuevo para el viaje
> nuevo? ¿Prefieren avisarnos por evento en vez de llamar a
> la API? ¿Quién marca al conductor como ocupado en M4?
>
> Les pasamos el contrato (`contratos/openapi.yaml`). ¡Gracias!

### Lo que hizo cada grupo (repos revisados el 11/11)

| | Grupo 4 (Node + Prisma) | Grupo 13 (Python FastAPI + MySQL) |
|---|---|---|
| Documentación | Su `docs/openapi-a.yml` **ya adopta nuestro contrato**: `POST /trips`, `solicitud_id` como `requestId`, nuestros estados. Convertía `AUTO`/`MOTO` a `CAR`/`MOTORCYCLE`; desde el 11/11 M6 usa `AUTO`/`MOTO` y la conversión sobra. | `Contratos/integracion_m6.yml`: propuesta propia "pendiente de confirmación con M6", **no implementada**. |
| Ruta y cuerpo | El código (`notificaciones.js`) manda `{ solicitudId, conductorId, ofertaId }` a una ruta todavía sin definir. **Faltan** `clientId`, `vehicleId`, `vehicleType` y las coordenadas. | `POST /viajes` con `solicitud_id`, `cliente_id`, `conductor_id`, `vehiculo_id`, `origen_latitud`… (snake_case, en castellano). **Falta** `vehicleType`, aunque lo tienen (`tipo_vehiculo`). Esperan `{ viaje_id, solicitud_id, estado: "CREADO" }`. |
| Token de servicio | Sus roles son `CLIENTE`, `CONDUCTOR`, `OPERADOR`, `ADMINISTRADOR`: no hay rol de servicio. Para crear viajes M6 exige rol de servicio (`SYSTEM`, o los alias `SERVICIO` / `SERVICE` desde el 11/11). | No llaman a M6 todavía. |
| Redespacho | Fuera de su versión. Usan `solicitud_id` como `requestId` **fijo**: al redespachar, M6 devolvería el viaje cancelado (`200`) en vez de crear uno nuevo. | No lo mencionan. Publican `conductor.asignado` (para M6 y M8) como alternativa por evento. |
| Eventos | No usan RabbitMQ: hoy no se enterarían de `TripCancelled`. | Catálogo de eventos propio; no escuchan los de M6. |

**Decisión:** mantenemos nuestro contrato. Lo compartimos con el Grupo 12 (la otra implementación
de M6), y cambiarlo para un M5 rompería la unificación. Los dos grupos de M5 todavía no tienen la
llamada implementada, así que adaptarse no les cuesta rehacer código.

**Pendiente de acordar:**
1. **Ambos:** mandar el cuerpo completo de `POST /trips` en camelCase y en inglés (ver propuesta de
   arriba), y tomar `201`/`200` como éxito y `409` como conflicto.
2. **Redespacho:** al volver a buscar conductor, usar un `requestId` **nuevo** derivado de la
   solicitud y el intento (por ejemplo, UUID v5 de `solicitud_id + ":" + intento`). Así cada intento
   es reintentable sin duplicar, y el redespacho crea un viaje nuevo.
3. **Ambos:** escuchar `trips.trip.cancelled` en el exchange `movilidad.eventos` y redespachar
   cuando `requiresRedispatch` sea `true`.
4. **Consorcio / M1:** que exista un rol de servicio en los tokens para las llamadas entre
   módulos. M6 acepta `SYSTEM`, `SERVICIO` o `SERVICE`, en `role` o en la lista `roles`.

### Mensaje para el Grupo 4

> Hola, somos el Grupo 5 (M6 – Viajes). Vimos que su `openapi-a.yml` ya toma nuestro contrato
> (`POST /trips`, `solicitud_id` como `requestId`). ¡Genial! Una novedad que les simplifica: junto
> con el Grupo 12 pasamos `vehicleType` a `AUTO`/`MOTO`, así que ya no hace falta convertirlo a
> `CAR`/`MOTORCYCLE`. Para cerrar la integración:
> 1. En `notificaciones.js`, `conductorAsignado` hoy manda `{ solicitudId, conductorId, ofertaId }`.
>    `POST /trips` necesita `requestId, clientId, driverId, vehicleId, vehicleType,
>    originLatitude, originLongitude, destinationLatitude, destinationLongitude` (y opcionales
>    `reservationId`, `originAddress`, `destinationAddress`). Está todo en nuestro
>    `contratos/openapi.yaml`. Respondemos `201` (creado), `200` (ya existía, reintento seguro) o
>    `409` (mismo `requestId` con otros datos).
> 2. Para crear viajes M6 pide un JWT con rol de servicio: `SYSTEM`, `SERVICIO` o `SERVICE`, en
>    `role` o en la lista `roles`. Sus roles no tienen uno de servicio: ¿lo planteamos juntos a la
>    cátedra / M1?
> 3. Redespacho: si usan `solicitud_id` fijo como `requestId`, al redespachar les devolveríamos el
>    viaje cancelado. Proponemos un `requestId` por intento, por ejemplo un UUID v5 de
>    `solicitud_id + ":" + intento`.
> 4. Cuando un conductor cancela antes de iniciar, publicamos `trips.trip.cancelled` (exchange
>    `movilidad.eventos`) con `requiresRedispatch: true`. ¿Pueden escucharlo para redespachar?
>    Puede llegar repetido: conviene ignorar los `eventId` ya procesados. ¡Gracias!

### Mensaje para el Grupo 13

> Hola, somos el Grupo 5 (M6 – Viajes). Vimos su `Contratos/integracion_m6.yml` (crear el viaje
> después de asignar conductor). Nuestro contrato ya está definido y unificado con el Grupo 12 (la
> otra implementación de M6), así que les pedimos adaptar la propuesta a él. Como todavía no lo
> implementaron, son sólo nombres:
> - Ruta: `POST /trips` (no `/viajes`), con JWT de servicio (rol `SYSTEM`, `SERVICIO` o `SERVICE`).
> - Cuerpo en camelCase y en inglés: `requestId` (su `solicitud_id`), `clientId`, `driverId`,
>   `vehicleId`, `vehicleType` (`AUTO`/`MOTO`, los mismos valores que su `tipo_vehiculo`),
>   `originLatitude`, `originLongitude`, `destinationLatitude`, `destinationLongitude`, y opcionales
>   `reservationId`, `originAddress`, `destinationAddress`.
> - Respuesta: `201` con el viaje completo (`id`, `requestId`, `state: "PENDING_ARRIVAL"`, …),
>   `200` si ya existía para ese `requestId` (reintento seguro), `409` si existe con otros datos y
>   `400` si hay datos inválidos.
>
> Para el redespacho: cuando un conductor cancela antes de iniciar, publicamos
> `trips.trip.cancelled` (exchange `movilidad.eventos`) con `requiresRedispatch: true`; al
> redespachar, usen un `requestId` nuevo por intento. El contrato completo está en nuestro
> `contratos/openapi.yaml`. ¡Gracias!

**Acordado:** _(completar)_

---

## M8 – Notificaciones, Documentos y Soporte (Grupos 7 y 10)

**Qué necesitamos:** según RF-8.3, el QR de un solo uso lo **genera M8**, y M6 debe
**validarlo** para iniciar el viaje (RF-6.4). Además, M8 notifica los hitos y genera el
comprobante a partir de nuestros eventos.

Hay **dos implementaciones de M8** (Grupos 7 y 10) y la app web final tiene que funcionar con
las dos. Revisamos sus repositorios (G7: commit del 24/10; G10: commit del 22/10).

### Lo que publicó cada grupo

| | Grupo 7 (.NET, puerto 8088) | Grupo 10 (NestJS) |
|---|---|---|
| Generar QR | `POST /api/v1/viajes/{viajeId}/qr` `{ clienteId, validezSegundos }` (600 s por defecto). Si se genera otro, el anterior queda `REEMPLAZADO`. | `POST /api/v1/documents/qr/generate` `{ tripId, passengerId, ttlSeconds }` (300 s por defecto). |
| Validar QR (contrato) | `POST /api/v1/qr/validaciones` `{ token, viajeId }` → `200` válido; `404` no existe; `409` usado o reemplazado; `422` vencido o de otro viaje. | `POST /api/v1/documents/qr/verify` `{ token, tripId }` → `200 { valid: true }`; `400` de otro viaje; `404` no existe; `410` vencido o usado. |
| Validar QR (código actual) | **Distinto del contrato:** `POST /api/Documentos/qr/validar` `{ token }` → `200 { valido, viajeId }` o `410`. **No verifica que el QR sea del viaje.** | Igual al contrato. Rechaza campos extra (`forbidNonWhitelisted`). |
| Autenticación | JWT de M1 con rol `SERVICIO` (en el contrato; el código aún no lo exige). | JWT de M1 (en el contrato; el código aún no lo exige). |
| Eventos de M6 | **No escucha RabbitMQ**: espera que M6 haga `POST /api/v1/eventos` con su formato (`tipo: VIAJE_INICIADO`…, `destinatarios` obligatorio). | RabbitMQ, exchange `urban_mobility_events`, hoy sólo `trip.completed` (configurable por variables de entorno). |

### Cómo lo resolvimos en M6 (rama `integracion-m8-qr`)

- `VALIDADOR_QR=m8` consulta **en paralelo** a los M8 de `M8_PROVEEDORES` (`g7,g10`). El QR lo
  generó uno solo, así que a lo sumo uno lo reconoce y lo consume.
  - Alguno lo acepta → se inicia el viaje.
  - Alguno lo conoce y lo rechaza (`400`, `409`, `410`, `422`) → `422` al conductor.
  - Ninguno lo reconoce y alguno no respondió en 2 s (o dio `5xx`, `401`, `403`) → `503`, el viaje
    no cambia.
  - Todos dicen `404` → `422`.
- A cada M8 se le manda su propio formato (`viajeId` para G7, `tripId` para G10), el header
  `Authorization` con el JWT de servicio (`M8_G7_TOKEN`, `M8_G10_TOKEN`), `Idempotency-Key`
  (derivada del viaje y del QR, así un reintento devuelve la respuesta original) y `X-Request-Id`.
- **Control propio:** si la respuesta trae el id de un viaje distinto, se rechaza aunque el M8 diga
  que es válido.
- La ruta se puede cambiar por variable (`M8_G7_RUTA_QR`), porque el código del G7 todavía no usa
  la de su contrato.
- `401`/`403` ya no se toman como "QR inválido" sino como error de configuración (`503` y log de
  error).

### Prueba real con los dos M8 (5/11)

Se levantaron los tres servicios desde sus repos con `demo/integracion-m8/` y se recorrió el
inicio de viaje con QR real. **M6: 5 de 5 verificaciones correctas** (inicio con QR de G7 y de G10,
código falso, QR reusado y QR de otro viaje). Problemas encontrados en los otros grupos:

- **G7 – generar el QR responde siempre `500`.** El atributo `[property: Range(30, 3600)]` sobre
  el parámetro `ValidezSegundos` del `record GenerarQrRequest` hace que ASP.NET rechace el pedido
  (`InvalidOperationException: ... validation metadata must be associated with the constructor
  parameter`). Se arregla cambiándolo por `[Range(30, 3600)]`.
- **G7 – el QR dura minutos en vez de segundos:** `TimeSpan.FromMinutes(validezSegundos)` debería
  ser `FromSeconds`. Con el valor por defecto (600), el QR dura 10 horas.
- **G7 – confirmado en la prueba:** su validación aceptó un QR de otro viaje. M6 lo frenó con su
  control propio.
- **G10 – su imagen Docker no arranca tal como está:** a `node:20-alpine` le falta OpenSSL para
  Prisma, corre con `USER node` sin permiso para preparar Prisma, y no aplica las migraciones
  (`prisma migrate deploy`) antes de iniciar. Con eso corregido, todo su flujo de QR anduvo bien.

### Pendiente de acordar

1. **G7:** arreglar la generación del QR (`500`) y la duración (minutos → segundos).
2. **G7:** alinear el código con su contrato (ruta y `viajeId` en el cuerpo) y verificar que el QR
   pertenezca al viaje **antes** de consumirlo; hoy un QR de otro viaje se consume igual.
3. **G10:** que su imagen Docker arranque sola (OpenSSL, permisos, migraciones).
4. **G7:** recibir nuestros eventos por RabbitMQ (exchange `movilidad.eventos`, routing keys
   `trips.*.*`) en lugar de que M6 les haga `POST`. M6 no tiene emails ni teléfonos para armar
   `destinatarios`; eso lo puede resolver M8 con M2/M3.
5. **G10:** escuchar los cinco eventos de M6 (`trips.trip.created`, `trips.driver.arrived`,
   `trips.trip.started`, `trips.trip.completed`, `trips.trip.cancelled`) y usar el exchange común
   `movilidad.eventos` (o acordar un único nombre entre todos).
6. **Ambos:** el QR dura 300 s (G10) o 600 s (G7); la app tiene que poder regenerarlo si vence
   antes de que llegue el conductor. Lo genera la app del cliente, no un evento de M6.
7. **Consorcio:** cómo obtiene M6 su JWT de servicio de M1.

### Mensaje para el Grupo 7

> Hola, somos el Grupo 5 (M6 – Viajes). Revisamos su repo para integrar el QR de inicio del viaje
> (RF-8.3 y RF-6.4). Ya adaptamos M6 a su contrato: llamamos a `POST /api/v1/qr/validaciones` con
> `{ "token", "viajeId" }`, `Idempotency-Key` y el JWT de servicio, y tomamos `200` como válido y
> `404`/`409`/`422` como inválido. Si no responden en 2 s, M6 devuelve 503 y el viaje queda igual.
>
> Levantamos su M8 desde el repo y lo probamos junto con M6. Encontramos estas cosas:
> 1. **Generar el QR responde siempre `500`**: el `[property: Range(30, 3600)]` en
>    `GenerarQrRequest` hace fallar la validación de ASP.NET con los `record`. Se arregla con
>    `[Range(30, 3600)]`.
> 2. En `QrService.GenerarAsync`, `TimeSpan.FromMinutes(validezSegundos)` debería ser
>    `FromSeconds`: hoy un QR de 600 "segundos" dura 10 horas.
> 3. La validación está en `POST /api/Documentos/qr/validar` y recibe sólo `{ token }`. ¿La pueden
>    pasar a la ruta y el cuerpo del contrato? Mientras tanto la configuramos por variable.
> 4. No se verifica que el QR sea del viaje: lo comprobamos en la prueba, un QR de otro viaje se
>    consume y responde `200`. Sugerimos comparar el `viajeId` antes de consumirlo y responder
>    `422` (como dice su contrato).
>
> La validación en sí anduvo bien con M6. Si quieren reproducirlo, el laboratorio está en nuestro
> repo, en `demo/integracion-m8/`.
>
> Sobre las notificaciones: nosotros publicamos los eventos en RabbitMQ (exchange
> `movilidad.eventos`, tipo topic; routing keys `trips.trip.created`, `trips.driver.arrived`,
> `trips.trip.started`, `trips.trip.completed`, `trips.trip.cancelled`; formato en nuestro
> `docs/catalogo-eventos.md`). ¿Les sirve escucharlos ahí en lugar de que les hagamos `POST
> /api/v1/eventos`? M6 no tiene los datos de contacto que pide `destinatarios`. Pueden llegar
> repetidos: conviene ignorar los `eventId` ya procesados. ¡Gracias!

### Mensaje para el Grupo 10

> Hola, somos el Grupo 5 (M6 – Viajes). Revisamos su repo para integrar el QR de inicio del viaje
> (RF-8.3 y RF-6.4). Ya adaptamos M6 a su contrato: llamamos a `POST /api/v1/documents/qr/verify`
> con exactamente `{ "token", "tripId" }` y tomamos `200 { valid: true }` como válido y
> `400`/`404`/`410` como inválido. Si no responden en 2 s, M6 devuelve 503 y el viaje queda igual.
> Mandamos también `Authorization: Bearer <JWT de servicio>`, `Idempotency-Key` y `X-Request-Id`.
>
> Levantamos su M8 desde el repo y lo probamos junto con M6: generar, validar y rechazar un QR
> reusado anduvo perfecto. Lo único que falló fue su imagen Docker tal como está, que no arranca:
> a `node:20-alpine` le falta OpenSSL para Prisma (`apk add openssl`), el `USER node` no tiene
> permiso para preparar Prisma, y no se corre `prisma migrate deploy` antes de iniciar. El
> laboratorio está en nuestro repo, en `demo/integracion-m8/`, por si les sirve.
>
> Sobre las notificaciones: vimos que escuchan `trip.completed` en `urban_mobility_events`.
> Nosotros publicamos en el exchange `movilidad.eventos` (topic) con las routing keys
> `trips.trip.created`, `trips.driver.arrived`, `trips.trip.started`, `trips.trip.completed` y
> `trips.trip.cancelled` (formato en nuestro `docs/catalogo-eventos.md`). ¿Pueden configurar
> esos nombres y escuchar los cinco? Pueden llegar repetidos: conviene ignorar los `eventId` ya
> procesados.
>
> Una consulta: el QR dura 300 s. ¿La app puede pedir otro si vence antes de que llegue el
> conductor? ¡Gracias!

**Acordado:** _(completar)_

---

## Cátedra: M1, formato del token y aprobación del stack

**Qué necesitamos:**
1. **M1 (Identidad y Acceso):** la tabla de grupos de la consigna no le asigna grupo. Todos los
   módulos validan el token que emite M1, así que hay que saber quién lo hace y con qué formato.
2. **RNF-01:** el stack es "a elección del grupo, *con aprobación* y justificación técnica". La
   justificación está en `docs/decisiones/ADR-001-stack-tecnologico.md`, pero falta la aprobación.
3. **Alcance de cada entrega:** la consigna dice que la cátedra define qué requerimientos entran
   en cada TP.

**Lo que hoy espera M6 del token:**
- JWT con `sub` o `identidad_id` (id del usuario, o nombre del módulo para servicios), el rol en
  `role` (string) o `roles` (lista), y **`exp` obligatorio**. Se aceptan `CLIENT`, `DRIVER`,
  `OPERATOR` y `SYSTEM`, y sus alias `CLIENTE`, `CONDUCTOR`, `OPERADOR`, `SERVICIO` / `SERVICE`
  (igual que el Grupo 12).
- Firma HS256 con secreto compartido (para desarrollo).
- Ya está preparado para exigir `iss` (emisor) y `aud` (audiencia) si se configuran.

**Propuesta si M1 lo implementa un grupo o la cátedra:** firma **RS256** con la clave pública
publicada en un endpoint JWKS, para que los módulos validen sin compartir secretos (RF-1.4), y
tokens de servicio con `role: SYSTEM` para llamadas entre módulos (M5 → M6, M2 → M6).

**Mensaje para la cátedra:**

> Hola, somos el Grupo 5 (M6 – Viajes y Ciclo de Vida). Tenemos tres consultas:
>
> 1. **M1 (Identidad y Acceso):** en la tabla de grupos no figura quién lo implementa. ¿Lo provee
>    la cátedra, o cada grupo lo simula? Nosotros validamos un JWT con `sub` (id del usuario),
>    `role` (`CLIENT`, `DRIVER`, `OPERATOR` o `SYSTEM` para llamadas entre módulos) y `exp`
>    (vencimiento, obligatorio). ¿Hay un formato definido o un proveedor que debamos usar (por
>    ejemplo Keycloak)?
> 2. **Aprobación del stack (RNF-01):** elegimos TypeScript con NestJS 11, PostgreSQL, RabbitMQ y
>    Redis. La justificación está en el ADR-001 de nuestro repositorio. ¿Está aprobado?
> 3. **Alcance de las entregas:** ¿qué requerimientos funcionales y no funcionales entran en el
>    TP1 y en el TP2?
>
> ¡Gracias!

**Acordado:** _(completar)_

---

## M6 – Otra implementación (Grupo 12)

**Qué necesitamos:** M6 tiene dos implementaciones. Para que el equipo integrador pueda usar
cualquiera de las dos, **el contrato debe ser el mismo**: rutas, campos, estados, errores y
eventos.

**Cómo vamos:** comparamos nuestro contrato con el de ustedes (`openapi.yaml` del Grupo 12) y
**ya acercamos nuestro código al suyo** en todo lo que era una diferencia de nombres o de
formato. Lo que queda son diferencias de diseño: ahí proponemos que ustedes se adecúen al nuestro,
salvo los tres puntos de la parte 3, que conviene hablar.

**Para mandarles:** `docs/unificacion-m6-grupo-12.md` cuenta todo esto escrito para ellos, con ejemplos.

Los archivos de referencia de nuestro lado son:
- `contratos/openapi.yaml` (la API) y `contratos/eventos/m6-viajes.asyncapi.yaml` (los eventos);
- `docs/m6/maquina-de-estados.md` (estados, transiciones y reglas) y `docs/catalogo-eventos.md`.

### Parte 1 – Lo que cambiamos nosotros para parecernos a ustedes (ya hecho)

| # | Tema | Antes (Grupo 5) | Ahora (igual que ustedes) |
|---|---|---|---|
| 1 | Rutas | `/viajes`, `/arribo`, `/inicio`, `/finalizacion`, `/cancelacion`, `/historial` | `/trips`, `/arrived`, `/start`, `/complete`, `/cancel`, `/history` |
| 2 | Health | `/salud` → `{ estado: "OK" }` | `/health` → `{ status: "UP", timestamp }` |
| 3 | Estados | `ASIGNADO`, `CONDUCTOR_ARRIBADO`, `EN_CURSO`, `FINALIZADO` | `PENDING_ARRIVAL`, `DRIVER_ARRIVED`, `IN_PROGRESS`, `COMPLETED` |
| 4 | Roles | `CLIENTE`, `CONDUCTOR`, `OPERADOR`, `SERVICIO` (claim `rol`) | `CLIENT`, `DRIVER`, `OPERATOR`, `SYSTEM` (claim `role`) |
| 5 | Nombres de campos | `clienteId`, `conductorId`, `vehiculoId`, `solicitudId`, `estado`, `creadoEn`, `pagina`, `tamanio`, `codigoVerificacion` | `clientId`, `driverId`, `vehicleId`, `requestId`, `state`, `createdAt`, `page`, `pageSize`, `verificationToken` |
| 6 | Ubicaciones | `origen` y `destino` como objetos anidados | `originLatitude`, `originLongitude`, `destinationLatitude`, `destinationLongitude`, tipo `double` |
| 7 | Distancia | `distanciaRecorridaMetros` (entero) | `distanceKm` (decimal, mínimo 0,1) |
| 8 | Viaje | sin `updatedAt` ni `durationMinutes` | `Trip` con `distanceKm`, `durationMinutes` y `updatedAt`; el resumen también trae `durationMinutes` |
| 9 | Crear el viaje | idempotente por `assignmentId`; `409 ACTIVE_TRIP_EXISTS` | idempotente por `requestId`: `201` la primera vez, `200` si repiten con los mismos datos, `409 REQUEST_ID_CONFLICT` si cambian los datos. Eliminamos `assignmentId` |
| 10 | Errores | `{ codigo, detail, … }` con códigos en español | `{ code, message, timestamp, correlationId, … }`; códigos en inglés, por ejemplo `INVALID_STATE_TRANSITION` |
| 11 | Eventos | `ViajeCreado`, `ConductorArribado`, `ViajeIniciado`, `ViajeFinalizado` | `TripCreated`, `DriverArrived`, `TripStarted`, `TripCompleted`; sobre con `eventId`, `eventType`, `occurredAt`, `correlationId`, `payload`; routing keys `trips.trip.completed`, etc. |

Con esto, **un cliente escrito para el contrato de ustedes ya puede consultar un viaje, marcar el
arribo, iniciar con QR y listar viajes en el nuestro** (cambiando solo el host). Para crear (falta
`vehicleType`), finalizar (`durationMinutes`) y cancelar (motivos) hacen falta los pasos de la parte 2.

### Parte 2 – Paso a paso: qué tienen que cambiar ustedes para adecuarse a nuestro contrato

Están ordenados de lo que más importa a lo que menos. Cada paso dice qué hacen hoy ustedes y a qué
pasa a ser.

**Paso 1 – Cancelación: un estado y un evento.**
- Hoy: dos estados (`CANCELLED_BY_CLIENT`, `CANCELLED_BY_DRIVER`) y dos eventos.
- Pasa a ser: un solo estado `CANCELLED` y un solo evento `TripCancelled`. Quién canceló va en
  `cancellation.cancelledBy` (`CLIENT`, `DRIVER` u `OPERATOR`). Ver el punto A de la parte 3.

**Paso 2 – Cancelación: motivos.**
- Hoy: `reason` es un texto libre de 3 a 255 caracteres.
- Pasa a ser: `reason` es uno de estos valores, según el rol, más un `detail` opcional (hasta 500
  caracteres):

  | Rol | Desde | Motivos |
  |---|---|---|
  | `CLIENT` | `PENDING_ARRIVAL`, `DRIVER_ARRIVED` | `CHANGE_OF_PLANS`, `EXCESSIVE_DELAY`, `DRIVER_NO_SHOW`, `OTHER` |
  | `DRIVER` | `PENDING_ARRIVAL`, `DRIVER_ARRIVED` | `CLIENT_NO_SHOW`, `VEHICLE_PROBLEM`, `ORIGIN_UNREACHABLE`, `OTHER` |
  | `OPERATOR` | `PENDING_ARRIVAL`, `DRIVER_ARRIVED`, `IN_PROGRESS` | `SECURITY_INCIDENT`, `ADMINISTRATIVE_BLOCK`, `OTHER` |

  Un motivo que no corresponde al rol responde `422 REASON_NOT_ALLOWED`. `CLIENT_NO_SHOW` solo se
  acepta pasados 5 minutos (configurable) desde el arribo. Si cancela el conductor antes del inicio
  (y no por `CLIENT_NO_SHOW`), el evento lleva `requiresRedispatch: true`.
- Cambia también el operador: en el nuestro puede cancelar un viaje `IN_PROGRESS` (para incidentes).
  En el de ustedes eso queda fuera de alcance.

**Paso 3 – Finalizar el viaje: la duración la calcula M6.**
- Hoy: el conductor manda `distanceKm` y `durationMinutes`.
- Pasa a ser: el conductor manda solo `distanceKm` (más `finalLatitude` y `finalLongitude`,
  opcionales). M6 calcula la duración como `completedAt − startedAt`. Ojo: **nuestro servicio
  rechaza con `400` los campos que no están en el contrato**, así que un cliente que siga mandando
  `durationMinutes` recibiría un error. Si prefieren que lo ignoremos, lo hablamos (parte 3, punto D).

**Paso 4 – Crear el viaje: campos que les faltan.**
- Agregar `vehicleType` (`AUTO` o `MOTO`, obligatorio; antes del 11/11 era `CAR` o `MOTORCYCLE`), `reservationId` (opcional, `uuid` o
  `null`, para M9) y `originAddress` / `destinationAddress` (opcionales, hasta 300 caracteres).
- El `409 REQUEST_ID_CONFLICT` se decide comparando **todos** los datos de creación, incluidos
  estos campos.

**Paso 5 – Respuesta `Trip`: campos que les faltan.**
- `version` (entero, aumenta con cada transición y va también en el header `ETag`), `vehicleType`,
  `reservationId`, `arrivedAt`, `startedAt`, `completedAt`, `cancelledAt`, y los objetos
  `closure` (`distanceKm`, `durationSeconds`, ubicación final) y `cancellation` (`cancelledBy`,
  `reason`, `detail`, `previousState`, `requiresRedispatch`).
- Ya coinciden: `id`, `requestId`, `clientId`, `driverId`, `vehicleId`, las cuatro coordenadas,
  `state`, `distanceKm`, `durationMinutes`, `createdAt` y `updatedAt`.

**Paso 6 – Historial.**
- Hoy: `GET /trips/{id}/history` devuelve un array de `{ id, tripId, state, actorId, actorRole,
  reason, metadata, createdAt }`.
- Pasa a ser: `{ tripId, transitions: [ { sequence, from, to, action, actor: { role, id },
  occurredAt, reason, detail } ] }`, en orden de `sequence`. `action` es `CREATE`,
  `REGISTER_ARRIVAL`, `START`, `COMPLETE` o `CANCEL`. El historial lo ven el cliente y el
  conductor del viaje y el operador; un servicio (`SYSTEM`) recibe `403`.

**Paso 7 – Eventos: broker, sobre y datos.**
- Hoy: los eventos están como esquemas dentro del OpenAPI, sin broker ni routing keys.
- Pasa a ser:
  - RabbitMQ, exchange `movilidad.eventos` (tipo `topic`, durable) y routing keys
    `trips.trip.created`, `trips.driver.arrived`, `trips.trip.started`, `trips.trip.completed` y
    `trips.trip.cancelled`.
  - Sobre: `{ eventId, eventType, eventVersion, occurredAt, producer, correlationId, payload }`. El
    `tripId` va dentro de `payload`, no en el sobre. Propiedades AMQP: `message_id` = `eventId`,
    `correlation_id` = `correlationId`, `type` = `eventType`, persistente.
  - `payload` de todos los eventos: `tripId`, `tripVersion`, `requestId`, `reservationId`,
    `clientId`, `driverId`. Después cada evento agrega lo suyo: ver `docs/catalogo-eventos.md`
    (por ejemplo `TripCompleted` trae `distanceKm` y `durationSeconds`, no minutos).
  - Entrega **al menos una vez** con bandeja de salida (outbox): el evento se guarda en la misma
    transacción que el cambio del viaje y se publica después.
  - Los eventos no llevan coordenadas, direcciones, datos personales ni el QR.

**Paso 8 – Formato de error.**
- Hoy: `{ code, message, correlationId, timestamp }`.
- Pasa a ser: lo mismo más los campos de RFC 9457 `type`, `title`, `status`, `detail` e
  `instance`, con `Content-Type: application/problem+json`. En validación (`400`) se suma `errors:
  [ { field, message } ]`, y en un `409` por transición inválida, `currentState`.
- Códigos que usamos: `VALIDATION`, `UNAUTHENTICATED`, `PAYLOAD_TOO_LARGE`, `FORBIDDEN`,
  `TRIP_NOT_FOUND`, `ROUTE_NOT_FOUND`, `INVALID_STATE_TRANSITION`, `CONCURRENCY_CONFLICT`,
  `REQUEST_ID_CONFLICT`, `REQUEST_IN_PROGRESS`, `PRECONDITION_FAILED`, `INVALID_VERIFICATION_CODE`,
  `REASON_NOT_ALLOWED`, `IDEMPOTENCY_KEY_REUSED`, `TOO_MANY_REQUESTS`, `DEPENDENCY_UNAVAILABLE` e
  `INTERNAL_ERROR`.

**Paso 9 – Cabeceras que ustedes todavía no definen.**
- `X-Correlation-Id`: se propaga a los logs y a los eventos; si no viene, se genera.
- `ETag` en cada respuesta de un viaje y `If-Match` opcional en las acciones (`412
  PRECONDITION_FAILED` si no coincide).
- `Idempotency-Key` opcional en las acciones: repetirla devuelve la misma respuesta con
  `Idempotent-Replayed: true`, sin volver a aplicar la acción.
- Límite de pedidos (`RateLimit-*`; `429` con `Retry-After`) y cuerpos de hasta 16 KB (`413`).

**Paso 10 – Seguridad del token.**
- El JWT debe traer `exp`; sin vencimiento, o vencido, `401`. El claim del rol se llama `role`.

**Paso 11 – Consultas.**
- `GET /trips`: además de `clientId`, `driverId`, `state`, `page` y `pageSize`, aceptamos `from` y
  `to` (fechas de creación) y varios estados separados por coma. `CLIENT` y `DRIVER` solo ven lo
  suyo (se ignora el filtro que manden); `SYSTEM` debe indicar `clientId` o `driverId`.
- El resumen (`TripSummary`) suma `vehicleType`, `originAddress`, `destinationAddress` y
  `completedAt`.
- Un cliente o conductor ajeno que pide `GET /trips/{id}` recibe `404`, no `403`, para no revelar
  que el viaje existe.

**Paso 12 – Health detallado.**
- Además de `/health`, `GET /health/details` informa PostgreSQL, RabbitMQ, Redis y la bandeja de
  eventos, con `status` `OK`, `DEGRADED` o `ERROR` (`503` solo si no responde la base).

**Ya coincide y no hay que tocar:** los estados `PENDING_ARRIVAL`, `DRIVER_ARRIVED`,
`IN_PROGRESS` y `COMPLETED`; las transiciones y los roles que las ejecutan; `verificationToken` y
las respuestas `422` / `503` del inicio con QR; el JWT con `sub` y `role`.

### Parte 3 – Para decidir juntos

A. **Cancelación: ¿uno o dos estados?** Proponemos un solo `CANCELLED` con `cancelledBy` porque
   evita duplicar estados y eventos, y deja lugar para el operador. Si prefieren dos, lo adoptamos
   nosotros, pero entonces hace falta un tercero (`CANCELLED_BY_OPERATOR`).

B. **Dirección base y puerto.** Ustedes publican en `http://localhost:3006/api/v1`. Nosotros, sin
   prefijo de versión y con puerto configurable (3000 por defecto). Propuesta: sin prefijo y puerto
   3006 en el entorno integrado. Si prefieren `/api/v1`, nos adaptamos.

C. **Re-despacho con `requestId` nuevo.** Como una solicitud tiene un único viaje (igual que en el
   contrato de ustedes), cuando un conductor cancela y M5 vuelve a despachar, M5 debe crear el
   viaje nuevo con un `requestId` nuevo. Hay que confirmarlo con M5 (ver su sección).

D. **`durationMinutes` en `POST /trips/{id}/complete`.** Podemos aceptarlo e ignorarlo (calculamos
   nosotros la duración) para que un cliente de ustedes funcione sin cambios. Si les parece, lo
   hacemos.

**Mensaje:**

> Hola Grupo 12, somos el Grupo 5, la otra implementación de M6 (Viajes). Para que el equipo
> integrador pueda usar cualquiera de las dos, comparamos su `openapi.yaml` con el nuestro y
> **ya adecuamos nuestro código al suyo** en lo que eran diferencias de nombres y formato: rutas
> (`/trips`, `/arrived`, `/start`, `/complete`, `/cancel`), estados, roles, campos en inglés,
> coordenadas como cuatro `double`, `distanceKm`, creación idempotente por `requestId` (con `409`
> si cambian los datos), formato de error con `code`, `message` y `timestamp`, y `/health`.
>
> Lo que queda son diferencias de diseño. Les armamos una guía paso a paso con lo que tendrían
> que cambiar ustedes para adecuarse al nuestro: está en `docs/acuerdos-con-otros-grupos.md`
> (sección "M6 – Otra implementación"), con los contratos en `contratos/`. Los más importantes:
> un solo estado `CANCELLED` con motivos por rol, la duración calculada por M6, los eventos por
> RabbitMQ (exchange `movilidad.eventos`) y el formato del historial.
>
> Hay cuatro puntos que preferimos hablar: cancelación en uno o dos estados, `/api/v1` y puerto,
> `durationMinutes` y el re-despacho con `requestId` nuevo. ¿Hacemos una llamada corta o los
> vamos charlando por acá? ¡Gracias!

**Acordado:** _(completar)_

---

## M7 – Tarifas, Pagos y Liquidaciones (Grupos 6 y 11)

**Qué necesitamos:** M7 cobra cuando el viaje termina y decide si corresponde un cargo cuando se
cancela. M6 **no calcula importes**: sólo publica los datos.

**Propuesta:**
- **`TripCompleted`** trae `tripId, requestId, reservationId, clientId, driverId,
  vehicleType, startedAt, completedAt, distanceKm, durationSeconds`. Con eso M7
  calcula el importe final, captura el pago y liquida al conductor.
- **`TripCancelled`** trae `cancelledBy, reason, previousState, createdAt, arrivedAt,
  startedAt, cancelledAt`. Con eso M7 decide si corresponde cargo (RF-7.4), por ejemplo "si
  canceló el cliente después del arribo".
- **`TripStarted`**, si quieren autorizar el pago al inicio.

- **Eventos repetidos:** `TripCompleted` puede llegar más de una vez, por la entrega "al
  menos una vez". M7 **tiene** que ignorar los `eventId` (o los `tripId`) ya cobrados; si no,
  cobraría dos veces (RF-7.6, RNF-09).

**Preguntas abiertas:**
- ¿Les alcanzan esos campos? ¿Necesitan el id de la estimación de tarifa que hizo M5?
- ¿Autorizan el pago al crear el viaje, al iniciarlo o recién al finalizar?

**Mensaje:**

> Hola, somos el Grupo 5 (M6 – Viajes). Para el cobro y los cargos de cancelación, nosotros no
> calculamos importes: publicamos eventos con los datos y ustedes deciden.
> - `TripCompleted` (`trips.trip.completed`): `tripId, clientId, driverId, vehicleType,
>   startedAt, completedAt, distanceKm, durationSeconds`.
> - `TripCancelled` (`trips.trip.cancelled`): `cancelledBy (CLIENT|DRIVER|OPERATOR),
>   reason, previousState, createdAt, arrivedAt, startedAt, cancelledAt`.
> - `TripStarted`, por si autorizan el pago al inicio.
>
> **Importante:** un evento puede llegar repetido (lo garantizamos "al menos una vez" para que
> nunca se pierda). Para no cobrar dos veces, ignoren los `eventId` (o los `tripId`) que ya
> procesaron.
>
> ¿Les alcanza con eso? ¿Necesitan algún dato más, como el id de la estimación de tarifa?
> ¡Gracias!

**Acordado:** _(completar)_

---

## M4 – Ubicación y Disponibilidad (Grupos 3 y 14)

**Qué necesitamos:** cuando un viaje termina o se cancela, el conductor vuelve a estar disponible
(RF-4.4).

**Propuesta:** M4 escucha `TripCompleted` y `TripCancelled` y libera al `driverId`. M6 no
llama a M4.

**Mensaje:**

> Hola, somos el Grupo 5 (M6 – Viajes). Para liberar al conductor cuando termina o se cancela un
> viaje, proponemos que ustedes escuchen nuestros eventos `TripCompleted` y `TripCancelled`
> (traen `driverId`) en vez de que los llamemos. ¿Les sirve así? ¿Quién lo marca como ocupado
> al asignarlo: M5 o ustedes escuchando un evento de M5? ¡Gracias!

**Acordado:** _(completar)_

---

## M2 – Clientes (Grupos 1 y 17)

**Qué necesitamos:**
- RF-2.4: M2 muestra el historial del cliente **consultando nuestra API**, no nuestra base.
- RF-2.5: la calificación sólo se permite tras un viaje completado.

**Propuesta:**
- **Historial:** `GET /trips?clientId=<uuid>&page=1&pageSize=20` con token de servicio, o
  reenviando el token del cliente. Devuelve un resumen paginado.
- **Calificación:** M2 escucha `TripCompleted` para habilitar la calificación, o consulta
  `GET /trips/{id}` y verifica `state = COMPLETED`.

**Mensaje:**

> Hola, somos el Grupo 5 (M6 – Viajes). Para el historial del cliente (RF-2.4) tienen
> `GET /trips?clientId=...&page=1&pageSize=20`, que devuelve un resumen paginado. Pueden
> llamarlo con un token de servicio o con el token del propio cliente. Para habilitar la
> calificación (RF-2.5) pueden escuchar nuestro evento `TripCompleted`, o consultar
> `GET /trips/{id}` y verificar que `state` sea `COMPLETED`. Con token de servicio el límite
> es de 1200 pedidos por minuto; si se pasan, respondemos `429` con `Retry-After`. ¿Les sirve?
> ¡Gracias!

**Acordado:** _(completar)_

---

## M3 – Conductores y Vehículos (Grupos 2 y 15)

**Qué necesitamos:** RF-3.7, la calificación del cliente por parte del conductor tras un viaje
completado. Es el mismo mecanismo que con M2.

**Mensaje:**

> Hola, somos el Grupo 5 (M6 – Viajes). Para que el conductor califique al cliente (RF-3.7)
> pueden escuchar nuestro evento `TripCompleted` (trae `tripId, clientId, driverId`), o
> consultar `GET /trips/{id}` y verificar que el estado sea `COMPLETED`. ¿Les sirve así? ¡Gracias!

**Acordado:** _(completar)_

---

## M9 – Reservas de Viajes (Grupos 8 y 9)

**Qué necesitamos:** una reserva activada termina en una solicitud de M5, que crea un viaje en M6
con `reservationId`. M9 puede querer saber cómo sigue ese viaje.

**Propuesta:** todos nuestros eventos incluyen `reservationId` (o `null`). M9 los escucha y actualiza
la reserva vinculada, por ejemplo marcándola cumplida con `TripCompleted`.

**Mensaje:**

> Hola, somos el Grupo 5 (M6 – Viajes). Cuando una reserva termina generando un viaje, nos llega
> el `reservationId` desde M5, y todos nuestros eventos (`TripCreated`, `TripCompleted`,
> `TripCancelled`, etc.) lo incluyen. Si les sirve, pueden escucharlos para actualizar la reserva.
> ¿Necesitan algo más de nuestro lado? ¡Gracias!

**Acordado:** _(completar)_

---

## Equipo integrador (todos los grupos)

**Qué necesitamos:** la consigna menciona un "equipo integrador" que opera una instancia completa
y acuerda versiones, configuración y datos de demostración. Para el TP2 hay que definir cómo se
levantan los 9 módulos en conjunto.

**Temas a acordar:**

| Tema | Propuesta de M6 |
|---|---|
| Infraestructura | Un RabbitMQ compartido con el exchange `movilidad.eventos`. Cada módulo con **su propia** base de datos (RNF-05); puede ser un mismo servidor PostgreSQL con bases separadas. Redis compartido, con prefijos por módulo (M6 usa `m6:`). |
| Cómo se encuentran | Cada módulo recibe las URLs de los otros por variables de entorno (M6: `M8_G7_URL`, `M8_G10_URL`, `RABBITMQ_URL`, etc.); nada fijo en el código (RNF-06). |
| Puertos | Una tabla con un puerto por módulo, para no chocar: por ejemplo M1 → 3001, …, M6 → 3006, …, M9 → 3009. |
| Credenciales | Secretos fuera del repositorio, en un `.env` compartido por fuera de Git (RNF-06). |
| Imágenes | Cada grupo publica la suya con una versión fija. La de M6 es `ghcr.io/santileconte/m6-viajes:<versión>`. |
| Monitoreo | Cada módulo expone un health check. M6: `GET /health` y `GET /health/details`. |
| Datos de demo | Usuarios, conductores y vehículos de prueba con **los mismos ids** en todos los módulos. |
| Correlación | Todos propagan `X-Correlation-Id` y lo incluyen en sus logs, para seguir un viaje de punta a punta. |

**Mensaje:**

> Hola a todos, somos el Grupo 5 (M6 – Viajes). Para el TP2 vamos a tener que levantar los 9
> módulos juntos. Proponemos acordar:
> - un RabbitMQ compartido (exchange `movilidad.eventos`) y cada módulo con su propia base;
> - una tabla de puertos (por ejemplo M1 → 3001, …, M9 → 3009) y las URLs de los otros módulos
>   por variables de entorno;
> - que cada grupo publique su imagen Docker con una versión fija y exponga un health check
>   (nosotros: `GET /health` y `GET /health/details`);
> - datos de demo con los mismos ids de clientes, conductores y vehículos en todos los módulos.
>
> Si les parece, armamos un `docker-compose` común en un repositorio compartido. ¿Quiénes se
> suman a coordinarlo?

**Acordado:** _(completar)_

