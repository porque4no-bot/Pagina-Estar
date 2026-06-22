# Pruebas en vivo — Pase de desayuno

Guion para validar el sistema de desayuno antes (y después) de encenderlo en producción.

**Marcadores de riesgo:**
- 👁️ **Solo lectura** — seguro, no cambia nada.
- ✍️ **Escribe un registro** — cuenta para la liquidación del mes (úsalo en una reserva que puedas reconciliar).
- 💰 **Toca dinero** — mantener `BREAKFAST_UPGRADE_ENABLED` **apagado** durante las pruebas.

## Antes de empezar

- [ ] Variables en Netlify configuradas: `STAFF_EMAILS` (correos Google del comedor), `ADMIN_EMAILS` (tu correo), `RESEND_API_KEY`, `GUEST_APP_TOKEN_SECRET`, `FIREBASE_*`, `OTASYNC_*`.
- [ ] `BREAKFAST_UPGRADE_ENABLED` **apagado** (para no cargar al folio sin querer).
- [ ] Ten a mano **1 reserva real CON desayuno** y **1 SIN desayuno** (ej. Airbnb).
- [ ] URLs: comedor `…/desayuno` · admin `…/desayuno-admin` · pase del huésped `…/pase-desayuno?t=…` (llega por correo).

---

## A. Familiarización sin riesgo (opcional — en un deploy de *preview* SIN credenciales OTASync = modo demo)
> En modo demo, los códigos `EST-DEMO-2026` (con desayuno) y `EST-AIRBNB-1` (sin) funcionan y los datos son de mentira. Sirve para aprender los paneles sin tocar nada real. En producción esto NO aplica (usa reservas reales).

- [ ] **A1** `/desayuno` → buscar `EST-DEMO-2026` → sale **verde**, "Desayuno incluido · 2 por día".
- [ ] **A2** Marcar servido → contador "1 de 2". Marcar otra vez → "ya estaba servido".
- [ ] **A3** Buscar `EST-AIRBNB-1` → sale **rojo**, "Sin desayuno incluido" + botón "Agregar desayuno".

---

## B. Validación con datos REALES en producción ⭐ (lo más importante)
> Esto valida que el sistema lee bien el desayuno de OTASync — el punto que quedó sin probar con datos reales.

- [ ] **B1** 👁️ **Detección CON desayuno:** `/desayuno` → mete el código de una reserva real **que sí tenga desayuno** → debe salir **verde** "Desayuno incluido · N por día", con N = nº correcto de personas.
- [ ] **B2** 👁️ **Detección SIN desayuno:** mete una reserva real **sin desayuno** (Airbnb) → debe salir **rojo** "Sin desayuno incluido".
- [ ] **B3** ✍️ **Servir:** en la reserva con desayuno → "Marcar servido" → contador sube a "1 de N", la persona queda servida.
- [ ] **B4** ✍️ **Idempotencia:** marca la misma persona otra vez → dice "ya estaba servido hoy", **no** duplica.
- [ ] **B5** ✍️ **Completar:** sirve hasta N → "Todos servidos hoy", desaparece el botón.

> ⚠️ Si B1/B2 fallan (detecta mal el desayuno), **avísame** — es el riesgo #1 que dejé señalado.

---

## C. Pase del huésped (QR + correo)

- [ ] **C1** **Correo:** haz una reserva directa real **con desayuno** (puede ser de prueba) → llega el correo de confirmación con el botón **"Ver mis pases de desayuno"** y el horario "7:00 a 10:00 a. m.". *(Requiere `RESEND_API_KEY`; con PR #105 mergeado llega aunque cierres la pestaña tras pagar.)*
- [ ] **C2** **Página del pase:** abre el link del correo → muestra **un QR por persona** + "Comedor: 7:00 a 10:00 a. m. · ¿antes? avísanos con antelación".
- [ ] **C3** **Escanear:** en `/desayuno`, escanea ese QR (o teclea `CÓDIGO:0`) → abre la reserva y deja servir.

---

## D. Panel de administración (`/desayuno-admin`) — tu correo debe estar en `ADMIN_EMAILS`

- [ ] **D1** 👁️ **Caja (mes):** muestra servidos, incluidos vs upgrades vs cortesías, monto de upgrades, y horarios/días.
- [ ] **D2** 👁️ **Tablero "día de desayunos":** elige una fecha → lo servido ese día **agrupado por reserva** + conteos del día y del ciclo por fuente.
- [ ] **D3** 👁️ **Revisar reserva:** busca una reserva → muestra su derecho + servidos/pendientes de hoy.
- [ ] **D4** ✍️ **Dar cortesía:** en el resultado del lookup → "Dar cortesía (1 desayuno)" → se registra; en la **caja** aparece como **cortesía** y **suma** a "servidos/a liquidar" (pero $0 al huésped).

---

## E. Conteos del comedor (`/desayuno`)

- [ ] **E1** 👁️ Arriba se ven **"servidos hoy"** y **"en el ciclo (mes)"** (sin montos). Suben al marcar servido.

---

## F. Seguridad / accesos

- [ ] **F1** Con un correo del **comedor** (`STAFF_EMAILS`, NO admin): puede abrir `/desayuno`, pero `/desayuno-admin` debe **rechazar** la caja ("Acceso no autorizado"). *(El comedor no ve el dinero.)*
- [ ] **F2** Sin sesión → ambos paneles piden iniciar sesión.

---

## G. Casos borde

- [ ] **G1** Código que no existe → "No encontramos una reserva con ese código".
- [ ] **G2** 💰 **Upgrade apagado:** en una reserva **sin** desayuno → "Agregar desayuno" → debe decir **"no está habilitado"** (mientras `BREAKFAST_UPGRADE_ENABLED` esté apagado **no cobra nada**). Cuando decidas activarlo, repetir esta prueba con cuidado (sí carga al folio).

---

## Qué reportar
1. **B1 y B2** — ¿la detección de desayuno coincide con la realidad de cada reserva? (validación clave)
2. Cualquier panel que se vea roto o un botón que no responda.
3. C1 — ¿llegó el correo con el link del pase?
