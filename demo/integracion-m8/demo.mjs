#!/usr/bin/env node
/**
 * Demo de integración M6 + M8 (Grupos 7 y 10): inicio de viaje con un QR real.
 *
 * Requiere el laboratorio levantado (ver README.md de esta carpeta):
 *   docker compose up -d --build --wait
 *   node demo.mjs              (abre las imágenes de los QR al generarlas)
 *   node demo.mjs --sin-abrir  (no abre nada; útil para correrlo en CI o por SSH)
 *
 * No usa dependencias: sólo Node 22 (fetch y crypto).
 */
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { exec, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const M6 = process.env.M6_URL ?? 'http://localhost:3006';
const G7 = process.env.G7_URL ?? 'http://localhost:8088';
const G10 = process.env.G10_URL ?? 'http://localhost:3010';
const SECRETO = process.env.JWT_SECRETO ?? 'secreto-del-laboratorio-0123456789';
const ABRIR = !process.argv.includes('--sin-abrir');
const CARPETA = dirname(fileURLToPath(import.meta.url));
const SALIDA = join(CARPETA, 'salida');

// ---------- presentación ----------
const c = { verde: '\x1b[32m', rojo: '\x1b[31m', gris: '\x1b[90m', neg: '\x1b[1m', cian: '\x1b[36m', fin: '\x1b[0m' };
const titulo = (t) => console.log(`\n${c.neg}${c.cian}━━ ${t} ━━${c.fin}`);
const paso = (t) => console.log(`${c.neg}▶ ${t}${c.fin}`);
const detalle = (t) => console.log(`${c.gris}    ${t}${c.fin}`);
const resultados = [];
/** `de`: a quién corresponde lo verificado (M6, G7 o G10), para separar el resumen. */
function verificar(nombre, ok, info = '', de = 'M6') {
  resultados.push({ nombre, ok, info, de });
  console.log(`  ${ok ? `${c.verde}✔` : `${c.rojo}✘`} ${nombre}${c.fin}${info ? `${c.gris}  (${info})${c.fin}` : ''}`);
}

// ---------- utilidades ----------
function jwt(role, sub) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const ahora = Math.floor(Date.now() / 1000);
  const cuerpo = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role, iat: ahora, exp: ahora + 3600 })}`;
  return `${cuerpo}.${createHmac('sha256', SECRETO).update(cuerpo).digest('base64url')}`;
}

async function llamar(metodo, url, { token, cuerpo } = {}) {
  const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() };
  if (token) headers.Authorization = `Bearer ${token}`;
  detalle(`${metodo} ${url}${cuerpo ? ' ' + JSON.stringify(cuerpo) : ''}`);
  try {
    const r = await fetch(url, { method: metodo, headers, body: cuerpo ? JSON.stringify(cuerpo) : undefined, signal: AbortSignal.timeout(10000) });
    const texto = await r.text();
    let datos;
    try { datos = JSON.parse(texto); } catch { datos = texto; }
    detalle(`← ${r.status} ${resumir(datos)}`);
    return { status: r.status, datos };
  } catch (e) {
    detalle(`← sin respuesta: ${e.message}`);
    return { status: 0, datos: null };
  }
}

/** Acorta los campos largos (las imágenes en base64) para que la salida se pueda leer. */
function resumir(datos) {
  const s = JSON.stringify(datos, (k, v) => (typeof v === 'string' && v.length > 80 ? `${v.slice(0, 40)}…(${v.length} caracteres)` : v));
  return s && s.length > 300 ? s.slice(0, 300) + '…' : s;
}

function guardarImagen(nombre, base64) {
  if (!base64) return;
  mkdirSync(SALIDA, { recursive: true });
  const ruta = join(SALIDA, nombre);
  writeFileSync(ruta, Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ''), 'base64'));
  detalle(`imagen del QR guardada en ${ruta}`);
  if (ABRIR) {
    const cmd = process.platform === 'win32' ? `start "" "${ruta}"` : process.platform === 'darwin' ? `open "${ruta}"` : `xdg-open "${ruta}"`;
    exec(cmd);
  }
}

// ---------- actores ----------
const M5 = jwt('SYSTEM', 'm5-despacho');

async function crearViajeConConductorArribado() {
  const ids = { requestId: randomUUID(), clientId: randomUUID(), driverId: randomUUID(), vehicleId: randomUUID() };
  const creado = await llamar('POST', `${M6}/trips`, {
    token: M5,
    cuerpo: {
      ...ids,
      vehicleType: 'AUTO',
      originLatitude: -27.4512, originLongitude: -58.9867, originAddress: 'Av. 9 de Julio 1000, Resistencia',
      destinationLatitude: -27.4692, destinationLongitude: -58.8306, destinationAddress: 'Av. 3 de Abril 500, Corrientes',
    },
  });
  if (creado.status !== 201) throw new Error(`M6 no creó el viaje (status ${creado.status})`);
  const viaje = { id: creado.datos.id, ...ids, conductor: jwt('DRIVER', ids.driverId) };
  await llamar('POST', `${M6}/trips/${viaje.id}/arrived`, { token: viaje.conductor });
  return viaje;
}

async function generarQrG7(viaje, archivo) {
  const r = await llamar('POST', `${G7}/api/v1/viajes/${viaje.id}/qr`, { cuerpo: { clienteId: viaje.clientId, validezSegundos: 600 } });
  if (r.status === 201) {
    guardarImagen(archivo, r.datos?.imagenPng);
    return { token: r.datos?.token, real: true };
  }
  // Hoy su generación responde 500 (ver docs/acuerdos-con-otros-grupos.md, sección M8). Para poder
  // probar igual su VALIDACIÓN, que es la que usa M6, se guarda el QR en su Redis exactamente como
  // lo hace su QrService.GenerarAsync: qr:token:<SHA-256 en hex mayúsculas> → viajeId.
  console.log(`${c.rojo}    El M8 del G7 no pudo generar el QR (error en su código).${c.fin}`);
  console.log(`${c.rojo}    QR armado por la demo con el mismo formato que usa su código, para probar su validación.${c.fin}`);
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex').toUpperCase();
  const redis = (args) => execFileSync('docker', ['compose', 'exec', '-T', 'g7-redis', 'redis-cli', ...args], { cwd: CARPETA });
  redis(['SET', `qr:token:${hash}`, viaje.id, 'EX', '600']);
  redis(['SET', `qr:viaje:${viaje.id}`, hash, 'EX', '600']);
  detalle(`token guardado en el Redis del G7: ${token.slice(0, 12)}…`);
  return { token, real: false };
}

async function generarQrG10(viaje, archivo) {
  // Ruta del contrato coordinado G7 + G10 (la misma que el G7).
  const r = await llamar('POST', `${G10}/api/v1/viajes/${viaje.id}/qr`, { cuerpo: { clienteId: viaje.clientId, validezSegundos: 300 } });
  guardarImagen(archivo, r.datos?.imagenPng ?? r.datos?.qrDataUrl);
  return r.datos?.token;
}

const iniciar = (viaje, codigo) => llamar('POST', `${M6}/trips/${viaje.id}/start`, { token: viaje.conductor, cuerpo: { verificationToken: codigo } });

// ---------- demo ----------
async function main() {
  titulo('0. ¿Están los tres servicios levantados?');
  for (const [nombre, url] of [['M6 (Grupo 5)', `${M6}/health`], ['M8 Grupo 7', `${G7}/swagger/v1/swagger.json`], ['M8 Grupo 10', `${G10}/api/v1/health`]]) {
    const r = await llamar('GET', url);
    verificar(`${nombre} responde`, r.status === 200, '', 'entorno');
  }
  if (resultados.some((r) => !r.ok)) {
    console.log(`\n${c.rojo}Falta algún servicio. Levantá el laboratorio con: docker compose up -d --build --wait${c.fin}`);
    process.exit(1);
  }

  titulo('1. Viaje con QR del Grupo 7');
  paso('M5 crea el viaje en M6 y el conductor avisa que llegó');
  const v1 = await crearViajeConConductorArribado();
  paso('La app del cliente le pide el QR al M8 del Grupo 7');
  const g7 = await generarQrG7(v1, 'qr-grupo-7.png');
  const qr1 = g7.token;
  verificar('El M8 del G7 genera el QR', g7.real, g7.real ? '' : 'responde 500; el QR lo armó la demo', 'G7');
  paso('El conductor escanea un código falso');
  verificar('M6 lo rechaza con 422', (await iniciar(v1, 'codigo-falso')).status === 422);
  paso('El conductor escanea el QR real');
  const r1 = await iniciar(v1, qr1);
  verificar('M6 inicia el viaje (IN_PROGRESS)', r1.status === 200 && r1.datos?.state === 'IN_PROGRESS', `estado: ${r1.datos?.state}`);

  titulo('2. Viaje con QR del Grupo 10');
  paso('M5 crea el viaje en M6 y el conductor avisa que llegó');
  const v2 = await crearViajeConConductorArribado();
  paso('La app del cliente le pide el QR al M8 del Grupo 10');
  const qr2 = await generarQrG10(v2, 'qr-grupo-10.png');
  verificar('El M8 del G10 genera el QR', Boolean(qr2), '', 'G10');
  paso('El conductor escanea el QR real');
  const r2 = await iniciar(v2, qr2);
  verificar('M6 inicia el viaje (IN_PROGRESS)', r2.status === 200 && r2.datos?.state === 'IN_PROGRESS', `estado: ${r2.datos?.state}`);

  titulo('3. Un QR es de un solo uso');
  paso('Se intenta usar el mismo QR del G10 en otro viaje');
  const v3 = await crearViajeConConductorArribado();
  verificar('M6 lo rechaza con 422', (await iniciar(v3, qr2)).status === 422);

  titulo('4. Un QR no sirve para otro viaje');
  paso('Se genera un QR del G7 para el viaje A y se escanea en el viaje B');
  const vA = await crearViajeConConductorArribado();
  const vB = await crearViajeConConductorArribado();
  const qrA = (await generarQrG7(vA, 'qr-grupo-7-viaje-A.png')).token;
  verificar('M6 lo rechaza con 422 (control propio: el G7 no lo verifica)', (await iniciar(vB, qrA)).status === 422);

  titulo('Resumen');
  const deM6 = resultados.filter((r) => r.de === 'M6');
  const okM6 = deM6.filter((r) => r.ok).length;
  console.log(`${okM6 === deM6.length ? c.verde : c.rojo}${c.neg}M6: ${okM6} de ${deM6.length} verificaciones correctas${c.fin}`);
  const ajenos = resultados.filter((r) => (r.de === 'G7' || r.de === 'G10') && !r.ok);
  if (ajenos.length > 0) {
    console.log(`${c.rojo}${c.neg}Problemas encontrados en otros grupos:${c.fin}`);
    for (const r of ajenos) console.log(`${c.rojo}  ✘ [${r.de}] ${r.nombre}${r.info ? ` (${r.info})` : ''}${c.fin}`);
  } else {
    console.log(`${c.verde}Los M8 de los grupos 7 y 10 respondieron bien en todos los pasos${c.fin}`);
  }
  console.log(`${c.gris}Imágenes de los QR en: ${SALIDA}${c.fin}`);
  process.exit(okM6 === deM6.length ? 0 : 1);
}

main().catch((e) => {
  console.error(`${c.rojo}${e.message}${c.fin}`);
  process.exit(1);
});
