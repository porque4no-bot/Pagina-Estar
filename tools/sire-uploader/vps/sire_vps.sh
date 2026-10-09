#!/usr/bin/env bash
# sire_vps.sh — La subida diaria al SIRE (Migracion Colombia) del Hotel Estar.
#
# La lanza vault-sire.service como el usuario `vault`. Hace lo mismo que
# ingesta_vps.sh: marca de inicio, la pasada con `python -u` y marca de fin con
# el codigo. **La senal fiable es la linea `---- fin, codigo N ----` de ese dia
# en `90 - Datos/sire.log`**, no que el temporizador exista.
#
# A mano (como vault):  bash "/opt/vault/99 - Herramientas/vps/sire_vps.sh" --ensayo
# Sin argumentos hace --subir.
set -u
# El archivo de SIRE lleva datos personales de huespedes: nada legible para
# otros usuarios del sistema.
umask 077
V=/opt/vault
LOG="$V/90 - Datos/sire.log"
PY="$V/.venv-ingesta/bin/python"
ENVF="$V/99 - Herramientas/vps/ingesta.env"

# Del entorno de la ingesta solo hace falta el rele de correo de la alarma
# (VAULT_SMTP). Se lee en una subcapa para no heredar las demas credenciales.
VAULT_SMTP=$( set -a; . "$ENVF" >/dev/null 2>&1; printf '%s' "${VAULT_SMTP:-}" )
export VAULT_SMTP
# Mismo destinatario que la alarma de la ingesta.
: "${SIRE_AVISO_A:=rafael.castano@grupopinao.com}"
export SIRE_AVISO_A
export SIRE_LOG="$LOG"
export TZ=America/Bogota

cd "$V" || exit 1
[ $# -ge 1 ] || set -- --subir

echo "---- $(date '+%d/%m/%Y %H:%M:%S') sire $* ----" >> "$LOG"
"$PY" -u "$V/99 - Herramientas/sire/subir_sire.py" "$@" >> "$LOG" 2>&1
RC=$?
echo "---- fin, codigo $RC ----" >> "$LOG"
exit "$RC"
