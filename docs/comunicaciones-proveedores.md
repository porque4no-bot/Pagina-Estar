# Borradores de comunicación a proveedores — facturación y SIRE/TRA

> Fecha: 2026-06-30 · Contexto: decisión de usar NUESTRA guest app como check-in
> oficial → SIRE/TRA lo resolvemos nosotros; y arrancar facturación por la API de
> Numera con panel de aprobación. Ver `plan-facturacion-numera.md` y `preguntas-numera.md`.

---

## 1. Correo a Kunas / OTASync (Ricardo Lombana — ricardo.lombana@kunas.io)

**Asunto:** Hotel Estar (prop. 9889) — Check-in propio + seguir usando su SIRE/TRA por API

Hola Ricardo, ¿cómo vas? Gracias por responderme lo del otro correo.

Te escribo para contarte lo que estamos armando y pedirte una orientación. Estamos
desarrollando **nuestra propia app de check-in**, más completa que la actual (captura
guiada del documento con foto, tipo de documento, nacionalidad, fecha de nacimiento,
procedencia, destino, motivo de viaje…). La idea es que **los huéspedes hagan el check-in
en nuestra app en vez de la de ustedes**.

Lo único que no queremos perder es su **reporte automático a SIRE y TRA**, que ya funciona
muy bien. Nos encantaría **seguir usándolo, pero alimentándolo desde nuestra app por un
endpoint**: nosotros capturamos los datos → se los mandamos por API → ustedes reportan a
SIRE y TRA como hoy. Así mejoramos el check-in sin perder el cumplimiento.

Te dejo las dudas concretas:

**1) ¿Podemos alimentar su reporte SIRE/TRA por API desde nuestra app?**
Vimos el endpoint `guests/edit/guest`, pero no acepta número ni tipo de documento, ni
nacionalidad/procedencia/destino — justo lo que SIRE y TRA necesitan. ¿Existe otro punto
por donde podamos enviarles el **check-in completo de cada huésped** de forma que
**dispare el reporte**?
- Si existe: ¿cuál es, qué campos son obligatorios para cada reporte, y qué marca el
  "check-in completo" que lo activa?
- Si no existe (solo se reporta con la app de ustedes): confírmanoslo con confianza y
  nosotros lo gestionamos por nuestra cuenta.

**2) Multi-ocupante.** Una reserva tiene varios huéspedes, cada uno con su documento.
¿Cómo se registran los N huéspedes por API y cómo sabemos que todos completaron el
check-in (no solo el titular)?

**3) Lectura por API.** ¿Podemos leer las reservas (`reservation/data/reservations`) y los
huéspedes (`guests/data/guests`) de la propiedad 9889, de todos los canales (web, OTAs y
manuales)? Es para nuestro panel/facturación.

**4) Seguridad del webhook.** El secreto hoy solo va por la URL (y queda en logs). ¿Se
puede enviar por una cabecera? Si no, ¿nos ayudas a rotarlo y nos dices la mejor forma de
asegurarlo?

Mil gracias, Ricardo. Cualquier cosa quedamos atentos.

---

## 2. Mensaje de WhatsApp a Numera (facturación electrónica)

Hola, equipo Numera 👋 Somos Hotel Estar (MIRADA SAS, company 5 en Odoo). Vamos a integrar
la **facturación por su API** (`send-electronic-invoice`), con un panel donde aprobamos y
verificamos antes de emitir. Nos quedan unas dudas clave:

1. **Consecutivo:** la API recibe prefijo + consecutivo. ¿Lo **asigna Numera** o lo
   **enviamos nosotros**? Si lo enviamos, ¿nos dan un **prefijo/rango DIAN propio para
   ventas web**, separado del de contabilidad, para no romper la secuencia?
2. **company_id + pruebas:** ¿cuál es el `company_id` de Mirada? ¿Hay **ambiente de
   pruebas (sandbox)** con credenciales de prueba?
3. **Respuesta de la API:** el éxito llega como `sent_to_btw` con `response` vacío. ¿Cómo
   obtenemos el **número legal de la factura + CUFE + PDF**? ¿Hay endpoint de consulta o
   webhook de resultado?
4. **DIAN:** ¿cómo sabemos si la DIAN la **aceptó o rechazó** (no solo "enviada")?
5. **Odoo:** ¿llamar la API **ya crea la factura en Odoo**? ¿Es idempotente y **no
   duplica el cliente** (res.partner) por NIT/email?
6. **Turista extranjero exento de IVA:** ¿cómo se representa en el payload?
7. **Nota crédito:** para `CreditNoteType`, ¿dónde va el **concepto DIAN** (devolución /
   anulación / rebaja)? No aparece en la doc.
8. **Usuario de la API:** ya tenemos un **usuario ordinario** en la plataforma. Para
   consumir la API de facturación, ¿sirve ese mismo o necesitamos un usuario
   **específico / creado de otra forma**? ¿Qué permisos/rol necesita?

Gracias, quedamos atentos 🙏

---

## 3. Lo que necesitamos que respondan el dueño / socios (para construir)

| # | Qué | Para qué |
|---|---|---|
| 1 | Credenciales de la API de Numera (`username`/`password`) + `company_id` de Mirada | Construir/probar la emisión |
| 2 | ~~RNT + ¿activo? + NIT~~ ✅ **RNT 276306** · **NIT 902032515-0** · vigente hasta **31/03/2027** (activo) · dir. Calle 61 #23-36, Manizales. Falta solo el **token del RNT** (se pide en el portal TRA; llega al correo del RNT) | Token y reporte **TRA** (API) |
| 3 | ¿El hotel está **inscrito en SIRE**? Código de establecimiento, **código de ciudad**, dirección registrada | Reporte **SIRE** propio (archivo plano) |
| 4 | Hoy, ¿quién reporta SIRE/TRA — Kunas, alguien manual, o **nadie**? | Saber si tomamos el relevo sin duplicar |
| 5 | ¿Tienen **resolución DIAN** de numeración? ¿Nos consiguen un **prefijo/rango propio** para ventas web? | Consecutivo de facturación (con contador/Numera) |
| 6 | **Contacto de Numera** (WhatsApp / correo) | Enviar las preguntas |
| 7 | Decisión: ¿facturar por defecto a **consumidor final** salvo que el huésped pida factura a su nombre? | Simplifica datos (evita DANE/posición fiscal) |
| 8 | Confirmar: ¿queremos que **TODAS** las reservas (OTA + manual + web) hagan check-in en **nuestra** app? Si sí, hay que **dirigir** a los huéspedes de OTA/manual a nuestra app (correo pre-llegada/enlace) | Que la data de facturación y SIRE/TRA exista para todos los canales |

---

## 4. Respuesta a Jorge (Numera) — enviada el 1-jul

> _(Versión en el tono de Rafael, sin emojis — para el registro.)_
>
> Gracias Jorge, muy claro.
>
> Sobre el punto 8: el usuario es para consumir la API de Numera (esnumera.com), entonces
> perfecto, creamos uno distinto con rol cliente.
>
> Los puntos 3, 4 y 7 los metemos en el ticket, y de paso incluimos el 6 (cómo representar
> la venta a turista extranjero exento de IVA) y confirmamos el 1 (si el consecutivo lo
> asigna la API o lo enviamos, y si necesitamos una resolución o rango propio para las
> ventas de la web).
>
> Quedamos atentos a Ingrid con lo del ambiente de pruebas. Gracias.

## 5. Ticket para Numera (integración API de facturación)

**Enviar a:** Support@esnumera.zendesk.com
**Asunto:** Integración API de facturación (send-electronic-invoice) — Hotel Estar / MIRADA SAS (company 5)
**Estado:** ⏳ EN ESPERA — no enviar aún. Aguardamos la respuesta de **Ingrid** (ambiente
de pruebas BTW + `company_id`) para mandar el ticket completo de una vez.

> Hola, buenos días.
>
> Estamos integrando la facturación por su API para emitir las facturas de venta desde
> nuestro propio sistema, con una aprobación previa en nuestro panel. El disparador es el
> check-in completo de la reserva. Jorge nos pidió dejarles estas dudas por acá:
>
> 1. Datos legales de la factura. Necesitamos que la respuesta de la API (o un endpoint de
>    consulta, o un webhook) nos devuelva el número legal, el CUFE y el PDF de la factura,
>    para mostrárselos al huésped y poder referenciar la factura en las notas crédito.
> 2. Estado en la DIAN. Necesitamos saber si la DIAN aceptó o rechazó cada documento y cómo
>    consultarlo. Nos comentaron que con un 200 el documento ya va a la DIAN por el
>    operador; agradecemos la documentación y la forma de conocer el resultado final.
> 3. Notas crédito. Para una nota crédito (CreditNoteType), ¿qué campo y valor usamos para
>    el concepto de la DIAN (devolución, anulación, rebaja)? Si nos comparten un ejemplo del
>    cuerpo referenciando la factura original, nos sirve mucho.
> 4. Exención de IVA a turista extranjero. ¿Cómo representamos en el cuerpo una venta a un
>    turista extranjero exento de IVA (tipo de operación de exentos/excluidos, impuesto en
>    0%, u otra forma)?
> 5. Consecutivo. Queremos confirmar si el consecutivo lo asigna la API automáticamente
>    (según la resolución de la DIAN) o si lo enviamos nosotros. Y si conviene una resolución
>    o un rango propio para las ventas de la web, para no cruzarnos con la numeración de
>    contabilidad.
>
> Quedamos atentos. Gracias.
>
> Rafael Castaño — Hotel Estar / MIRADA SAS
