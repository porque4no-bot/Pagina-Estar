# Pendientes para decidir — guía del socio

> Fecha: 2026-06-22 · Para: dueño de Hotel Estar (MIRADA SAS)
>
> Este documento NO es la lista técnica (esa vive en [`pendientes.md`](pendientes.md)).
> Aquí está lo que **necesita una decisión tuya**, explicado en simple: qué es,
> por qué importa, qué tienes que decidir y qué tener en cuenta. Cada cosa dice
> **quién la hace** (tú / yo / un proveedor). Lo técnico ya está construido y
> probado (PR #114); lo que falta es sobre todo **decidir, validar y encender**.
>
> Cómo leerlo: arranca por la sección **1 (Lanzamiento)** — sin eso, lo demás no
> aplica. Las secciones 2-5 las puedes ir resolviendo de a poco.

---

## 1. Lanzamiento — lo que falta para salir a producción

Esto es el "30% que ve el negocio": no es escribir más código, es **desplegar,
validar con plata real y encender**. Mientras no pase, seguimos en "demo
impecable", no en "producción".

### 1.1 — Mergear y desplegar el trabajo (PR #114)
- **Qué es:** todo lo construido (cifrado de datos, panel /admin, Staff App,
  pagos, etc.) está en una rama, sin publicar. Hay que aprobarlo y desplegarlo.
- **Por qué importa:** nada de lo nuevo está vivo hasta que se despliega.
  Incluye el arreglo del **panel de desayunos que hoy no carga en producción**
  (bloqueo de seguridad CSP — ver `frame-src 'self'`).
- **Qué decides:** ¿mergeas el PR #114 completo, o primero un **hotfix de una
  línea** para que el panel de desayunos cargue ya y revisas el grande con calma?
- **A tener en cuenta:** todo lo nuevo está **apagado por defecto o es aditivo**,
  así que desplegar NO cambia el comportamiento del sitio; solo arregla cosas y
  deja los interruptores listos. Cuanto más se acumule sin desplegar, más grande
  y riesgoso el merge.
- **Quién:** tú apruebas/mergeas · yo preparo y verifico.

### 1.2 — Rotar 3 secretos expuestos
- **Qué es:** durante el trabajo, 3 claves se mostraron en el chat:
  `OTASYNC_TOKEN`, `BLOBS_TOKEN`, `GOOGLE_DRIVE_APPS_SCRIPT_SECRET`.
- **Por qué importa:** una clave que se vio en un chat se considera comprometida;
  hay que generarla de nuevo y reemplazarla en Netlify.
- **Qué decides:** cuándo hacerlo (recomendado: justo al lanzar).
- **A tener en cuenta:** es rápido y no rompe nada (se cambia el valor en Netlify
  y listo). Yo te indico exactamente dónde va cada una.
- **Quién:** tú (las generas y pegas en Netlify) · yo te guío.

### 1.3 — Prueba real de punta a punta
- **Qué es:** hacer **una reserva real con plata** y verificar toda la cadena:
  pago en Wompi → reserva creada en OTASync → PDF/Drive → correo al huésped.
- **Por qué importa:** los tests automáticos simulan los servicios externos.
  Nunca se ha probado una transacción real contra OTASync + Wompi en vivo.
  **Hasta que no exista una reserva real cobrada y confirmada, no estamos
  seguros.**
- **Qué decides:** cuándo, con qué monto/tarjeta (puede ser una reserva tuya
  pequeña que luego reembolsas).
- **A tener en cuenta:** yo verifico los logs/webhook en vivo mientras lo haces.
- **Quién:** tú cobras · yo verifico.

### 1.4 — Encender la observabilidad (alertas)
- **Qué es:** un sistema que avisa cuando algo falla (un cobro sin reserva, un
  cargo que no entró, OTASync caído). Hoy esas fallas son **silenciosas**.
- **Por qué importa:** sin esto, un problema en producción no avisa a nadie hasta
  que el huésped reclama. Además ahora las alertas también quedan como **tareas en
  el panel "Hoy"**, así dependes menos del correo.
- **Qué decides:** a qué correo llegan las alertas (`ALERT_EMAIL`) y prenderlo
  (`ALERT_ENABLED`).
- **A tener en cuenta:** enciéndelo **primero**, antes de prender lo demás, para
  que cualquier problema al activar funciones te avise.
- **Quién:** tú confirmas el correo · yo enciendo.

---

## 2. Encender funciones — una por una, tras validar

Todo lo siguiente está construido y **apagado**. La regla de oro: **prender de a
una**, validar contra un caso real, y recién pasar a la siguiente. Todas se
prenden desde **/admin → Configuración** (sin tocar Netlify, sin redeploy).

### 2.1 — Cancelación automática en OTASync
- **Qué es:** cuando apruebas o deniegas una cancelación en el panel de
  Reembolsos, la reserva se marca **cancelada en OTASync** y libera el cuarto.
- **Por qué importa:** hoy, una cancelación se registra pero **la reserva sigue
  ocupando inventario** hasta que alguien la borre a mano (riesgo de perder una
  reventa o sobrevender frente a Booking/Airbnb).
- **Qué decides:** prender `OTASYNC_AUTO_CANCEL_ENABLED` — **después** de probar
  con una reserva real que la cancelación se aplica bien.
- **A tener en cuenta:** marca la reserva como cancelada (no la borra), así
  conservas el registro para contabilidad/SIRE.
- **Quién:** tú decides/validas · yo acompaño la prueba.

### 2.2 — Cargar pedidos del huésped a la cuenta (folio)
- **Qué es:** que los pedidos "cargar a mi cuenta" del guest app se sumen al
  folio de la reserva en Kunas para cobrarse al check-out.
- **Por qué importa:** sin esto, si el huésped pide servicios "a la cuenta" y el
  check-out es automático, **se podría ir sin pagarlos**. Ya hay alerta + botón de
  "Reintentar folio" en el panel para cuando falle.
- **Qué decides:** prender `GUEST_SERVICE_FOLIO_ENABLED`; y si prefieres que los
  servicios se paguen **en línea** (Wompi/MP) en vez de a la cuenta.
- **A tener en cuenta:** necesita que OTASync acepte cargos al folio (validar con
  una reserva real).
- **Quién:** tú decides el modo · yo valido el cargo.

### 2.3 — ¿Mercado Pago se queda como respaldo?
- **Qué es:** hoy cobras con **Wompi**. Mercado Pago está listo como "plan B"
  (rollback) y ya quedó tan robusto como Wompi.
- **Por qué importa:** no hay que hacer nada hoy; solo saber que si algún día
  cambias a MP, está blindado (no duplica reservas, no pierde pagos).
- **Qué decides:** mantener Wompi como único, o tener MP como respaldo activable.
- **A tener en cuenta:** si lo activas, prueba en el sandbox de MP primero
  (`MP_DIRECT_RESILIENT_ENABLED`).
- **Quién:** tú · yo si hay que cambiar.

---

## 3. Decisiones de negocio que destraban funciones

### 3.1 — Tarifas reales Estricta / Flexible en OTASync
- **Qué es:** dos planes por reserva — **Estricta** (precio base, reembolso 100 %
  hasta 7 días antes) y **Flexible** (+10 %, hasta 24 h antes).
- **Por qué importa:** hoy el **+10 % se calcula en la página**, no es una tarifa
  real en OTASync. Para que el PMS y el sitio cuadren al 100 %, alguien debe crear
  esas tarifas en OTASync.
- **Qué decides:** **quién crea los dos planes** en OTASync (tú, el equipo, o
  defines que el +10 % se quede calculado por el sitio).
- **A tener en cuenta:** las tarifas base de respaldo del sitio son Clásica
  \$165k · Selección \$265k · Reserva \$205k · Origen \$265k · Especial \$195k
  (con IVA); deben coincidir con OTASync. El revenue management lo maneja PriceLabs
  (lo configuras tú).
- **Quién:** tú / equipo de OTASync.

### 3.2 — Bot de WhatsApp: cómo se entrega a un humano
- **Qué es:** el bot (con IA) ya está construido pero **inactivo**. Falta decidir
  cómo se "pasa la conversación a una persona" cuando el bot no alcanza.
- **Por qué importa:** sin definir el handoff, el bot puede dejar a un cliente
  colgado. La app de Meta ya está creada y la API activa.
- **Qué decides (3 cosas):**
  1. **Modelo de atención humana:** ¿bandeja de Meta (opción B) o además "toma de
     control" para silenciar el bot cuando entra una persona (opción B+C, requiere
     desarrollo)?
  2. **Horario** en que atiende el bot vs. una persona.
  3. **Correo de escalamiento** donde caen las conversaciones que necesitan humano.
- **A tener en cuenta:** falta cargar en Netlify `WHATSAPP_*` + `ANTHROPIC_API_KEY`
  y prender `WHATSAPP_BOT_ENABLED`. El árbol de respuestas ya está en
  `docs/whatsapp-arbol-respuestas.md`.
- **Quién:** tú decides el modelo/horario/correo · yo lo cableo.

### 3.3 — Primera campaña de marketing + cupones
- **Qué es:** el motor de cupones de descuento ya está construido (apagado).
- **Por qué importa:** la 1ª campaña propuesta es **re-consentir ~87 contactos
  históricos** ofreciéndoles un cupón (por WhatsApp, no SMS) para poder volver a
  escribirles legalmente (Ley 1581).
- **Qué decides:** si lanzamos esa campaña, qué cupón/descuento, y bloquear
  códigos en temporada alta.
- **A tener en cuenta:** el plan está en `docs/plan-marketing-descuentos.md`. El
  descuento se valida en el servidor (no se puede hacer trampa con el monto).
- **Quién:** tú defines campaña/cupón · yo cargo los códigos en /admin.

### 3.4 — Cerraduras TTLock (códigos de acceso por estadía)
- **Qué es:** generar un código de puerta temporal por reserva y enviarlo en el
  correo. Construido pero **apagado**.
- **Por qué importa:** automatiza el acceso sin recepción (encaja con "100 %
  digital"). Confirmaste que **todas las cerraduras funcionan**.
- **Qué decides:** si lo activamos; para hacerlo hay que cargar las credenciales
  de la cuenta TTLock (`TTLOCK_*`).
- **A tener en cuenta:** el correo de códigos de acceso ya está diseñado; solo
  falta conectar las credenciales. Sin ellas, no rompe nada (queda inactivo).
- **Quién:** tú cargas credenciales · yo dejo todo listo.

### 3.5 — Redirección del dominio antiguo (hotelestar.com)
- **Qué es:** que `hotelestar.com` (el dominio viejo) **redirija** al dominio
  actual del sitio, para que quien entre por la dirección antigua —o por enlaces y
  resultados de buscadores viejos— llegue al sitio nuevo.
- **Por qué importa:** **SEO** (no perder el posicionamiento ni los enlaces que
  apuntan al dominio viejo) y no perder clientes que tengan guardada la dirección
  antigua. Sin redirección, `hotelestar.com` queda muerto o mostrando contenido
  desactualizado.
- **Qué decides (2 cosas):**
  1. **¿Controlas el DNS de hotelestar.com?** Hay que apuntarlo a Netlify
     (agregarlo como dominio en el proyecto). Si el dominio lo tiene otro proveedor,
     necesito que me des acceso o que hagas el cambio de DNS.
  2. **Tipo de redirección:** "todo a la home" (simple) o **mapear las URLs viejas
     a sus equivalentes nuevas** (mejor para SEO si esas páginas estaban indexadas
     en Google).
- **A tener en cuenta:** se hace con **redirección 301 (permanente)** para que
  Google transfiera el posicionamiento al dominio nuevo (parece ser
  `estar.com.co`). Si quieres el mapeo de URLs, necesito la lista de las
  direcciones viejas relevantes (o las reviso en Google Search Console).
- **Quién:** tú das acceso/control del DNS de hotelestar.com · yo configuro la
  redirección 301 en Netlify.

---

## 4. Confiabilidad y operación (recomendado antes de escalar)

### 4.1 — Respaldo de los datos (backup)
- **Qué es:** las cotizaciones, reembolsos, check-ins (PII cifrada) y desayunos
  viven **solo** en Netlify Blobs. Hay una función de respaldo construida, apagada.
- **Por qué importa:** si se corrompe o se pierde ese almacenamiento, no hay copia.
- **Qué decides:** prender el respaldo (`BACKUP_ENABLED`). Para respaldar a Google
  Drive (`BACKUP_TO_DRIVE`) hace falta una credencial de cuenta de servicio.
- **A tener en cuenta:** es barato y de bajo riesgo; conviene tenerlo antes de
  acumular muchas reservas reales.
- **Quién:** tú decides · yo enciendo.

### 4.2 — Staff App v3 (automatizar la cola de tareas)
- **Qué es:** hoy el panel "Hoy" ya muestra llegadas/salidas/en-casa + tareas, y
  el reintento de folio es **manual** (un botón). La v3 sería un proceso que
  **reintenta solo** y recalcula desayuno/accesos cuando se cambian fechas.
- **Por qué importa:** para una recepción de una persona, el botón manual alcanza;
  cuando crezca el volumen (o el hotel de Medellín), conviene automatizar.
- **Qué decides:** si lo priorizamos ahora o más adelante.
- **A tener en cuenta:** no es urgente; el flujo manual ya cubre el día a día.
- **Quién:** decisión de prioridad tuya · construcción mía.

---

## 5. Contenido y terceros que dependen de ti

Esto **no lo puedo hacer yo** — necesito que tú lo consigas o lo decidas.

| Pendiente | Qué necesito de ti | Para qué |
|---|---|---|
| **RUT / Cámara de Comercio** | Los documentos/datos | Completar identidad legal y trámites |
| **Plantilla Bancolombia (pagos masivos)** | El formato del banco | Automatizar reembolsos por transferencia (hoy manual) |
| **Odoo Fases 5-6** | Contenido: inventario/costos, plantillas de contrato, material de capacitación | Activar inventario, contratos y eLearning en Odoo |
| **Facturación electrónica (Odoo/DIAN)** | Coordinar con el otro equipo | Está **fuera de mi alcance** (lo maneja el otro proveedor) |

---

## 5.5 Pendientes nuevos — ronda del bot de WhatsApp (2026-06-24)

Surgieron al completar la base de conocimiento del bot ([`bot-conocimiento.md`](bot-conocimiento.md)).

### 5.5.1 — ⚠️ Decisión de plata: early check-in ¿25% o 35%?
- **Qué pasa:** dijiste que el early check-in es **25%** de la tarifa, pero el
  **código del motor y del guest app hoy cobra 35%** (`_services-catalog.js`,
  `_pricing.js`). El bot diría 25% y el sitio cobraría 35% → descuadre.
- **Qué decides:** confirmar el **25%**. Si es así, yo lo cambio en el motor,
  el guest app, los textos y la verificación de monto (deben quedar iguales).
- **A tener en cuenta:** es un cambio de precio; lo hago solo con tu confirmación.
- **Quién:** tú confirmas el % · yo lo aplico en todo el sistema.

### 5.5.2 — Menú de desayuno (contenido tuyo)
- El bot/sitio necesitan el **menú y qué incluye** el desayuno. Me lo envías y lo
  agrego a la base de conocimiento.

### 5.5.3 — Servicio/amenidad faltante (contenido tuyo)
- Mencionaste un punto del listado (§5.6) que te faltaba enviar. Cuando lo tengas,
  lo agrego.

### 5.5.4 — Escalamiento del bot por LLAMADA (build)
- **Qué es:** que el bot, fuera de horario o ante una alarma, **llame** a un
  responsable ("huésped requiere atención") y, si no contestan en ~10 min, **llame
  a los dueños**, con historial y resumen.
- **Estado:** números de **dueños listos** (+57 305 746 5544 / +57 316 329 2157).
  Faltan: el **primer responsable/recepción** (a quién se llama primero) y luz
  verde para integrar un **servicio de telefonía** (ej. Twilio). Hoy el bot solo
  manda correo.
- **Quién:** tú das el número de recepción + decisión de telefonía · yo integro.

### 5.5.5 — Solicitud de cambio de facturación (build)
- **Qué es:** un **formulario en la web** para pedir factura a nombre de empresa/
  tercero o una **nota crédito** si ya se emitió al titular, con un **filtro de
  seguridad** (no permitir pedir un cambio sobre la misma factura más de una vez
  de forma autónoma).
- **Quién:** lo construyo yo · tú confirmas la regla del filtro.

---

## 6. Técnicos menores (informativo — los resuelvo yo)

No necesitan decisión tuya; los dejo anotados para que sepas que existen:

- **Reembolso por Mercado Pago "parcialmente ciego":** al reembolsar por MP falta
  el dato de los últimos 4 dígitos/código de autorización. Solo importa si usas MP
  (hoy = Wompi). Lo completo cuando se priorice MP.
- **Recalcular desayuno/accesos al cambiar fechas en OTASync** (parte de la v3).
- Pequeños afinamientos del motor de cupones (uso por correo, restituir cupón al
  reembolsar).

---

## Resumen: el orden que recomiendo

1. **Desplegar** (mergear PR #114 o el hotfix del panel de desayunos). *(§1.1)*
2. **Rotar los 3 secretos.** *(§1.2)*
3. **Encender alertas.** *(§1.4)*
4. **Prueba real de una reserva con plata** + verificar. *(§1.3)*
5. **Prender funciones de a una** validando cada una. *(§2)*
6. Ir resolviendo las **decisiones de negocio** (tarifas, WhatsApp, marketing,
   cerraduras, **redirección de hotelestar.com**) a tu ritmo. *(§3)*
7. **Backup** y, cuando crezca el volumen, la **automatización v3**. *(§4)*

Documentos de apoyo: [`auditoria-mesa-redonda.md`](auditoria-mesa-redonda.md)
(diagnóstico + roadmap técnico), [`estado-full-4k.md`](estado-full-4k.md) (estado
detallado), [`pendientes.md`](pendientes.md) (lista técnica completa).
