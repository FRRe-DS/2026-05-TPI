#!/usr/bin/env bash
# Ejecuta las pruebas de carga de k6 contra M6 (Grupo 5) en entorno local usando Docker.
# Especificación cerrada en k6/PROPUESTA.md.
#
# Uso:
#   JWT_SECRETO=<secreto_min_16_chars> ./k6/correr-local.sh <smoke|serie|limites|individual> [vus]
#
# Variables de entorno:
#   JWT_SECRETO     (obligatoria) Secreto HS256 del servicio local (mínimo 16 caracteres).
#   BASE_URL        (opcional)    Default: http://localhost:3000
#                                 En Windows con Docker Desktop usar http://host.docker.internal:3000
#   JWT_EMISOR      (opcional)    Claim iss esperado, si el entorno lo exige.
#   JWT_AUDIENCIA   (opcional)    Claim aud esperado, si el entorno lo exige.
#   VUS             (opcional)    Solo para modo individual si no se pasa como 2° argumento (default: 50).
#   RAMPA           (opcional)    Solo para modo individual (default: 1m).
#   DURACION        (opcional)    Solo para modo individual (default: 3m).
#   LECTURAS        (opcional)    Porcentaje de lecturas GET sobre viajes completados (default: 20).
#   MODO_ETIQUETA   (opcional)    Permite etiquetar la corrida local sin límites como "local" en individual.
set -euo pipefail

IMAGEN_K6="grafana/k6:0.54.0"
AQUI="$(cd "$(dirname "$0")" && pwd)"
RESULTADOS_DIR="$AQUI/resultados"

uso() {
  cat <<'EOF'
Uso:
  JWT_SECRETO=<secreto_min_16_chars> ./k6/correr-local.sh <modo> [vus]

Modos:
  smoke               2 VUs, rampa 10s, régimen 20s, bajada 20s.
  serie               50, 100, 500 y 1000 VUs secuenciales con 30s de enfriamiento.
  limites             500 VUs con IDs fijos por VU y un solo SYSTEM (alcanza 429).
  individual [vus]    Corrida puntual (default: VUS=50, RAMPA=1m, DURACION=3m).

Ejemplos:
  JWT_SECRETO="secreto-local-de-prueba-1234" ./k6/correr-local.sh smoke
  JWT_SECRETO="secreto-local-de-prueba-1234" ./k6/correr-local.sh individual 100
  JWT_SECRETO="secreto-local-de-prueba-1234" MODO_ETIQUETA=local ./k6/correr-local.sh individual 100
  JWT_SECRETO="secreto-local-de-prueba-1234" ./k6/correr-local.sh limites
  JWT_SECRETO="secreto-local-de-prueba-1234" ./k6/correr-local.sh serie
EOF
}

MODO="${1:-}"
VUS_ARG="${2:-}"

case "$MODO" in
  smoke|serie|limites|individual) ;;
  -h|--help|"")
    uso
    exit 0
    ;;
  *)
    echo "Error: modo inválido '$MODO'. Valores permitidos: smoke, serie, limites, individual." >&2
    uso >&2
    exit 2
    ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker no está instalado o no está en el PATH." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl no está instalado o no está en el PATH (necesario para verificar /health)." >&2
  exit 1
fi

BASE_URL="${BASE_URL:-http://localhost:3000}"
BASE_URL="${BASE_URL%/}"
JWT_SECRETO="${JWT_SECRETO:-}"
JWT_EMISOR="${JWT_EMISOR:-}"
JWT_AUDIENCIA="${JWT_AUDIENCIA:-}"
LECTURAS="${LECTURAS:-20}"

if [ "${#JWT_SECRETO}" -lt 16 ]; then
  cat >&2 <<'EOF'
Error: JWT_SECRETO es obligatorio y debe tener al menos 16 caracteres.
Debe coincidir con el valor configurado en el servicio local de M6 (Grupo 5).
Ejemplo:
  JWT_SECRETO="secreto-local-de-prueba-1234" ./k6/correr-local.sh smoke
EOF
  exit 1
fi

echo ">> Verificando salud del servicio en ${BASE_URL}/health ..."
if ! curl -fsS --max-time 5 "${BASE_URL}/health" >/dev/null; then
  cat >&2 <<EOF

Error: el servicio M6 (Grupo 5) no respondió en ${BASE_URL}/health.

Para levantarlo localmente para el smoke test (sin dependencias externas):
  cd m6-viajes
  JWT_SECRETO="<mismo-secreto-min-16-chars>" \\
  PERSISTENCIA=memoria \\
  PUBLICADOR_EVENTOS=log \\
  IDEMPOTENCIA=memoria \\
  VALIDADOR_QR=simulado \\
  REGISTRO_TARIFA=ninguno \\
  npm run start:dev

Si corrés en Windows con Docker Desktop y localhost no resuelve desde el contenedor, usá:
  BASE_URL="http://host.docker.internal:3000" JWT_SECRETO="..." ./k6/correr-local.sh ${MODO}
EOF
  exit 1
fi
echo ">> Servicio saludable."

mkdir -p "$RESULTADOS_DIR"

export JWT_SECRETO JWT_EMISOR JWT_AUDIENCIA

ejecutar_corrida() {
  local modo_k6="$1"
  local vus="$2"
  local rampa="$3"
  local duracion="$4"
  local etiqueta_modo="${5:-$modo_k6}"

  local timestamp
  timestamp="$(date -u +%Y%m%d-%H%M%S)"
  local test_id="g5-${etiqueta_modo}-${vus}vu-${timestamp}"
  local json_rel="resumen-${test_id}.json"
  local log_abs="${RESULTADOS_DIR}/salida-${test_id}.txt"

  echo "========================================================================"
  echo ">> k6 G05 | modo=${modo_k6} | vus=${vus} | rampa=${rampa} | regimen=${duracion} | lecturas=${LECTURAS}%"
  echo ">> BASE_URL=${BASE_URL} | testid=${test_id}"
  echo "========================================================================"

  local docker_env_args=(
    -e "BASE_URL=${BASE_URL}"
    -e "MODO=${modo_k6}"
    -e "VUS=${vus}"
    -e "RAMPA=${rampa}"
    -e "DURACION=${duracion}"
    -e "BAJADA=20s"
    -e "LECTURAS=${LECTURAS}"
    -e "TEST_ID=${test_id}"
    -e JWT_SECRETO
  )
  if [ -n "$JWT_EMISOR" ]; then
    docker_env_args+=(-e JWT_EMISOR)
  fi
  if [ -n "$JWT_AUDIENCIA" ]; then
    docker_env_args+=(-e JWT_AUDIENCIA)
  fi

  local rc=0
  docker run --rm --network host --user "$(id -u):$(id -g)" \
    -v "${AQUI}/escenarios:/escenarios:ro" \
    -v "${RESULTADOS_DIR}:/resultados" \
    "${docker_env_args[@]}" \
    "${IMAGEN_K6}" run \
      --tag "testid=${test_id}" \
      --tag "grupo=5" \
      --tag "vus=${vus}" \
      --tag "modo=${etiqueta_modo}" \
      --summary-export="/resultados/${json_rel}" \
      /escenarios/ciclo-de-viaje.js 2>&1 | tee "$log_abs" || rc=$?

  echo ">> Resumen JSON : k6/resultados/${json_rel}"
  echo ">> Log consola  : k6/resultados/salida-${test_id}.txt"
  return "$rc"
}

case "$MODO" in
  smoke)
    ejecutar_corrida "smoke" 2 "10s" "20s" "smoke"
    ;;
  limites)
    ejecutar_corrida "limites" 500 "1m" "3m" "limites"
    ;;
  individual)
    VUS_EFECTIVO="${VUS_ARG:-${VUS:-50}}"
    RAMPA_EFECTIVA="${RAMPA:-1m}"
    DURACION_EFECTIVA="${DURACION:-3m}"
    ETIQUETA="${MODO_ETIQUETA:-individual}"
    MODO_SCRIPT="individual"
    if [ "$ETIQUETA" = "local" ]; then
      MODO_SCRIPT="local"
    fi
    ejecutar_corrida "$MODO_SCRIPT" "$VUS_EFECTIVO" "$RAMPA_EFECTIVA" "$DURACION_EFECTIVA" "$ETIQUETA"
    ;;
  serie)
    NIVELES=(50 100 500 1000)
    FALLO_SERIE=0
    for idx in "${!NIVELES[@]}"; do
      vus="${NIVELES[$idx]}"
      rc=0
      ejecutar_corrida "serie" "$vus" "1m" "3m" "serie" || rc=$?
      if [ "$rc" -ne 0 ]; then
        echo "!! Nivel ${vus} VUs finalizó con código ${rc}." >&2
        FALLO_SERIE="$rc"
      fi
      if [ "$idx" -lt $((${#NIVELES[@]} - 1)) ]; then
        echo ">> Enfriamiento de 30s antes del siguiente nivel..."
        sleep 30
      fi
    done
    exit "$FALLO_SERIE"
    ;;
esac
