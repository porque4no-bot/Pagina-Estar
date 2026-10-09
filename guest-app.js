(function () {
  'use strict';

  const API = {
    session: '/api/guest-session',
    checkin: '/api/guest-checkin',
    action: '/api/guest-action'
  };
  /* Diccionarios de la guest app. La fuente de verdad son i18n/guest.{es,en}.json:
     build.js reemplaza estos bloques con el JSON en cada build. La copia de aquí
     solo sirve cuando se abre el archivo sin compilar (node server.js). */
  const guestI18n = {
    es: /*__GUEST_I18N_ES_START__*/{
      "expirationDateOptionalHint": "(opcional, solo pasaportes)",
      "nationalityPlaceholder": "Ej. Colombia",
      "cameraButton": "Tomar foto",
      "cameraInstruction": "Encuadra el documento dentro del marco",
      "captureBtn": "Capturar",
      "retakeBtn": "Reintentar",
      "photoTooDark": "Foto muy oscura o con demasiada luz, prueba de nuevo",
      "photoBlurry": "Foto borrosa, prueba de nuevo",
      "cameraUnavailable": "No fue posible abrir la cámara. Puedes subir una foto o un PDF del documento.",
      "photoReady": "Foto lista para analizar.",
      "cameraOnlyHint": "Toma una foto del documento con la cámara. Desde un computador también puedes subir una foto o un PDF.",
      "cameraGuideFocus": "Enfoca el documento",
      "cameraGuideGlare": "Evita reflejos o brillo sobre el documento",
      "cameraGuideTooDark": "Hay poca luz, acércate a una zona iluminada",
      "cameraGuideTooBright": "Demasiada luz, aleja la fuente de brillo",
      "cameraGuideMoveCloser": "Acerca el documento al marco",
      "cameraGuideHold": "Sostén firme, vamos a capturar",
      "cameraGuideReady": "Calidad lista, ya puedes capturar",
      "cameraGuideAnalyzing": "Revisando calidad de imagen…",
      "uploadButton": "Subir archivo",
      "docEmptyTitle": "Aún no has cargado el documento",
      "docFormatsHint": "JPG, PNG o PDF. Máximo 4.5 MB.",
      "docLoadedMeta": "✓ Documento cargado · {size} MB · listo para analizar",
      "docReadyMeta": "{size} MB · listo para analizar",
      "docLoaded": "Documento cargado.",
      "docReadyLabel": "{name} listo",
      "fileTooLarge": "El archivo supera 4.5 MB.",
      "fileReadError": "No fue posible leer el archivo.",
      "imageReadError": "No fue posible leer la imagen.",
      "photoPrepareError": "No fue posible preparar la foto.",
      "uploadingDocument": "Subiendo documento…",
      "genderLabel": "Género",
      "genderSelect": "Selecciona",
      "genderMale": "Masculino",
      "genderFemale": "Femenino",
      "documentTypeSelect": "Selecciona",
      "documentTypePassport": "Pasaporte",
      "occupationLabel": "Ocupación",
      "occupationPlaceholder": "Ej. Ingeniera, estudiante, comerciante",
      "birthPlaceLabel": "Lugar de nacimiento",
      "birthPlacePlaceholder": "Ciudad y país de nacimiento",
      "residenceSectionTitle": "Lugar de residencia",
      "residenceCountryLabel": "País de residencia",
      "residenceStateLabel": "Departamento / estado de residencia",
      "residenceCityLabel": "Ciudad de residencia",
      "originSectionTitle": "Lugar de procedencia",
      "originCountryLabel": "País de procedencia",
      "originStateLabel": "Departamento / estado de procedencia",
      "originCityLabel": "Ciudad de procedencia",
      "destinationLabel": "Destino al salir (solo extranjeros)",
      "destinationPlaceholder": "Ciudad y país al continuar tu viaje",
      "notesPlaceholder": "Alergias, requerimientos de movilidad o información útil para tu llegada.",
      "marketingConsentLabel": "Quiero recibir ofertas, novedades y recomendaciones de Estar por correo o WhatsApp.",
      "marketingConsentHint": "Opcional. Puedes darte de baja en cualquier momento.",
      "minorContactHint": "Para menores de edad, el correo, el WhatsApp y la aceptación de la política los da el adulto responsable.",
      "ocrManualReviewNotice": "No pudimos leer el documento automáticamente. Tus datos quedaron registrados y recepción los verificará al llegar.",
      "ocrAttemptsExhausted": "Hiciste varios intentos de lectura. Confirma tus datos a mano y continúa; recepción los validará.",
      "ocrReading": "Leyendo",
      "ocrValidating": "Validando con reconocimiento de documento…",
      "ocrReadOk": "Documento leído con {confidence}% de confianza. Confirma los datos.",
      "ocrReadFailed": "No fue posible leer el documento automáticamente. Completa los datos manualmente.",
      "ocrNotConfigured": "No pudimos leer el documento en este momento. Completa los datos manualmente.",
      "occupantCountLabel": "¿Cuántas personas se hospedan?",
      "guestSlotEmpty": "Vacía",
      "guestSlotOcrOk": "Documento leído",
      "guestSlotPendingSignature": "Documento cargado",
      "guestSlotLabel": "Huésped {n}",
      "primaryGuestLabel": "Principal",
      "stepProgress": "Paso {n} de 3",
      "checkinCompleteBadge": "Check-in completado",
      "preCheckinReady": "Pre check-in listo",
      "missingDocuments": "Primero sube el documento de identidad de cada huésped.",
      "analyzeRequired": "{name}: pulsa «Leer documento» para validar el documento antes de continuar.",
      "documentExpired": "El documento aparece vencido. Verifica la fecha de vencimiento.",
      "requiredFieldsMissing": "Completa los datos requeridos de cada huésped.",
      "destinationRequired": "{name}: como huésped extranjero, indica tu destino al salir (ciudad y país). Es un dato obligatorio del registro hotelero.",
      "invalidEmail": "{name}: revisa el correo, no tiene un formato válido.",
      "passportExpiryRequired": "{name}: para pasaportes indica la fecha de vencimiento.",
      "submittingCheckin": "Completando check-in",
      "validatingData": "Estamos validando tus datos…",
      "checkinReceived": "Check-in recibido. Código {code}.",
      "checkinAlreadyDone": "Ya completaste el check-in de esta reserva. Si necesitas corregir algo, puedes enviarlo de nuevo.",
      "reviewFields": "Revisa: {fields}.",
      "fieldFirstName": "nombres",
      "fieldLastName": "apellidos",
      "fieldDocumentType": "tipo de documento",
      "fieldDocumentNumber": "número de documento",
      "fieldBirthDate": "fecha de nacimiento",
      "fieldNationality": "nacionalidad",
      "fieldEmail": "correo",
      "fieldPhone": "WhatsApp",
      "fieldDestination": "destino al salir",
      "fieldExpirationDate": "vencimiento del pasaporte",
      "fieldPrivacy": "aceptación de la política de privacidad",
      "fieldRegistroCivil": "registro civil del menor",
      "fieldAuthorization": "carta de autorización del menor",
      "fieldDuplicateDoc": "documento repetido (cada huésped necesita el suyo)",
      "minorBadge": "Menor de edad",
      "minorDocsTitle": "Documentación del menor",
      "minorRcnLabel": "Registro civil de nacimiento",
      "minorRcnHelp": "Lo necesitamos para validar la autorización de un progenitor.",
      "minorFatherLabel": "Nombre del padre",
      "minorMotherLabel": "Nombre de la madre",
      "minorParentDetected": "Padre o madre detectado en el registro civil.",
      "minorParentNotPresentWarn": "Ningún padre o madre figura entre los adultos del check-in. Debes subir una carta de autorización firmada por un progenitor.",
      "minorAuthorizationLabel": "Carta de autorización",
      "minorAuthorizationHelp": "Documento firmado por padre, madre o tutor legal autorizando la estadía del menor.",
      "minorBlockingNotice": "Antes de confirmar el check-in, completa los documentos requeridos para los menores.",
      "escnnaReminder": "En cumplimiento de la Ley 679 de 2001, advertimos que la explotación y el abuso sexual de menores de edad son sancionados penal y administrativamente.",
      "viewContractLink": "Ver contrato completo",
      "contractModalTitle": "Contrato de Hospedaje",
      "contractModalEyebrow": "Antes de firmar",
      "contractModalIntro": "Lee el contrato completo. Para habilitar la firma, marca la casilla o desplázate hasta el final.",
      "contractModalScrollHint": "Desplázate hasta el final para habilitar la firma.",
      "contractModalReadyHint": "Has leído el contrato. Puedes cerrar y firmar.",
      "contractDownloadBtn": "Descargar PDF",
      "contractCloseBtn": "Cerrar",
      "contractAcknowledgeLabel": "He leído el contrato completo.",
      "contractAcknowledgeBlocked": "Lee el contrato antes de firmar.",
      "contractReadConfirmation": "Confirmación de lectura registrada.",
      "contractConsentText": "Declaro que he leído, entiendo y acepto íntegramente este contrato de hospedaje, sus cláusulas y políticas, y firmo electrónicamente con plenos efectos legales conforme a la Ley 527 de 1999 y el Decreto 2364 de 2012 de Colombia.",
      "contractNeedsCheckin": "Completa el check-in antes de firmar el contrato.",
      "contractChanged": "El contrato cambió desde que lo leíste. Ábrelo de nuevo antes de firmar.",
      "contractAlreadySigned": "Este contrato ya fue firmado. La copia firmada se envió a tu correo.",
      "contractWindowClosed": "El contrato ya no está disponible porque la estadía terminó. Si necesitas una copia, escríbenos por WhatsApp.",
      "contractLoading": "Cargando contrato…",
      "contractPreviewError": "No fue posible cargar la vista previa del contrato.",
      "contractPdfError": "No fue posible generar el PDF. Intenta de nuevo.",
      "contractPdfPreparing": "Preparando PDF…",
      "signNameRequired": "Escribe tu nombre completo para firmar.",
      "acceptRequired": "Debes aceptar el contrato para continuar.",
      "contractSigned": "Contrato firmado.",
      "contractSignedButton": "Contrato firmado",
      "contractEmailSent": "Te enviamos una copia en PDF a tu correo.",
      "contractDownloadSigned": "Descargar contrato firmado (PDF)",
      "processComplete": "Proceso completo",
      "retry": "Reintentar",
      "processing": "Procesando",
      "sending": "Enviando",
      "consulting": "Consultando",
      "searchingBooking": "Buscando tu reserva…",
      "registeringRequest": "Registrando solicitud…",
      "eventCode": "{message} Código {code}.",
      "orderReceived": "Pedido recibido.",
      "messageSent": "Mensaje enviado.",
      "requestReceived": "Solicitud recibida.",
      "cartEmpty": "Aún no has agregado servicios.",
      "perUnit": "c/u",
      "removeOne": "Quitar uno",
      "addOne": "Agregar uno",
      "pctOfNight": "{pct}% de la noche",
      "paymentReturn": "Recibimos tu pago. El cargo se reflejará en tu cuenta en breve.",
      "payAccount": "Cargar a mi cuenta",
      "payOnline": "Pagar en línea",
      "countdownDays": "Faltan {n} días",
      "countdownTomorrow": "Llegas mañana",
      "countdownToday": "Llegas hoy",
      "countdownInStay": "Estadía en curso",
      "welcomeDemo": "Estás viendo el flujo de demostración de la guest app.",
      "welcomeReady": "Todo está listo para tu próxima estadía.",
      "guestFallbackName": "huésped",
      "statusConfirmed": "Confirmada",
      "statusPending": "Pendiente",
      "statusCheckedIn": "Check-in completado",
      "statusCheckedOut": "Finalizada",
      "statusCancelled": "Cancelada",
      "defaultRoomName": "Apartaestudio",
      "bookingLabel": "Reserva {code}",
      "requestDates": "Cambiar fechas",
      "requestGuests": "Cambiar huéspedes",
      "requestInvoice": "Solicitar factura",
      "requestCancel": "Solicitar cancelación",
      "requestOther": "Otra solicitud",
      "changeMessagePlaceholder": "Cuéntanos qué necesitas. El equipo confirmará disponibilidad, condiciones y posibles diferencias de tarifa.",
      "supportConcierge": "Recomendación local",
      "supportHousekeeping": "Limpieza o mantenimiento",
      "supportTransport": "Transporte",
      "supportOther": "Otro",
      "deliveryPlaceholder": "Ej. Día de llegada, 7:30 a. m.",
      "bookingCodePlaceholder": "Ej. 45821 o EST-12345",
      "accessKeyPlaceholder": "Ej. Restrepo",
      "ariaHome": "Estar, volver al inicio",
      "ariaCloseCart": "Cerrar carrito",
      "ariaCloseCamera": "Cerrar cámara",
      "ariaCloseContract": "Cerrar contrato",
      "ariaStayNav": "Navegación de la estadía",
      "ariaMobileNav": "Navegación móvil",
      "altStudio": "Apartaestudio Estar",
      "altPark": "Bosque Popular El Prado y naturaleza de Manizales",
      "altCable": "Sector El Cable en Manizales",
      "altCity": "Vista urbana de Manizales",
      "errUnexpectedFormat": "El servicio respondió en un formato inesperado. Intenta de nuevo.",
      "errGeneric": "No fue posible completar la solicitud. Intenta de nuevo.",
      "errSessionExpired": "Tu sesión expiró. Vuelve a ingresar con tu código de reserva y apellido.",
      "errTooManyRequests": "Hiciste muchos intentos seguidos. Espera unos minutos e inténtalo de nuevo.",
      "errPayloadTooLarge": "El archivo es demasiado grande. Usa una foto más liviana (máximo 4.5 MB).",
      "errInvalidJson": "No pudimos leer la solicitud. Recarga la página e inténtalo de nuevo.",
      "errBookingCancelled": "Esta reserva fue cancelada, así que no es posible hacer el check-in ni pedir servicios. Si crees que es un error, escríbenos por WhatsApp.",
      "errBookingNotFound": "No encontramos una reserva que coincida con esos datos.",
      "errMissingLogin": "Ingresa el código de reserva y el apellido del titular.",
      "errServiceUnavailable": "El servicio no está disponible en este momento. Intenta más tarde o escríbenos por WhatsApp.",
      "errInvalidFile": "El archivo no tiene un formato válido.",
      "errUnsupportedType": "Usa una imagen JPG, PNG o un archivo PDF.",
      "errMissingDocument": "Selecciona una foto o PDF del documento.",
      "errTooManyGuests": "Registraste más huéspedes de los que permite la reserva.",
      "errValidation": "Revisa los campos requeridos antes de completar el check-in.",
      "errMinorDocument": "No pudimos recuperar el registro civil del menor. Vuelve a subirlo."
    }/*__GUEST_I18N_ES_END__*/,
    en: /*__GUEST_I18N_EN_START__*/{
      "expirationDateOptionalHint": "(optional, passports only)",
      "nationalityPlaceholder": "E.g. Colombia",
      "cameraButton": "Take photo",
      "cameraInstruction": "Frame the document inside the guide",
      "captureBtn": "Capture",
      "retakeBtn": "Retake",
      "photoTooDark": "Photo too dark or too bright, try again",
      "photoBlurry": "Photo is blurry, try again",
      "cameraUnavailable": "We could not open the camera. You can upload a photo or a PDF of the document.",
      "photoReady": "Photo ready to analyze.",
      "cameraOnlyHint": "Take a photo of the document with your camera. On a computer you can also upload a photo or a PDF.",
      "cameraGuideFocus": "Focus on the document",
      "cameraGuideGlare": "Avoid reflections or glare on the document",
      "cameraGuideTooDark": "Too dark, move to a brighter spot",
      "cameraGuideTooBright": "Too bright, move away from the light source",
      "cameraGuideMoveCloser": "Move the document closer to the frame",
      "cameraGuideHold": "Hold steady, capturing now",
      "cameraGuideReady": "Quality looks good, you can capture",
      "cameraGuideAnalyzing": "Checking image quality…",
      "uploadButton": "Upload file",
      "docEmptyTitle": "No document uploaded yet",
      "docFormatsHint": "JPG, PNG or PDF. Max 4.5 MB.",
      "docLoadedMeta": "✓ Document loaded · {size} MB · ready to read",
      "docReadyMeta": "{size} MB · ready to read",
      "docLoaded": "Document loaded.",
      "docReadyLabel": "{name} ready",
      "fileTooLarge": "The file is larger than 4.5 MB.",
      "fileReadError": "We could not read the file.",
      "imageReadError": "We could not read the image.",
      "photoPrepareError": "We could not prepare the photo.",
      "uploadingDocument": "Uploading document…",
      "genderLabel": "Gender",
      "genderSelect": "Select",
      "genderMale": "Male",
      "genderFemale": "Female",
      "documentTypeSelect": "Select",
      "documentTypePassport": "Passport",
      "occupationLabel": "Occupation",
      "occupationPlaceholder": "E.g. Engineer, student, merchant",
      "birthPlaceLabel": "Place of birth",
      "birthPlacePlaceholder": "City and country of birth",
      "residenceSectionTitle": "Place of residence",
      "residenceCountryLabel": "Country of residence",
      "residenceStateLabel": "State / department of residence",
      "residenceCityLabel": "City of residence",
      "originSectionTitle": "Place of origin",
      "originCountryLabel": "Country of origin",
      "originStateLabel": "State / department of origin",
      "originCityLabel": "City of origin",
      "destinationLabel": "Onward destination (foreign guests only)",
      "destinationPlaceholder": "City and country you travel to next",
      "notesPlaceholder": "Allergies, mobility needs or anything useful for your arrival.",
      "marketingConsentLabel": "I want to receive offers, news and recommendations from Estar by email or WhatsApp.",
      "marketingConsentHint": "Optional. You can unsubscribe at any time.",
      "minorContactHint": "For minors, the email, WhatsApp and policy acceptance are provided by the responsible adult.",
      "ocrManualReviewNotice": "We could not read the document automatically. Your details were saved and reception will verify them on arrival.",
      "ocrAttemptsExhausted": "You tried reading the document several times. Confirm your details manually and continue; reception will validate them.",
      "ocrReading": "Reading",
      "ocrValidating": "Validating with document recognition…",
      "ocrReadOk": "Document read with {confidence}% confidence. Please confirm the details.",
      "ocrReadFailed": "We could not read the document automatically. Please fill in the details manually.",
      "ocrNotConfigured": "We could not read the document right now. Please fill in the details manually.",
      "occupantCountLabel": "How many people are staying?",
      "guestSlotEmpty": "Empty",
      "guestSlotOcrOk": "Document read",
      "guestSlotPendingSignature": "Document loaded",
      "guestSlotLabel": "Guest {n}",
      "primaryGuestLabel": "Primary",
      "stepProgress": "Step {n} of 3",
      "checkinCompleteBadge": "Check-in completed",
      "preCheckinReady": "Pre check-in ready",
      "missingDocuments": "First upload the identity document of each guest.",
      "analyzeRequired": "{name}: tap “Read document” to validate the document before continuing.",
      "documentExpired": "The document appears to be expired. Please check the expiration date.",
      "requiredFieldsMissing": "Please complete the required details for each guest.",
      "destinationRequired": "{name}: as a foreign guest, please tell us your onward destination (city and country). It is required by the hotel guest registry.",
      "invalidEmail": "{name}: please check the email, it is not valid.",
      "passportExpiryRequired": "{name}: for passports, please enter the expiration date.",
      "submittingCheckin": "Completing check-in",
      "validatingData": "We are validating your details…",
      "checkinReceived": "Check-in received. Code {code}.",
      "checkinAlreadyDone": "You already completed the check-in for this booking. If you need to fix something, you can send it again.",
      "reviewFields": "Please check: {fields}.",
      "fieldFirstName": "first names",
      "fieldLastName": "last names",
      "fieldDocumentType": "document type",
      "fieldDocumentNumber": "document number",
      "fieldBirthDate": "date of birth",
      "fieldNationality": "nationality",
      "fieldEmail": "email",
      "fieldPhone": "WhatsApp",
      "fieldDestination": "onward destination",
      "fieldExpirationDate": "passport expiration date",
      "fieldPrivacy": "privacy policy acceptance",
      "fieldRegistroCivil": "minor's birth certificate",
      "fieldAuthorization": "minor's authorization letter",
      "fieldDuplicateDoc": "repeated document (each guest needs their own)",
      "minorBadge": "Minor",
      "minorDocsTitle": "Minor documentation",
      "minorRcnLabel": "Birth certificate",
      "minorRcnHelp": "We need it to validate parental authorization.",
      "minorFatherLabel": "Father's name",
      "minorMotherLabel": "Mother's name",
      "minorParentDetected": "Parent detected from birth certificate.",
      "minorParentNotPresentWarn": "No parent listed among adult guests in this check-in. You must upload a signed authorization letter from a parent.",
      "minorAuthorizationLabel": "Authorization letter",
      "minorAuthorizationHelp": "Document signed by a parent or legal guardian authorizing the minor's stay.",
      "minorBlockingNotice": "Before confirming check-in, complete the required documents for minors.",
      "escnnaReminder": "In compliance with Colombian Law 679 of 2001, we warn that child sexual exploitation and abuse are criminally and administratively punished.",
      "viewContractLink": "View full contract",
      "contractModalTitle": "Hospitality Agreement",
      "contractModalEyebrow": "Before you sign",
      "contractModalIntro": "Read the full contract. To enable signing, tick the box or scroll to the end.",
      "contractModalScrollHint": "Scroll to the end to enable signing.",
      "contractModalReadyHint": "You have read the contract. You can close and sign.",
      "contractDownloadBtn": "Download PDF",
      "contractCloseBtn": "Close",
      "contractAcknowledgeLabel": "I have read the full contract.",
      "contractAcknowledgeBlocked": "Read the contract before signing.",
      "contractReadConfirmation": "Read confirmation recorded.",
      "contractConsentText": "I declare that I have read, understand, and fully accept this hospitality agreement, its clauses, and policies, and I electronically sign it with full legal effect under Colombian Law 527 of 1999 and Decree 2364 of 2012.",
      "contractNeedsCheckin": "Complete the check-in before signing the contract.",
      "contractChanged": "The contract changed since you read it. Please open it again before signing.",
      "contractAlreadySigned": "This agreement is already signed. The signed copy was sent to your email.",
      "contractWindowClosed": "The agreement is no longer available because your stay has ended. If you need a copy, message us on WhatsApp.",
      "contractLoading": "Loading contract…",
      "contractPreviewError": "We could not load the contract preview.",
      "contractPdfError": "We could not generate the PDF. Please try again.",
      "contractPdfPreparing": "Preparing PDF…",
      "signNameRequired": "Type your full name to sign.",
      "acceptRequired": "You must accept the contract to continue.",
      "contractSigned": "Contract signed.",
      "contractSignedButton": "Contract signed",
      "contractEmailSent": "We emailed you a PDF copy.",
      "contractDownloadSigned": "Download signed contract (PDF)",
      "processComplete": "All set",
      "retry": "Retry",
      "processing": "Processing",
      "sending": "Sending",
      "consulting": "Searching",
      "searchingBooking": "Looking for your booking…",
      "registeringRequest": "Saving your request…",
      "eventCode": "{message} Code {code}.",
      "orderReceived": "Order received.",
      "messageSent": "Message sent.",
      "requestReceived": "Request received.",
      "cartEmpty": "You have not added any services yet.",
      "perUnit": "each",
      "removeOne": "Remove one",
      "addOne": "Add one",
      "pctOfNight": "{pct}% of the night",
      "paymentReturn": "We received your payment. The charge will show on your account shortly.",
      "payAccount": "Charge to my room",
      "payOnline": "Pay online",
      "countdownDays": "{n} days to go",
      "countdownTomorrow": "You arrive tomorrow",
      "countdownToday": "You arrive today",
      "countdownInStay": "Stay in progress",
      "welcomeDemo": "You are viewing the guest app demo flow.",
      "welcomeReady": "Everything is ready for your upcoming stay.",
      "guestFallbackName": "guest",
      "statusConfirmed": "Confirmed",
      "statusPending": "Pending",
      "statusCheckedIn": "Checked in",
      "statusCheckedOut": "Completed",
      "statusCancelled": "Cancelled",
      "defaultRoomName": "Studio",
      "bookingLabel": "Booking {code}",
      "requestDates": "Change dates",
      "requestGuests": "Change guests",
      "requestInvoice": "Request an invoice",
      "requestCancel": "Request cancellation",
      "requestOther": "Other request",
      "changeMessagePlaceholder": "Tell us what you need. The team will confirm availability, conditions and any rate difference.",
      "supportConcierge": "Local recommendation",
      "supportHousekeeping": "Cleaning or maintenance",
      "supportTransport": "Transport",
      "supportOther": "Other",
      "deliveryPlaceholder": "E.g. Arrival day, 7:30 a.m.",
      "bookingCodePlaceholder": "E.g. 45821 or EST-12345",
      "accessKeyPlaceholder": "E.g. Restrepo",
      "ariaHome": "Estar, back to home",
      "ariaCloseCart": "Close cart",
      "ariaCloseCamera": "Close camera",
      "ariaCloseContract": "Close contract",
      "ariaStayNav": "Stay navigation",
      "ariaMobileNav": "Mobile navigation",
      "altStudio": "Estar studio",
      "altPark": "Bosque Popular El Prado and Manizales nature",
      "altCable": "El Cable district in Manizales",
      "altCity": "Manizales cityscape",
      "errUnexpectedFormat": "The service replied in an unexpected format. Please try again.",
      "errGeneric": "We could not complete the request. Please try again.",
      "errSessionExpired": "Your session expired. Please sign in again with your booking code and last name.",
      "errTooManyRequests": "Too many attempts in a row. Please wait a few minutes and try again.",
      "errPayloadTooLarge": "The file is too large. Please use a lighter photo (max 4.5 MB).",
      "errInvalidJson": "We could not read the request. Reload the page and try again.",
      "errBookingCancelled": "This booking was cancelled, so check-in and service requests are not available. If you think this is a mistake, message us on WhatsApp.",
      "errBookingNotFound": "We could not find a booking matching those details.",
      "errMissingLogin": "Enter the booking code and the holder's last name.",
      "errServiceUnavailable": "The service is not available right now. Please try later or message us on WhatsApp.",
      "errInvalidFile": "The file format is not valid.",
      "errUnsupportedType": "Use a JPG or PNG image or a PDF file.",
      "errMissingDocument": "Select a photo or PDF of the document.",
      "errTooManyGuests": "You registered more guests than the booking allows.",
      "errValidation": "Please review the required fields before completing check-in.",
      "errMinorDocument": "We could not retrieve the minor's birth certificate. Please upload it again."
    }/*__GUEST_I18N_EN_END__*/
  };
  const CAMERA_WIDTH = 1600;
  const CAMERA_HEIGHT = 1006;
  const CAMERA_QUALITY = 0.9;
  /* Subidas desde archivo (computador): se reescalan a este lado máximo y se
     recomprimen para no rozar el límite de 6 MB de las funciones de Netlify. */
  const UPLOAD_MAX_SIDE = 2000;
  const UPLOAD_QUALITY = 0.88;
  const MAX_FILE_BYTES = 4.5 * 1024 * 1024;
  const SESSION_KEY = 'estar-guest-session';
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  /* Versión del contrato que se presenta. El servidor fija la suya
     (CURRENT_CONTRACT_VERSION en guest-action.js) y es la que queda en la
     evidencia; esta solo viaja como referencia. */
  const CONTRACT_VERSION = 'ESTAR-HOSPEDAJE-2026-01';
  /* Códigos de error del servidor → clave de i18n. Así el huésped ve el mensaje
     en su idioma y nunca un texto técnico ("Payload too large", etc.). */
  const ERROR_CODE_KEYS = {
    session_expired: 'errSessionExpired',
    payload_too_large: 'errPayloadTooLarge',
    invalid_json: 'errInvalidJson',
    rate_limited: 'errTooManyRequests',
    booking_cancelled: 'errBookingCancelled',
    booking_not_found: 'errBookingNotFound',
    missing_login: 'errMissingLogin',
    service_unavailable: 'errServiceUnavailable',
    invalid_file: 'errInvalidFile',
    unsupported_type: 'errUnsupportedType',
    file_too_large: 'fileTooLarge',
    missing_document: 'errMissingDocument',
    too_many_guests: 'errTooManyGuests',
    validation_failed: 'errValidation',
    minor_document_missing: 'errMinorDocument',
    checkin_required: 'contractNeedsCheckin',
    contract_changed: 'contractChanged',
    contract_already_signed: 'contractAlreadySigned',
    contract_window_closed: 'contractWindowClosed'
  };
  /* Campos que el servidor puede reportar como faltantes (validation.missing =
     "guests.<i>.<campo>") → etiqueta legible. */
  const FIELD_LABEL_KEYS = {
    firstName: 'fieldFirstName',
    lastName: 'fieldLastName',
    documentType: 'fieldDocumentType',
    documentNumber: 'fieldDocumentNumber',
    birthDate: 'fieldBirthDate',
    nationality: 'fieldNationality',
    email: 'fieldEmail',
    phone: 'fieldPhone',
    destination: 'fieldDestination',
    expirationDate: 'fieldExpirationDate',
    privacyAccepted: 'fieldPrivacy',
    registroCivil: 'fieldRegistroCivil',
    authorization: 'fieldAuthorization',
    documentoDuplicado: 'fieldDuplicateDoc'
  };
  const state = {
    token: '',
    booking: null,
    document: null,
    guestSlots: [],
    activeGuestIndex: 0,
    cart: {},
    cameraStream: null,
    cameraFailed: false,
    marketingAccepted: false,
    /* Check-in completado (id devuelto por guest-checkin o por la sesión). El
       contrato solo se puede ver/firmar cuando existe. */
    checkinId: '',
    /* Audit-trail evidence for the e-signature flow (Ley 527 / Decreto 2364):
       contractRead is set true when the user scrolls to the end of the modal
       OR explicitly ticks "I have read", and acknowledgedAt records the ISO
       timestamp. previewHash is the server's SHA-256 of the exact contract HTML
       shown in the modal; signing sends it back so the stored hash is the one
       of the text the guest actually read. */
    contractRead: false,
    contractAcknowledgedAt: '',
    previewHtml: '',
    previewHash: '',
    contractSigned: false,
    signedPdf: null
  };

  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const escHtml = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const money = value => new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(Number(value || 0));

  function currentLang() {
    return document.documentElement.lang === 'en' || window.location.pathname.startsWith('/en/')
      ? 'en'
      : 'es';
  }

  function locale() {
    return currentLang() === 'en' ? 'en-US' : 'es-CO';
  }

  /* t(key, vars): texto en el idioma de la página; {placeholders} se reemplazan
     con vars. Cae al español y luego a la clave. */
  function t(key, vars) {
    const dict = guestI18n[currentLang()] || guestI18n.es;
    let text = dict[key] || guestI18n.es[key] || key;
    if (vars) {
      text = text.replace(/\{(\w+)\}/g, (match, name) => (
        vars[name] !== undefined && vars[name] !== null ? String(vars[name]) : match
      ));
    }
    return text;
  }

  const dateLabel = value => {
    if (!value) return '—';
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat(locale(), {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    }).format(date);
  };

  function applyGuestI18n() {
    $$('[data-guest-i18n]').forEach(element => {
      element.textContent = t(element.dataset.guestI18n);
    });
    $$('[data-guest-i18n-placeholder]').forEach(element => {
      element.setAttribute('placeholder', t(element.dataset.guestI18nPlaceholder));
    });
    $$('[data-guest-i18n-aria]').forEach(element => {
      element.setAttribute('aria-label', t(element.dataset.guestI18nAria));
    });
    $$('[data-guest-i18n-alt]').forEach(element => {
      element.setAttribute('alt', t(element.dataset.guestI18nAlt));
    });
  }

  function setStatus(element, message, type) {
    if (!element) return;
    element.textContent = message || '';
    element.classList.remove('is-error', 'is-success', 'is-loading');
    if (type) element.classList.add(`is-${type}`);
  }

  function setButtonLoading(button, loading, label) {
    if (!button) return;
    if (loading) {
      button.dataset.originalLabel = button.innerHTML;
      button.disabled = true;
      button.innerHTML = `<span class="guest-spinner" aria-hidden="true"></span>${escHtml(label || t('processing'))}`;
    } else {
      button.disabled = false;
      if (button.dataset.originalLabel) button.innerHTML = button.dataset.originalLabel;
      if (window.lucide) window.lucide.createIcons();
    }
  }

  /* Mensaje para el huésped a partir de una respuesta de error del servidor:
     código conocido → texto traducido; si no, el texto del servidor (que está en
     español) solo en la página en español; en inglés, un genérico por estado. */
  function friendlyError(status, data) {
    const code = data && data.code;
    if (code && ERROR_CODE_KEYS[code]) return t(ERROR_CODE_KEYS[code]);
    if (status === 401) return t('errSessionExpired');
    if (status === 429) return t('errTooManyRequests');
    if (status === 413) return t('errPayloadTooLarge');
    if (status === 503) return t('errServiceUnavailable');
    if (currentLang() === 'es' && data && typeof data.error === 'string' && data.error) return data.error;
    return t('errGeneric');
  }

  async function request(url, options) {
    const headers = { 'Content-Type': 'application/json', ...((options && options.headers) || {}) };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const response = await fetch(url, { ...options, headers });
    let data = {};
    let parsed = true;
    try {
      data = await response.json();
    } catch (error) {
      parsed = false;
      data = {};
    }
    if (!response.ok) {
      const message = parsed
        ? friendlyError(response.status, data)
        : (response.status === 413 ? t('errPayloadTooLarge') : t('errUnexpectedFormat'));
      const failure = new Error(message);
      failure.data = data;
      failure.status = response.status;
      failure.code = data && data.code;
      if (response.status === 401 && url !== API.session && state.token) {
        handleSessionExpired();
      }
      throw failure;
    }
    if (!parsed) throw new Error(t('errUnexpectedFormat'));
    return data;
  }

  function saveSession() {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        token: state.token,
        booking: state.booking,
        checkinId: state.checkinId,
        contractSigned: state.contractSigned
      }));
    } catch (error) {
      /* sessionStorage bloqueado (modo privado): la app sigue sin persistencia. */
    }
  }

  function clearSession() {
    state.token = '';
    state.booking = null;
    state.document = null;
    state.guestSlots = [];
    state.activeGuestIndex = 0;
    state.cart = {};
    state.checkinId = '';
    state.contractRead = false;
    state.contractAcknowledgedAt = '';
    state.previewHtml = '';
    state.previewHash = '';
    state.contractSigned = false;
    state.signedPdf = null;
    try { sessionStorage.removeItem(SESSION_KEY); } catch (error) { /* noop */ }
  }

  function restoreSession() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
      if (saved && saved.token && saved.booking) {
        state.token = saved.token;
        state.booking = saved.booking;
        state.checkinId = String(saved.checkinId || (saved.booking && saved.booking.checkinId) || '');
        state.contractSigned = Boolean(saved.contractSigned);
        return true;
      }
    } catch (error) {
      clearSession();
    }
    return false;
  }

  /* La sesión firmada venció (24 h) o fue rechazada: volvemos al ingreso con un
     mensaje claro en vez de dejar al huésped con errores sueltos. */
  function handleSessionExpired() {
    clearSession();
    showLogin();
    setStatus($('#loginStatus'), t('errSessionExpired'), 'error');
  }

  function localDemoSession() {
    const checkIn = new Date();
    checkIn.setDate(checkIn.getDate() + 12);
    const checkOut = new Date(checkIn);
    checkOut.setDate(checkOut.getDate() + 4);
    state.token = 'local-demo-token';
    state.booking = {
      bookingCode: 'EST-DEMO-2026',
      status: 'confirmed',
      guestName: 'Andrea Restrepo',
      roomName: 'Apartaestudio Selección',
      roomNumber: '402',
      capacity: 2,
      checkIn: checkIn.toISOString().slice(0, 10),
      checkOut: checkOut.toISOString().slice(0, 10),
      nights: 4,
      totalAmount: 1280000,
      canCancel: true,
      canModify: true,
      onlinePayment: false,
      demo: true
    };
  }

  function daysUntil(value) {
    if (!value) return null;
    const target = new Date(`${value}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.ceil((target - today) / 86400000);
  }

  function emptyGuest() {
    return {
      firstName: '',
      lastName: '',
      documentType: '',
      documentNumber: '',
      birthDate: '',
      expirationDate: '',
      nationality: '',
      arrivalTime: '',
      email: '',
      phone: '',
      address: '',
      notes: '',
      /* SIRE/TRA: campos legales adicionales (capturados en el check-in). */
      sex: '',
      occupation: '',
      birthPlace: '',
      residenceCountry: '',
      residenceState: '',
      residenceCity: '',
      originCountry: '',
      originState: '',
      originCity: '',
      destination: '',
      privacyAccepted: false
    };
  }

  function createGuestSlot(index) {
    return {
      guest: emptyGuest(),
      document: null,
      documentRef: null,
      analysisSource: '',
      confidence: 0,
      ocrAttempts: 0,        /* intentos de lectura Azure (gate 3 → revisión manual) */
      manualReview: false,   /* true tras 3 lecturas fallidas: se permite continuar a mano */
      isPrimary: index === 0,
      status: 'empty',
      isMinor: false,
      fatherName: '',
      motherName: '',
      registroCivilDocumentRef: null,
      registroCivilName: '',
      authorizationDocumentRef: null,
      authorizationName: '',
      parentPresent: false
    };
  }

  function calculateAgeClient(birthDate) {
    if (!birthDate) return 0;
    const value = String(birthDate).trim();
    if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return 0;
    const [y, mo, d] = value.slice(0, 10).split('-').map(Number);
    if (mo < 1 || mo > 12 || d < 1 || d > new Date(y, mo, 0).getDate()) return 0;
    const birth = new Date(`${value.slice(0, 10)}T00:00:00`);
    if (Number.isNaN(birth.getTime())) return 0;
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
    return Math.max(0, age);
  }

  /* Igual que el servidor (guest-checkin.calculateAge < 18): menor solo si hay
     fecha de nacimiento. */
  function isMinorGuest(guest) {
    return Boolean(guest && guest.birthDate) && calculateAgeClient(guest.birthDate) < 18;
  }

  function normalizeNameClient(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  /* Espejo de guest-checkin.isForeignGuest: extranjero = nacionalidad distinta
     de Colombia. El servidor le exige el destino al salir (TRA). */
  function isForeignNationality(nationality) {
    const nat = normalizeNameClient(nationality);
    if (!nat) return false;
    return !['colombia', 'colombiano', 'colombiana', 'co', 'col'].includes(nat);
  }

  function progenitorMatchesAdult(progenitorName, adultSlots) {
    const target = normalizeNameClient(progenitorName);
    if (!target) return false;
    const targetTokens = target.split(' ').filter(Boolean);
    if (!targetTokens.length) return false;
    return adultSlots.some(slot => {
      const candidate = normalizeNameClient(`${slot.guest.firstName || ''} ${slot.guest.lastName || ''}`);
      if (!candidate) return false;
      if (target.length >= 3 && (candidate.includes(target) || target.includes(candidate))) return true;
      const candidateTokens = new Set(candidate.split(' ').filter(Boolean));
      const allPresent = targetTokens.every(token => candidateTokens.has(token));
      return allPresent && targetTokens.some(token => token.length >= 3);
    });
  }

  function recomputeMinorParentPresence() {
    const adultSlots = state.guestSlots.filter(slot => !slot.isMinor);
    state.guestSlots.forEach(slot => {
      if (!slot.isMinor) {
        slot.parentPresent = false;
        return;
      }
      slot.parentPresent = progenitorMatchesAdult(slot.fatherName, adultSlots)
        || progenitorMatchesAdult(slot.motherName, adultSlots);
    });
  }

  function bookingCapacity() {
    const capacity = Number(state.booking && state.booking.capacity);
    return Math.min(5, Math.max(1, Number.isFinite(capacity) && capacity > 0 ? capacity : 1));
  }

  function updateOccupantCountOptions() {
    const select = $('#occupantCount');
    if (!select) return;
    const max = bookingCapacity();
    Array.from(select.options).forEach(option => {
      option.disabled = Number(option.value) > max;
    });
  }

  function splitBookingName() {
    const parts = String((state.booking && state.booking.guestName) || '').trim().split(/\s+/).filter(Boolean);
    return { firstName: parts.shift() || '', lastName: parts.join(' ') };
  }

  function activeSlot() {
    return state.guestSlots[state.activeGuestIndex] || null;
  }

  function formFields() {
    return [
      'firstName', 'lastName', 'documentType', 'documentNumber', 'birthDate',
      'expirationDate', 'nationality', 'arrivalTime', 'email', 'phone', 'address', 'notes',
      /* SIRE/TRA */
      'sex', 'occupation', 'birthPlace',
      'residenceCountry', 'residenceState', 'residenceCity',
      'originCountry', 'originState', 'originCity', 'destination'
    ];
  }

  function sizeMb(bytes) {
    return (Number(bytes || 0) / 1024 / 1024).toFixed(2);
  }

  function saveActiveGuestFromForm() {
    const slot = activeSlot();
    if (!slot) return;
    formFields().forEach(name => {
      const field = $(`[name="${name}"]`);
      if (field) slot.guest[name] = field.value || '';
    });
    const privacy = $('[name="privacyAccepted"]');
    if (privacy) slot.guest.privacyAccepted = privacy.checked;
    /* Consentimiento de marketing: uno solo para el check-in (no por huésped). */
    const marketing = $('[name="marketingAccepted"]');
    if (marketing) state.marketingAccepted = marketing.checked;
    slot.isMinor = isMinorGuest(slot.guest);
    if (!slot.isMinor) {
      /* Clear any minor-only state if the guest turns out to be an adult so
         we don't accidentally send stale refs to the server. */
      slot.fatherName = '';
      slot.motherName = '';
      slot.registroCivilDocumentRef = null;
      slot.registroCivilName = '';
      slot.authorizationDocumentRef = null;
      slot.authorizationName = '';
      slot.parentPresent = false;
    }
    recomputeMinorParentPresence();
    slot.status = slot.document
      ? (slot.analysisSource === 'azure' ? 'ocr' : 'pending')
      : 'empty';
  }

  function loadActiveGuestIntoForm() {
    const slot = activeSlot();
    if (!slot) return;
    formFields().forEach(name => {
      const field = $(`[name="${name}"]`);
      if (field) field.value = slot.guest[name] || '';
    });
    const privacy = $('[name="privacyAccepted"]');
    if (privacy) privacy.checked = Boolean(slot.guest.privacyAccepted);
    const marketing = $('[name="marketingAccepted"]');
    if (marketing) marketing.checked = Boolean(state.marketingAccepted);
    state.document = slot.document;
    if (slot.document) {
      $('#uploadTitle').textContent = slot.document.name;
      $('#uploadMeta').textContent = t('docLoadedMeta', { size: sizeMb(slot.document.size) });
      $('#analyzeDocument').disabled = false;
    } else {
      $('#uploadTitle').textContent = t('docEmptyTitle');
      $('#uploadMeta').textContent = t('docFormatsHint');
      $('#analyzeDocument').disabled = true;
    }
    setStatus($('#ocrStatus'), '', '');
    updateFieldRequirements();
    renderMinorSection();
  }

  function renderMinorSection() {
    const slot = activeSlot();
    const card = $('#minorDocsCard');
    if (!card) return;
    if (!slot || !slot.isMinor) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const fatherInput = $('#minorFatherName');
    const motherInput = $('#minorMotherName');
    if (fatherInput) fatherInput.value = slot.fatherName || '';
    if (motherInput) motherInput.value = slot.motherName || '';
    const rcnTitle = $('#minorRcnTitle');
    const rcnMeta = $('#minorRcnMeta');
    if (slot.registroCivilDocumentRef) {
      if (rcnTitle) rcnTitle.textContent = slot.registroCivilName || t('minorRcnLabel');
      if (rcnMeta) rcnMeta.textContent = (slot.fatherName || slot.motherName) ? t('minorParentDetected') : t('minorRcnHelp');
    } else {
      if (rcnTitle) rcnTitle.textContent = t('minorRcnLabel');
      if (rcnMeta) rcnMeta.textContent = t('docFormatsHint');
    }
    const authBlock = $('#minorAuthBlock');
    const authTitle = $('#minorAuthTitle');
    const authMeta = $('#minorAuthMeta');
    const parentMessage = $('#minorParentMessage');
    const hasParentInput = Boolean(slot.fatherName || slot.motherName);
    if (hasParentInput && !slot.parentPresent) {
      if (authBlock) authBlock.hidden = false;
      if (parentMessage) setStatus(parentMessage, t('minorParentNotPresentWarn'), 'error');
    } else {
      if (authBlock) authBlock.hidden = !slot.authorizationDocumentRef;
      if (parentMessage) {
        if (slot.parentPresent) setStatus(parentMessage, t('minorParentDetected'), 'success');
        else setStatus(parentMessage, '', '');
      }
    }
    if (slot.authorizationDocumentRef) {
      if (authTitle) authTitle.textContent = slot.authorizationName || t('minorAuthorizationLabel');
      if (authMeta) authMeta.textContent = t('minorAuthorizationHelp');
    } else {
      if (authTitle) authTitle.textContent = t('minorAuthorizationLabel');
      if (authMeta) authMeta.textContent = t('docFormatsHint');
    }
    setStatus($('#minorRcnStatus'), slot.registroCivilDocumentRef
      ? t('docReadyLabel', { name: slot.registroCivilName || '' }).trim()
      : '', slot.registroCivilDocumentRef ? 'success' : '');
    setStatus($('#minorAuthStatus'), slot.authorizationDocumentRef
      ? t('docReadyLabel', { name: slot.authorizationName || '' }).trim()
      : '', slot.authorizationDocumentRef ? 'success' : '');
  }

  async function uploadMinorDocumentFromPayload(docKind, documentPayload) {
    const slot = activeSlot();
    if (!slot) return;
    const slotIndex = state.activeGuestIndex;
    const statusEl = docKind === 'registro-civil' ? $('#minorRcnStatus') : $('#minorAuthStatus');
    if (documentPayload.size > MAX_FILE_BYTES) {
      setStatus(statusEl, t('fileTooLarge'), 'error');
      return;
    }
    setStatus(statusEl, t('uploadingDocument'), 'loading');
    try {
      let data;
      if (state.token === 'local-demo-token') {
        await new Promise(resolve => setTimeout(resolve, 400));
        data = {
          documentRef: { key: `local-demo/${docKind}/${slotIndex}`, name: documentPayload.name },
          extracted: docKind === 'registro-civil' ? { fatherName: '', motherName: '' } : null
        };
      } else {
        data = await request(API.checkin, {
          method: 'POST',
          body: JSON.stringify({
            mode: 'analyze-minor-doc',
            file: documentPayload,
            slotIndex,
            docKind
          })
        });
      }
      const targetSlot = state.guestSlots[slotIndex];
      if (!targetSlot) return;
      if (docKind === 'registro-civil') {
        targetSlot.registroCivilDocumentRef = data.documentRef || null;
        targetSlot.registroCivilName = documentPayload.name;
        if (data.extracted) {
          if (data.extracted.fatherName && !targetSlot.fatherName) targetSlot.fatherName = data.extracted.fatherName;
          if (data.extracted.motherName && !targetSlot.motherName) targetSlot.motherName = data.extracted.motherName;
        }
      } else {
        targetSlot.authorizationDocumentRef = data.documentRef || null;
        targetSlot.authorizationName = documentPayload.name;
      }
      recomputeMinorParentPresence();
      if (state.activeGuestIndex === slotIndex) renderMinorSection();
      renderGuestCards();
      setStatus(statusEl, t('photoReady'), 'success');
    } catch (error) {
      setStatus(statusEl, error.message, 'error');
    }
  }

  async function uploadMinorDocument(docKind, file) {
    const statusEl = docKind === 'registro-civil' ? $('#minorRcnStatus') : $('#minorAuthStatus');
    try {
      const documentPayload = await fileToUploadDocument(file);
      await uploadMinorDocumentFromPayload(docKind, documentPayload);
    } catch (error) {
      setStatus(statusEl, error.message, 'error');
    }
  }

  async function handleMinorRcnSelection(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    await uploadMinorDocument('registro-civil', file);
    event.target.value = '';
  }

  async function handleMinorAuthSelection(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    await uploadMinorDocument('autorizacion', file);
    event.target.value = '';
  }

  async function handleMinorRcnCamera(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      const documentPayload = await imageFileToCameraDocument(file);
      await uploadMinorDocumentFromPayload('registro-civil', documentPayload);
    } catch (error) {
      setStatus($('#minorRcnStatus'), error.message, 'error');
    }
  }

  function onMinorParentInput() {
    const slot = activeSlot();
    if (!slot || !slot.isMinor) return;
    slot.fatherName = $('#minorFatherName').value || '';
    slot.motherName = $('#minorMotherName').value || '';
    recomputeMinorParentPresence();
    renderMinorSection();
  }

  function slotLabel(slot, index) {
    const name = slot ? `${slot.guest.firstName || ''} ${slot.guest.lastName || ''}`.trim() : '';
    return name || t('guestSlotLabel', { n: index + 1 });
  }

  function slotStatusLabel(slot) {
    if (slot.status === 'ocr') return t('guestSlotOcrOk');
    if (slot.document) return t('guestSlotPendingSignature');
    return t('guestSlotEmpty');
  }

  function renderGuestCards() {
    const container = $('#guestCards');
    if (!container) return;
    container.innerHTML = state.guestSlots.map((slot, index) => `
      <article class="guest-occupant-card${index === state.activeGuestIndex ? ' is-active' : ''}${slot.isMinor ? ' is-minor' : ''}" data-guest-slot="${index}">
        <button type="button" class="guest-occupant-main" data-select-guest="${index}">
          <strong>${escHtml(slotLabel(slot, index))}</strong>
          <small>${escHtml(slotStatusLabel(slot))}</small>
          ${slot.isMinor ? `<span class="guest-minor-flag">${escHtml(t('minorBadge'))}</span>` : ''}
        </button>
        <label class="guest-primary-choice">
          <input type="radio" name="primaryGuest" value="${index}" ${slot.isPrimary ? 'checked' : ''}>
          <span>${escHtml(t('primaryGuestLabel'))}</span>
        </label>
      </article>
    `).join('');
    $$('[data-select-guest]').forEach(button => {
      button.addEventListener('click', () => selectGuestSlot(Number(button.dataset.selectGuest)));
    });
    $$('[name="primaryGuest"]').forEach(input => {
      input.addEventListener('change', event => setPrimaryGuest(Number(event.target.value)));
    });
  }

  function selectGuestSlot(index) {
    saveActiveGuestFromForm();
    state.activeGuestIndex = Math.max(0, Math.min(index, state.guestSlots.length - 1));
    loadActiveGuestIntoForm();
    renderGuestCards();
  }

  function setPrimaryGuest(index) {
    state.guestSlots.forEach((slot, slotIndex) => {
      slot.isPrimary = slotIndex === index;
    });
    renderGuestCards();
  }

  function setGuestSlotCount(count) {
    saveActiveGuestFromForm();
    const nextCount = Math.min(bookingCapacity(), Math.max(1, Number(count) || 1));
    while (state.guestSlots.length < nextCount) {
      state.guestSlots.push(createGuestSlot(state.guestSlots.length));
    }
    state.guestSlots = state.guestSlots.slice(0, nextCount);
    if (!state.guestSlots.some(slot => slot.isPrimary)) state.guestSlots[0].isPrimary = true;
    state.activeGuestIndex = Math.min(state.activeGuestIndex, state.guestSlots.length - 1);
    $('#occupantCount').value = String(nextCount);
    loadActiveGuestIntoForm();
    renderGuestCards();
  }

  function initializeGuestSlots() {
    if (state.guestSlots.length) return;
    const count = bookingCapacity();
    updateOccupantCountOptions();
    state.guestSlots = Array.from({ length: count }, (_, index) => createGuestSlot(index));
    const bookingName = splitBookingName();
    state.guestSlots[0].guest.firstName = bookingName.firstName;
    state.guestSlots[0].guest.lastName = bookingName.lastName;
    state.guestSlots[0].guest.email = (state.booking && state.booking.guestEmail) || '';
    $('#occupantCount').value = String(count);
    loadActiveGuestIntoForm();
    renderGuestCards();
  }

  function roomLabel(booking) {
    const name = booking.roomName || t('defaultRoomName');
    const number = String(booking.roomNumber || '').trim();
    return number && number !== name ? `${name} · ${number}` : name;
  }

  function renderBooking() {
    const booking = state.booking;
    if (!booking) return;
    const firstName = String(booking.guestName || '').trim().split(/\s+/)[0] || t('guestFallbackName');
    $('#guestFirstName').textContent = `${firstName}.`;
    $('#guestStayDates').textContent = `${dateLabel(booking.checkIn)} · ${dateLabel(booking.checkOut)}`;
    const remaining = daysUntil(booking.checkIn);
    $('#guestStayCountdown').textContent = remaining > 1
      ? t('countdownDays', { n: remaining })
      : remaining === 1
        ? t('countdownTomorrow')
        : remaining === 0
          ? t('countdownToday')
          : t('countdownInStay');
    $('#guestWelcomeCopy').textContent = booking.demo ? t('welcomeDemo') : t('welcomeReady');

    const statusKey = {
      confirmed: 'statusConfirmed',
      pending: 'statusPending',
      checked_in: 'statusCheckedIn',
      checked_out: 'statusCheckedOut',
      cancelled: 'statusCancelled',
      canceled: 'statusCancelled'
    }[booking.status];
    $('#bookingStatusBadge').textContent = statusKey ? t(statusKey) : (booking.status || '');

    $('#homeRoomName').textContent = booking.roomName || t('defaultRoomName');
    $('#homeBookingCode').textContent = t('bookingLabel', { code: booking.bookingCode });
    $('#homeCheckIn').textContent = dateLabel(booking.checkIn);
    $('#homeCheckOut').textContent = dateLabel(booking.checkOut);
    $('#homeNights').textContent = String(booking.nights || '—');
    $('#manageBookingCode').textContent = booking.bookingCode;
    $('#manageGuestName').textContent = booking.guestName || '—';
    $('#manageRoomName').textContent = roomLabel(booking);
    $('#manageDates').textContent = `${dateLabel(booking.checkIn)} — ${dateLabel(booking.checkOut)}`;
    $('#manageTotal').textContent = money(booking.totalAmount);

    const firstNameInput = $('[name="firstName"]');
    const lastNameInput = $('[name="lastName"]');
    const parts = String(booking.guestName || '').trim().split(/\s+/);
    if (firstNameInput && !firstNameInput.value) firstNameInput.value = parts.shift() || '';
    if (lastNameInput && !lastNameInput.value) lastNameInput.value = parts.join(' ');
    if ($('#signedName') && !$('#signedName').value) $('#signedName').value = booking.guestName || '';
  }

  /* "Pagar en línea" solo aparece si el modo de pago de servicios lo soporta
     (la sesión trae booking.onlinePayment desde GUEST_SERVICE_PAYMENT_MODE). Con
     room_charge solo queda "Cargar a mi cuenta". */
  function renderPaymentOptions() {
    const select = $('#paymentPreference');
    if (!select) return;
    const online = Boolean(state.booking && state.booking.onlinePayment);
    select.innerHTML = '';
    const add = (value, label) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    };
    add('account', t('payAccount'));
    if (online) add('online', t('payOnline'));
    select.value = 'account';
  }

  function renderCheckinProgress() {
    const pill = $('#checkinProgress');
    if (!pill) return;
    if (state.contractSigned) pill.textContent = t('processComplete');
    else if (state.checkinId) pill.textContent = t('checkinCompleteBadge');
    else pill.textContent = t('stepProgress', { n: 1 });
  }

  function showApp() {
    $('#guestAccess').hidden = true;
    $('#guestShell').hidden = false;
    $('#guestLogout').hidden = false;
    document.body.classList.add('guest-is-authenticated');
    renderBooking();
    renderServicePrices();
    renderPaymentOptions();
    renderCart();
    initializeGuestSlots();
    updateUploadAvailability();
    renderCheckinProgress();
    if (state.checkinId && !state.contractSigned) {
      setStatus($('#checkinStatus'), t('checkinAlreadyDone'), 'success');
    }
    updateContractAvailability();
    if (window.lucide) window.lucide.createIcons();
  }

  function showLogin() {
    $('#guestAccess').hidden = false;
    $('#guestShell').hidden = true;
    $('#guestLogout').hidden = true;
    document.body.classList.remove('guest-is-authenticated');
  }

  function openTab(tabName) {
    $$('[data-guest-panel]').forEach(panel => {
      panel.classList.toggle('is-active', panel.dataset.guestPanel === tabName);
    });
    $$('[data-guest-tab]').forEach(button => {
      button.classList.toggle('is-active', button.dataset.guestTab === tabName);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(t('fileReadError')));
      reader.readAsDataURL(file);
    });
  }

  function dataUrlToImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(t('imageReadError')));
      image.src = dataUrl;
    });
  }

  function canvasToBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error(t('photoPrepareError')));
      }, 'image/jpeg', quality || CAMERA_QUALITY);
    });
  }

  function drawCover(source, canvas) {
    const context = canvas.getContext('2d');
    const sourceWidth = source.videoWidth || source.naturalWidth || source.width;
    const sourceHeight = source.videoHeight || source.naturalHeight || source.height;
    const targetRatio = CAMERA_WIDTH / CAMERA_HEIGHT;
    const sourceRatio = sourceWidth / sourceHeight;
    let sx = 0;
    let sy = 0;
    let sw = sourceWidth;
    let sh = sourceHeight;
    if (sourceRatio > targetRatio) {
      sw = sourceHeight * targetRatio;
      sx = (sourceWidth - sw) / 2;
    } else {
      sh = sourceWidth / targetRatio;
      sy = (sourceHeight - sh) / 2;
    }
    context.drawImage(source, sx, sy, sw, sh, 0, 0, CAMERA_WIDTH, CAMERA_HEIGHT);
  }

  function photoMetrics(canvas) {
    const sample = document.createElement('canvas');
    sample.width = 320;
    sample.height = 201;
    const sampleContext = sample.getContext('2d', { willReadFrequently: true });
    sampleContext.drawImage(canvas, 0, 0, sample.width, sample.height);
    const { data } = sampleContext.getImageData(0, 0, sample.width, sample.height);
    const gray = new Float32Array(sample.width * sample.height);
    let brightness = 0;
    for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
      const value = (data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114);
      gray[p] = value;
      brightness += value;
    }
    brightness /= gray.length;

    let count = 0;
    let mean = 0;
    let m2 = 0;
    for (let y = 1; y < sample.height - 1; y += 1) {
      for (let x = 1; x < sample.width - 1; x += 1) {
        const idx = (y * sample.width) + x;
        const laplacian = (-4 * gray[idx]) + gray[idx - 1] + gray[idx + 1] + gray[idx - sample.width] + gray[idx + sample.width];
        count += 1;
        const delta = laplacian - mean;
        mean += delta / count;
        m2 += delta * (laplacian - mean);
      }
    }
    return { brightness, laplacianVariance: count > 1 ? m2 / (count - 1) : 0 };
  }

  function validateCameraCanvas(canvas) {
    const metrics = photoMetrics(canvas);
    if (metrics.brightness < 30 || metrics.brightness > 220) {
      throw Object.assign(new Error(t('photoTooDark')), { code: 'photo-too-dark' });
    }
    if (metrics.laplacianVariance < 100) {
      throw Object.assign(new Error(t('photoBlurry')), { code: 'photo-blurry' });
    }
  }

  async function documentFromCanvas(canvas) {
    validateCameraCanvas(canvas);
    const blob = await canvasToBlob(canvas);
    const dataUrl = canvas.toDataURL('image/jpeg', CAMERA_QUALITY);
    return {
      name: `documento-${Date.now()}.jpg`,
      type: 'image/jpeg',
      size: blob.size,
      dataUrl
    };
  }

  async function imageFileToCameraDocument(file) {
    const dataUrl = await fileToDataUrl(file);
    const image = await dataUrlToImage(dataUrl);
    const canvas = $('#cameraCanvas');
    canvas.width = CAMERA_WIDTH;
    canvas.height = CAMERA_HEIGHT;
    drawCover(image, canvas);
    return documentFromCanvas(canvas);
  }

  /* Archivo elegido desde el computador (o la galería): los PDF pasan tal cual;
     las imágenes se reescalan (sin recortar, a diferencia de la cámara) y se
     recomprimen a JPEG para que el envío quede liviano. Si el navegador no puede
     decodificar la imagen, se envía el archivo original y el servidor decide. */
  async function fileToUploadDocument(file) {
    const original = async () => ({
      name: file.name,
      type: file.type,
      size: file.size,
      dataUrl: await fileToDataUrl(file)
    });
    if (!/^image\/(jpeg|png)$/i.test(file.type || '')) return original();
    const dataUrl = await fileToDataUrl(file);
    let image;
    try {
      image = await dataUrlToImage(dataUrl);
    } catch (error) {
      return { name: file.name, type: file.type, size: file.size, dataUrl };
    }
    const width = image.naturalWidth || image.width || 0;
    const height = image.naturalHeight || image.height || 0;
    if (!width || !height) return { name: file.name, type: file.type, size: file.size, dataUrl };
    const scale = Math.min(1, UPLOAD_MAX_SIDE / Math.max(width, height));
    if (scale === 1 && file.size <= 1.5 * 1024 * 1024) {
      return { name: file.name, type: file.type, size: file.size, dataUrl };
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas, UPLOAD_QUALITY);
    return {
      name: `${String(file.name || 'documento').replace(/\.[^.]+$/, '')}.jpg`,
      type: 'image/jpeg',
      size: blob.size,
      dataUrl: canvas.toDataURL('image/jpeg', UPLOAD_QUALITY)
    };
  }

  function setDocument(documentPayload, message) {
    const slot = activeSlot();
    state.document = documentPayload;
    if (slot) {
      slot.document = documentPayload;
      slot.documentRef = null;
      slot.status = 'pending';
    }
    $('#uploadTitle').textContent = documentPayload.name;
    $('#uploadMeta').textContent = t('docReadyMeta', { size: sizeMb(documentPayload.size) });
    $('#analyzeDocument').disabled = false;
    setStatus($('#ocrStatus'), message || t('docLoaded'), 'success');
    renderGuestCards();
  }

  async function handleDocumentSelection(event) {
    const file = event.target.files && event.target.files[0];
    const slot = activeSlot();
    state.document = null;
    if (slot) {
      slot.document = null;
      slot.documentRef = null;
      slot.status = 'empty';
      slot.analysisSource = '';
      slot.confidence = 0;
    }
    $('#analyzeDocument').disabled = true;
    if (!file) return;
    try {
      const documentPayload = await fileToUploadDocument(file);
      event.target.value = '';
      if (documentPayload.size > MAX_FILE_BYTES) {
        setStatus($('#ocrStatus'), t('fileTooLarge'), 'error');
        return;
      }
      setDocument(documentPayload);
    } catch (error) {
      event.target.value = '';
      setStatus($('#ocrStatus'), error.message, 'error');
    }
  }

  async function handleNativeCameraSelection(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      const documentPayload = await imageFileToCameraDocument(file);
      setDocument(documentPayload, t('photoReady'));
    } catch (error) {
      setStatus($('#ocrStatus'), error.message, 'error');
    }
  }

  function isCoarsePointer() {
    return Boolean(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  }

  /* El botón "Subir archivo" se muestra en computador (puntero fino) y en
     cualquier equipo donde la cámara no abrió. En el celular la captura guiada
     sigue siendo la vía principal. */
  function updateUploadAvailability() {
    const button = $('#uploadDocument');
    if (!button) return;
    button.hidden = !(state.cameraFailed || !isCoarsePointer());
  }

  function setCameraStatus(message, type) {
    setStatus($('#cameraStatus'), message, type);
    $('#retakePhoto').hidden = type !== 'error';
  }

  function stopCamera() {
    if (state.cameraStream) {
      state.cameraStream.getTracks().forEach(track => track.stop());
      state.cameraStream = null;
    }
    const preview = $('#cameraPreview');
    if (preview) preview.srcObject = null;
  }

  function closeCamera() {
    stopCameraGuidance();
    stopCamera();
    $('#cameraModal').hidden = true;
    document.body.classList.remove('guest-camera-open');
    setCameraStatus('', '');
  }

  /* ── Guía de calidad EN VIVO mientras se escanea el documento ──────────────
     Muestrea el <video> en vivo y actualiza #cameraGuide con avisos en tiempo
     real (brillo/desenfoque/reflejos) ANTES de capturar, para reducir fallos
     de lectura. Reusa photoMetrics() + un chequeo de destellos. */
  function cameraGuidanceMetrics(video) {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 200;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, c.width, c.height);
    const m = photoMetrics(c);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let glare = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 245 && data[i + 1] > 245 && data[i + 2] > 245) glare += 1;
    }
    return { brightness: m.brightness, laplacianVariance: m.laplacianVariance, glareRatio: glare / (c.width * c.height) };
  }

  function updateCameraGuide() {
    const preview = $('#cameraPreview');
    const guide = $('#cameraGuide');
    if (!guide || !preview || !preview.videoWidth) return;
    let key = 'cameraGuideHold';
    let ready = false;
    try {
      const m = cameraGuidanceMetrics(preview);
      if (m.brightness < 55) key = 'cameraGuideTooDark';
      else if (m.brightness > 205) key = 'cameraGuideTooBright';
      else if (m.glareRatio > 0.04) key = 'cameraGuideGlare';
      else if (m.laplacianVariance < 90) key = 'cameraGuideFocus';
      else { key = 'cameraGuideReady'; ready = true; }
    } catch (e) { key = 'cameraGuideHold'; }
    guide.textContent = t(key);
    guide.dataset.state = ready ? 'ready' : 'adjust';
  }

  function startCameraGuidance() {
    stopCameraGuidance();
    const guide = $('#cameraGuide');
    if (guide) { guide.textContent = t('cameraGuideHold'); guide.dataset.state = 'adjust'; }
    state.cameraGuideTimer = setInterval(updateCameraGuide, 450);
  }

  function stopCameraGuidance() {
    if (state.cameraGuideTimer) { clearInterval(state.cameraGuideTimer); state.cameraGuideTimer = null; }
  }

  async function requestCamera(facingMode) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error(t('cameraUnavailable'));
    }
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: CAMERA_WIDTH },
        height: { ideal: CAMERA_HEIGHT }
      }
    });
  }

  async function startCamera() {
    let stream;
    try {
      stream = await requestCamera('environment');
    } catch (error) {
      stream = await requestCamera('user');
    }
    state.cameraStream = stream;
    const preview = $('#cameraPreview');
    preview.srcObject = stream;
    await preview.play();
  }

  async function openCamera() {
    setStatus($('#ocrStatus'), '', '');
    $('#retakePhoto').hidden = true;
    $('#cameraModal').hidden = false;
    document.body.classList.add('guest-camera-open');
    setCameraStatus('', '');
    try {
      await startCamera();
      startCameraGuidance();
    } catch (error) {
      closeCamera();
      state.cameraFailed = true;
      updateUploadAvailability();
      if (isCoarsePointer()) {
        $('#cameraFileCapture').click();
      } else {
        setStatus($('#ocrStatus'), t('cameraUnavailable'), 'error');
      }
    }
  }

  async function capturePhoto() {
    const preview = $('#cameraPreview');
    const canvas = $('#cameraCanvas');
    if (!preview.videoWidth || !preview.videoHeight) return;
    try {
      canvas.width = CAMERA_WIDTH;
      canvas.height = CAMERA_HEIGHT;
      drawCover(preview, canvas);
      const documentPayload = await documentFromCanvas(canvas);
      setDocument(documentPayload, t('photoReady'));
      closeCamera();
    } catch (error) {
      setCameraStatus(error.message, 'error');
    }
  }

  function normalizeDocumentTypeOption(value) {
    const normalizeOption = input => String(input || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    const documentAliases = {
      cc: 'cc',
      'cedula': 'cc',
      'cedula ciudadania': 'cc',
      'cedula de ciudadania': 'cc',
      'cedula colombiana': 'cc',
      'documento nacional': 'cc',
      'id': 'cc',
      'id card': 'cc',
      'identity card': 'cc',
      'national id': 'cc',
      'national identity card': 'cc',
      'iddocument nationalidentitycard': 'cc',
      ce: 'ce',
      'cedula extranjeria': 'ce',
      'cedula de extranjeria': 'ce',
      'residence permit': 'ce',
      'iddocument residencepermit': 'ce',
      passport: 'pasaporte',
      'iddocument passport': 'pasaporte',
      'driver license': 'licencia',
      'drivers license': 'licencia',
      'licencia de conduccion': 'licencia',
      'iddocument driverlicense': 'licencia'
    };
    const normalized = normalizeOption(value);
    const comparable = documentAliases[normalized] || normalized;
    const field = $('[name="documentType"]');
    const options = field ? Array.from(field.options) : [];
    const option = options.find(item => {
      const candidate = normalizeOption(item.value);
      if (!candidate) return false;
      return candidate === comparable ||
        comparable.includes(candidate) ||
        candidate.includes(comparable);
    });
    return option ? option.value : '';
  }

  function applyExtractedToGuest(guest, extracted) {
    Object.entries(extracted || {}).forEach(([name, value]) => {
      if (!value) return;
      if (name === 'documentType') {
        const normalized = normalizeDocumentTypeOption(value);
        if (normalized) guest.documentType = normalized;
      } else if (!guest[name]) {
        guest[name] = value;
      }
    });
  }

  /* Requisitos del formulario según el huésped ACTIVO, alineados con
     guest-checkin.validateGuest:
       - vencimiento obligatorio solo para pasaportes;
       - destino al salir obligatorio solo para extranjeros;
       - correo, WhatsApp y aceptación de privacidad NO se exigen a menores
         (los aporta el adulto responsable). */
  function updateFieldRequirements() {
    const documentType = $('[name="documentType"]');
    const expirationDate = $('[name="expirationDate"]');
    if (documentType && expirationDate) expirationDate.required = documentType.value === 'Pasaporte';
    const destination = $('[name="destination"]');
    const nationality = $('[name="nationality"]');
    if (destination) destination.required = Boolean(nationality && isForeignNationality(nationality.value));
    const birthDate = $('[name="birthDate"]');
    const minor = Boolean(birthDate && isMinorGuest({ birthDate: birthDate.value }));
    ['email', 'phone', 'privacyAccepted'].forEach(name => {
      const field = $(`[name="${name}"]`);
      if (field) field.required = !minor;
    });
    $$('.guest-adult-required').forEach(mark => { mark.hidden = minor; });
    const hint = $('#minorContactHint');
    if (hint) hint.hidden = !minor;
  }

  async function analyzeDocument() {
    if (!state.document) return;
    const button = $('#analyzeDocument');
    const analysisGuestIndex = state.activeGuestIndex;
    const analysisSlot = state.guestSlots[analysisGuestIndex];
    const analysisDocument = analysisSlot && analysisSlot.document;
    if (!analysisSlot || !analysisDocument) return;
    setButtonLoading(button, true, t('ocrReading'));
    setStatus($('#ocrStatus'), t('ocrValidating'), 'loading');
    try {
      let data;
      if (state.token === 'local-demo-token') {
        await new Promise(resolve => setTimeout(resolve, 700));
        data = {
          source: 'manual',
          documentRef: { key: `local-demo/${analysisGuestIndex}`, name: analysisDocument.name },
          extracted: {},
          confidence: 0,
          validation: { missing: [] }
        };
      } else {
        data = await request(API.checkin, {
          method: 'POST',
          body: JSON.stringify({
            mode: 'analyze',
            file: analysisDocument,
            guest: {},
            slotIndex: analysisGuestIndex
          })
        });
      }
      const MAX_OCR_ATTEMPTS = 3;
      const targetSlot = state.guestSlots[analysisGuestIndex];
      if (targetSlot) {
        applyExtractedToGuest(targetSlot.guest, data.extracted);
        targetSlot.documentRef = data.documentRef || null;
        targetSlot.analysisSource = data.source || '';
        targetSlot.confidence = Number(data.confidence || 0);
        targetSlot.status = data.source === 'azure' ? 'ocr' : 'pending';
        /* Cuenta solo intentos REALES contra Azure (no demo ni OCR sin configurar). */
        if (data.source === 'azure' || data.source === 'azure-error') {
          targetSlot.ocrAttempts = (targetSlot.ocrAttempts || 0) + 1;
        }
        if (data.source === 'azure') targetSlot.manualReview = false;
        else if (data.source === 'azure-error' && targetSlot.ocrAttempts >= MAX_OCR_ATTEMPTS) targetSlot.manualReview = true;
        targetSlot.isMinor = isMinorGuest(targetSlot.guest);
      }
      if (state.activeGuestIndex === analysisGuestIndex) {
        loadActiveGuestIntoForm();
      }
      recomputeMinorParentPresence();
      renderGuestCards();
      const azureFailed = data.source === 'azure-error';
      const manualReviewNow = Boolean(targetSlot && targetSlot.manualReview);
      const notice = $('#manualReviewNotice');
      if (notice) {
        notice.hidden = !manualReviewNow;
        if (manualReviewNow) notice.textContent = t('ocrManualReviewNotice');
      }
      if (manualReviewNow) {
        /* Tras 3 fallos: no se bloquea — el huésped completa a mano y puede enviar. */
        setStatus($('#ocrStatus'), t('ocrAttemptsExhausted'), '');
      } else {
        const text = data.source === 'azure'
          ? t('ocrReadOk', { confidence: data.confidence || 0 })
          : azureFailed
            ? t('ocrReadFailed')
            : t('ocrNotConfigured');
        setStatus($('#ocrStatus'), text, data.source === 'azure' ? 'success' : azureFailed ? 'error' : '');
      }
      if (!state.checkinId) $('#checkinProgress').textContent = t('stepProgress', { n: 2 });
    } catch (error) {
      setStatus($('#ocrStatus'), error.message, 'error');
    } finally {
      setButtonLoading(button, false);
    }
  }

  /* Revisión de un huésped en el cliente, alineada con guest-checkin.validateGuest
     para que el servidor no tenga que devolver un 422 con nombres técnicos. */
  function guestIssues(slot) {
    const guest = slot && slot.guest ? slot.guest : {};
    const minor = isMinorGuest(guest);
    const required = [
      'firstName',
      'lastName',
      'documentType',
      'documentNumber',
      'birthDate',
      'nationality',
      ...(minor ? [] : ['email', 'phone'])
    ];
    const missing = required.filter(field => !String(guest[field] || '').trim());
    if (isForeignNationality(guest.nationality) && !String(guest.destination || '').trim()) {
      missing.push('destination');
    }
    if (guest.documentType === 'Pasaporte' && !guest.expirationDate) missing.push('expirationDate');
    if (!minor && !guest.privacyAccepted) missing.push('privacyAccepted');
    /* Tras 3 lecturas fallidas (manualReview) ya no exigimos la referencia del OCR:
       el huésped completa los datos a mano y recepción verifica luego. */
    const missingDocumentRef = Boolean(slot && slot.document && !slot.documentRef && !slot.manualReview);
    const invalidEmail = Boolean(guest.email && !EMAIL_RE.test(guest.email));
    const expired = hasExpiredDocument(guest);
    return {
      missing,
      missingDocumentRef,
      invalidEmail,
      expired,
      hasIssues: missing.length > 0 || missingDocumentRef || invalidEmail || expired
    };
  }

  function guestNeedsReview(slot) {
    return guestIssues(slot).hasIssues;
  }

  function hasExpiredDocument(guest) {
    if (!guest || !guest.expirationDate) return false;
    const expiry = new Date(`${guest.expirationDate}T23:59:59`);
    return !Number.isNaN(expiry.getTime()) && expiry < new Date();
  }

  function fieldLabels(fields) {
    return fields.map(field => (FIELD_LABEL_KEYS[field] ? t(FIELD_LABEL_KEYS[field]) : field));
  }

  function issueMessage(slot, index) {
    const issues = guestIssues(slot);
    const name = slotLabel(slot, index);
    if (issues.expired) return t('documentExpired');
    if (issues.missingDocumentRef) return t('analyzeRequired', { name });
    if (issues.missing.includes('destination')) return t('destinationRequired', { name });
    if (issues.invalidEmail) return t('invalidEmail', { name });
    if (issues.missing.length === 1 && issues.missing[0] === 'expirationDate') {
      return t('passportExpiryRequired', { name });
    }
    const fields = fieldLabels(issues.missing).join(', ');
    return fields
      ? `${t('requiredFieldsMissing')} ${t('reviewFields', { fields: `${name}: ${fields}` })}`
      : t('requiredFieldsMissing');
  }

  /* validation.missing del servidor ("guests.0.destination") → texto legible. */
  function describeServerMissing(missing) {
    const byGuest = new Map();
    (missing || []).forEach(entry => {
      const match = /^guests\.(\d+)\.(\w+)$/.exec(String(entry));
      if (!match) return;
      const index = Number(match[1]);
      if (!byGuest.has(index)) byGuest.set(index, []);
      byGuest.get(index).push(match[2]);
    });
    return Array.from(byGuest.entries()).map(([index, fields]) => (
      `${slotLabel(state.guestSlots[index], index)}: ${fieldLabels(fields).join(', ')}`
    )).join(' · ');
  }

  async function submitCheckin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    saveActiveGuestFromForm();
    const missingDocumentIndex = state.guestSlots.findIndex(slot => !slot.document);
    if (missingDocumentIndex >= 0) {
      selectGuestSlot(missingDocumentIndex);
      setStatus($('#checkinStatus'), t('missingDocuments'), 'error');
      return;
    }
    const incompleteGuestIndex = state.guestSlots.findIndex(guestNeedsReview);
    if (incompleteGuestIndex >= 0) {
      selectGuestSlot(incompleteGuestIndex);
      updateFieldRequirements();
      form.reportValidity();
      setStatus($('#checkinStatus'), issueMessage(state.guestSlots[incompleteGuestIndex], incompleteGuestIndex), 'error');
      return;
    }
    updateFieldRequirements();
    recomputeMinorParentPresence();
    const minorBlockingIndex = state.guestSlots.findIndex(slot => {
      if (!slot.isMinor) return false;
      if (!slot.registroCivilDocumentRef) return true;
      if (!slot.parentPresent && !slot.authorizationDocumentRef) return true;
      return false;
    });
    if (minorBlockingIndex >= 0) {
      selectGuestSlot(minorBlockingIndex);
      setStatus($('#checkinStatus'), t('minorBlockingNotice'), 'error');
      return;
    }
    if (!form.reportValidity()) {
      setStatus($('#checkinStatus'), t('requiredFieldsMissing'), 'error');
      return;
    }

    setButtonLoading(button, true, t('submittingCheckin'));
    setStatus($('#checkinStatus'), t('validatingData'), 'loading');
    try {
      let data;
      if (state.token === 'local-demo-token') {
        await new Promise(resolve => setTimeout(resolve, 850));
        data = { checkinId: 'CHK-DEMO-2026', documentAnalysis: 'manual' };
      } else {
        data = await request(API.checkin, {
          method: 'POST',
          body: JSON.stringify({
            mode: 'submit',
            lang: currentLang(),
            /* Consentimiento de marketing del check-in (separado del operativo). */
            marketingAccepted: state.marketingAccepted === true,
            guests: state.guestSlots.map(slot => ({
              guest: { ...slot.guest },
              file: slot.documentRef ? undefined : slot.document,
              documentRef: slot.documentRef || undefined,
              isPrimary: slot.isPrimary,
              analysisSource: slot.analysisSource || 'manual',
              confidence: slot.confidence || 0,
              ocrAttempts: slot.ocrAttempts || 0,
              manualReview: slot.manualReview || false,
              registroCivilDocumentRef: slot.isMinor ? slot.registroCivilDocumentRef : undefined,
              authorizationDocumentRef: slot.isMinor ? slot.authorizationDocumentRef : undefined,
              fatherName: slot.isMinor ? slot.fatherName : undefined,
              motherName: slot.isMinor ? slot.motherName : undefined
            }))
          })
        });
      }
      const reviewSuffix = data.manualReview ? ' ' + t('ocrManualReviewNotice') : '';
      setStatus($('#checkinStatus'), `${t('checkinReceived', { code: data.checkinId })}${reviewSuffix}`, 'success');
      state.checkinId = String(data.checkinId || '');
      /* Un check-in nuevo cambia los datos del contrato: si ya se había leído, hay
         que volver a leerlo (el servidor compara el hash). */
      state.previewHash = '';
      state.previewHtml = '';
      if (!state.contractSigned) setContractGate(false);
      saveSession();
      renderCheckinProgress();
      $('#bookingStatusBadge').textContent = t('preCheckinReady');
      updateContractAvailability();
    } catch (error) {
      const missing = error.data && error.data.validation && error.data.validation.missing;
      const detail = missing && missing.length ? describeServerMissing(missing) : '';
      setStatus($('#checkinStatus'), detail ? `${error.message} ${t('reviewFields', { fields: detail })}` : error.message, 'error');
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function submitAction(payload, statusElement, button, successMessage) {
    setButtonLoading(button, true, t('sending'));
    setStatus(statusElement, t('registeringRequest'), 'loading');
    try {
      let data;
      if (state.token === 'local-demo-token') {
        await new Promise(resolve => setTimeout(resolve, 550));
        data = { eventId: `GST-DEMO-${Date.now()}`, total: cartTotal() };
      } else {
        data = await request(API.action, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }
      setStatus(statusElement, t('eventCode', { message: successMessage, code: data.eventId }), 'success');
      return data;
    } catch (error) {
      setStatus(statusElement, error.message, 'error');
      return null;
    } finally {
      setButtonLoading(button, false);
    }
  }

  /* ── Contrato ─────────────────────────────────────────────────────────────
     Se ve y se firma DESPUÉS del check-in: el servidor arma el contrato con los
     huéspedes registrados en ese check-in, devuelve el HTML exacto que se
     muestra y su SHA-256 (previewHash). Al firmar se envía ese hash; si el
     contrato cambió desde que se leyó, el servidor responde 409 y se pide
     leerlo de nuevo. */
  function updateContractAvailability() {
    const openBtn = $('#openContract');
    const gateMsg = $('#contractGate');
    const signBtn = $('#signContract');
    const signedDownload = $('#downloadSignedContract');
    const ready = Boolean(state.checkinId);
    if (openBtn) openBtn.disabled = !ready;
    if (signedDownload) signedDownload.hidden = !(state.signedPdf && state.signedPdf.base64);
    if (signBtn && !state.contractSigned) {
      if (!signBtn.dataset.defaultLabel) signBtn.dataset.defaultLabel = signBtn.innerHTML;
      else if (signBtn.innerHTML !== signBtn.dataset.defaultLabel && !signBtn.querySelector('.guest-spinner')) {
        signBtn.innerHTML = signBtn.dataset.defaultLabel;
      }
    }
    if (state.contractSigned) {
      if (signBtn) {
        signBtn.textContent = t('contractSignedButton');
        signBtn.disabled = true;
      }
      const accepted = $('#contractAccepted');
      if (accepted) accepted.disabled = true;
      if (gateMsg) {
        gateMsg.textContent = t('contractSigned');
        gateMsg.classList.remove('is-error');
        gateMsg.classList.add('is-success');
      }
      return;
    }
    if (!ready) {
      if (signBtn) signBtn.disabled = true;
      if (gateMsg) {
        gateMsg.textContent = t('contractNeedsCheckin');
        gateMsg.classList.add('is-error');
        gateMsg.classList.remove('is-success');
      }
      return;
    }
    setContractGate(state.contractRead && Boolean(state.previewHash));
  }

  function setContractGate(read) {
    state.contractRead = Boolean(read);
    if (read && !state.contractAcknowledgedAt) {
      state.contractAcknowledgedAt = new Date().toISOString();
    }
    if (!read) state.contractAcknowledgedAt = '';
    const ackInput = $('#contractAcknowledge');
    const acceptedInput = $('#contractAccepted');
    const signBtn = $('#signContract');
    const gateMsg = $('#contractGate');
    const hint = $('#contractHint');
    /* The acknowledge checkbox is the manual "I have read" control, so it
       must stay enabled at all times — it is one of the two ways to satisfy
       the gate (the other being scrolling to the end). Only the downstream
       sign controls are toggled by the gate state. */
    if (read) {
      if (ackInput) ackInput.checked = true;
      if (acceptedInput) acceptedInput.disabled = false;
      if (signBtn) signBtn.disabled = !state.checkinId || state.contractSigned;
      if (gateMsg) {
        gateMsg.textContent = t('contractReadConfirmation');
        gateMsg.classList.remove('is-error');
        gateMsg.classList.add('is-success');
      }
      if (hint) hint.textContent = t('contractModalReadyHint');
    } else {
      if (ackInput) ackInput.checked = false;
      if (acceptedInput) { acceptedInput.disabled = true; acceptedInput.checked = false; }
      if (signBtn) signBtn.disabled = true;
      if (gateMsg) {
        gateMsg.textContent = state.checkinId ? t('contractAcknowledgeBlocked') : t('contractNeedsCheckin');
        gateMsg.classList.add('is-error');
        gateMsg.classList.remove('is-success');
      }
      if (hint) hint.textContent = t('contractModalScrollHint');
    }
  }

  function contractPayload(extra) {
    return {
      lang: currentLang(),
      checkinId: state.checkinId,
      contractVersion: CONTRACT_VERSION,
      ...(extra || {})
    };
  }

  async function openContractModal() {
    if (!state.checkinId) {
      setStatus($('#contractStatus'), t('contractNeedsCheckin'), 'error');
      return;
    }
    saveActiveGuestFromForm();
    const body = $('#contractBody');
    const modal = $('#contractModal');
    if (!body || !modal) return;

    body.innerHTML = `<div class="guest-spinner-container" style="display:grid;place-items:center;min-height:220px;">
      <span class="guest-spinner" aria-hidden="true"></span>
      <p style="margin-top:12px;font-size:13px;color:var(--ink-500);text-align:center;">${escHtml(t('contractLoading'))}</p>
    </div>`;
    modal.hidden = false;
    document.body.classList.add('guest-modal-open');

    try {
      const data = await request(API.action, {
        method: 'POST',
        body: JSON.stringify(contractPayload({ type: 'contract_preview' }))
      });

      if (!data || !data.html) throw new Error(t('contractPreviewError'));

      /* Si el contrato cambió respecto al que ya se había leído, la lectura no
         vale: hay que volver a leerlo. */
      if (state.previewHash && data.contractHash && data.contractHash !== state.previewHash) {
        setContractGate(false);
      }
      state.previewHtml = data.html;
      state.previewHash = data.contractHash || '';

      const iframe = document.createElement('iframe');
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = 'none';
      iframe.style.minHeight = '420px';
      iframe.style.background = 'white';
      iframe.title = t('contractModalTitle');
      body.innerHTML = '';
      body.appendChild(iframe);

      const iframeDoc = iframe.contentWindow.document;
      iframeDoc.open();
      iframeDoc.write(data.html);
      iframeDoc.close();

      /* If they already acknowledged once during this session, keep the
         acknowledgement; otherwise reset visual hint. */
      if (state.contractRead) {
        setContractGate(true);
      } else {
        const hint = $('#contractHint');
        if (hint) hint.textContent = t('contractModalScrollHint');
      }

      /* Defer scroll-end detection wiring until next tick so layout settles. */
      requestAnimationFrame(() => {
        iframe.contentWindow.scrollTo(0, 0);
        attachContractScrollWatcher(iframe);
      });
    } catch (e) {
      console.error('[guest-app] failed to load contract preview:', e);
      /* Ya firmado (p. ej. en otro dispositivo): se refleja en la app. */
      if (e && e.code === 'contract_already_signed') markContractAlreadySigned();
      body.innerHTML = `<div style="text-align:center;padding:40px;color:var(--terracotta);">
        <p>${escHtml(e && e.message ? e.message : t('contractPreviewError'))}</p>
        <button class="btn btn-ghost-dark" type="button" data-contract-retry>${escHtml(t('retry'))}</button>
      </div>`;
      const retry = body.querySelector('[data-contract-retry]');
      if (retry) retry.addEventListener('click', openContractModal);
    }
  }

  function closeContractModal() {
    const modal = $('#contractModal');
    if (modal) modal.hidden = true;
    document.body.classList.remove('guest-modal-open');
    /* Tear down the scroll-end observer so a hidden modal doesn't keep a
       live observer (and its sentinel reference) around between openings. */
    const body = $('#contractBody');
    const iframe = body && body.querySelector('iframe');
    if (iframe && iframe._contractObserver) {
      iframe._contractObserver.disconnect();
      iframe._contractObserver = null;
    }
  }

  function attachContractScrollWatcher(iframe) {
    if (!iframe) return;
    const iframeDoc = iframe.contentWindow.document;
    const sentinel = iframeDoc.querySelector('#contractEnd');
    if (!sentinel) return;
    if (iframe._contractObserver) iframe._contractObserver.disconnect();
    iframe._contractObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting && state.previewHash) setContractGate(true);
      });
    }, { threshold: 0.9 });
    iframe._contractObserver.observe(sentinel);
  }

  function base64ToBlob(base64, type) {
    const binary = atob(String(base64 || ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: type || 'application/pdf' });
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /* PDF real generado en el servidor (_pdf-render). Antes de firmar sale como
     borrador; después de firmar se descarga la copia firmada. */
  async function downloadContractPDF() {
    const button = $('#downloadContract');
    setButtonLoading(button, true, t('contractPdfPreparing'));
    try {
      const data = await request(API.action, {
        method: 'POST',
        body: JSON.stringify(contractPayload({ type: 'contract_preview', format: 'pdf' }))
      });
      if (!data || !data.pdfBase64) throw new Error(t('contractPdfError'));
      triggerDownload(base64ToBlob(data.pdfBase64), data.filename || 'contrato-estar.pdf');
    } catch (error) {
      setStatus($('#contractHint'), error.message || t('contractPdfError'), 'error');
    } finally {
      setButtonLoading(button, false);
    }
  }

  /* El servidor dice que el contrato ya está firmado (otra pestaña u otro
     dispositivo): se marca como firmado para no ofrecer otra firma. */
  function markContractAlreadySigned() {
    if (state.contractSigned) return;
    state.contractSigned = true;
    saveSession();
    renderCheckinProgress();
    updateContractAvailability();
  }

  function downloadSignedContract() {
    if (!state.signedPdf || !state.signedPdf.base64) return;
    triggerDownload(base64ToBlob(state.signedPdf.base64), state.signedPdf.filename || 'contrato-estar-firmado.pdf');
  }

  async function signContract() {
    const button = $('#signContract');
    const statusEl = $('#contractStatus');
    const signedName = $('#signedName').value.trim();
    const acceptedTerms = $('#contractAccepted').checked;
    if (!state.checkinId) {
      setStatus(statusEl, t('contractNeedsCheckin'), 'error');
      return;
    }
    if (!state.contractRead || !state.previewHash) {
      setStatus(statusEl, t('contractAcknowledgeBlocked'), 'error');
      openContractModal();
      return;
    }
    if (!signedName) {
      setStatus(statusEl, t('signNameRequired'), 'error');
      $('#signedName').focus();
      return;
    }
    if (!acceptedTerms) {
      setStatus(statusEl, t('acceptRequired'), 'error');
      $('#contractAccepted').focus();
      return;
    }
    setButtonLoading(button, true, t('sending'));
    setStatus(statusEl, t('registeringRequest'), 'loading');
    let data = null;
    try {
      data = await request(API.action, {
        method: 'POST',
        body: JSON.stringify(contractPayload({
          type: 'contract',
          signedName,
          acceptedTerms,
          previewHash: state.previewHash,
          /* Audit-trail evidence collected client-side; server re-stamps a
             server-side timestamp and adds IP + user-agent. */
          acknowledgedAt: state.contractAcknowledgedAt || new Date().toISOString()
        }))
      });
    } catch (error) {
      setButtonLoading(button, false);
      if (error.code === 'contract_changed') {
        state.previewHash = '';
        setContractGate(false);
      }
      if (error.code === 'contract_already_signed') markContractAlreadySigned();
      setStatus(statusEl, error.message, 'error');
      return;
    }
    setButtonLoading(button, false);
    state.contractSigned = true;
    if (data.pdfBase64) {
      state.signedPdf = { base64: data.pdfBase64, filename: data.pdfFilename };
      const download = $('#downloadSignedContract');
      if (download) download.hidden = false;
    }
    saveSession();
    const emailed = data.emailed ? ` ${t('contractEmailSent')}` : '';
    setStatus(statusEl, `${t('eventCode', { message: t('contractSigned'), code: data.eventId })}${emailed}`, 'success');
    renderCheckinProgress();
    updateContractAvailability();
  }

  function cartTotal() {
    return Object.values(state.cart).reduce((sum, item) => sum + item.price * item.quantity, 0);
  }

  function renderCart() {
    const items = Object.values(state.cart);
    const count = items.reduce((sum, item) => sum + item.quantity, 0);
    const countEl = $('#cartCount');
    countEl.textContent = count;
    countEl.hidden = count === 0; /* hide the badge when the cart is empty */
    $('#cartTotal').textContent = money(cartTotal());
    const container = $('#cartItems');
    if (!items.length) {
      container.innerHTML = `<p class="guest-cart-empty">${escHtml(t('cartEmpty'))}</p>`;
      return;
    }
    container.innerHTML = items.map(item => `
      <div class="guest-cart-item">
        <div><strong>${escHtml(item.name)}</strong><small>${money(item.price)} ${escHtml(t('perUnit'))}</small></div>
        <div class="guest-quantity">
          <button type="button" data-cart-change="${escHtml(item.id)}" data-delta="-1" aria-label="${escHtml(t('removeOne'))}">−</button>
          <span>${item.quantity}</span>
          <button type="button" data-cart-change="${escHtml(item.id)}" data-delta="1" aria-label="${escHtml(t('addOne'))}">+</button>
        </div>
      </div>
    `).join('');
    $$('[data-cart-change]').forEach(button => {
      button.addEventListener('click', () => {
        const item = state.cart[button.dataset.cartChange];
        item.quantity += Number(button.dataset.delta);
        if (item.quantity <= 0) delete state.cart[item.id];
        renderCart();
      });
    });
  }

  /* Resolve the price of the %-of-night services (late/early check-out) for the
     current booking. The server is the authority and re-prices every order from
     netlify/functions/guest-action.js using the SAME formula — pct × (totalAmount
     / nights), rounded to the peso — so the cart total the guest confirms always
     matches what gets registered. Flat services keep their static data-service-price.
     If the booking has no usable night base, the card is disabled (not orderable). */
  function renderServicePrices() {
    const booking = state.booking;
    const nights = Number(booking && booking.nights) || 0;
    const totalAmount = Number(booking && booking.totalAmount) || 0;
    const nightBase = nights > 0 && totalAmount > 0 ? totalAmount / nights : 0;
    $$('.guest-service-card[data-service-pct]').forEach(card => {
      const pct = Number(card.dataset.servicePct) || 0;
      const round = Number(card.dataset.serviceRound) || 0; /* early check-in → 5000 */
      const display = card.querySelector('[data-service-price-display]');
      const addBtn = card.querySelector('.guest-add-service');
      if (nightBase > 0 && pct > 0) {
        const amount = round > 0 ? Math.round(pct * nightBase / round) * round : Math.round(pct * nightBase);
        card.dataset.servicePrice = String(amount);
        /* Match the static cards' "$X.XXX" style (no space) so the grid reads
           uniformly; the cart uses money() like the rest of the app. */
        if (display) display.textContent = '$' + String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
        if (addBtn) addBtn.disabled = false;
      } else {
        delete card.dataset.servicePrice;
        if (display) display.textContent = t('pctOfNight', { pct: Math.round(pct * 100) });
        if (addBtn) addBtn.disabled = true;
      }
    });
  }

  /* Nombre visible del servicio: el título trae pares .lang-es/.lang-en (el
     build deja uno solo; sin compilar se toma el del idioma actual). */
  function serviceName(card) {
    const title = card.querySelector('h3');
    if (!title) return card.dataset.serviceId;
    const localized = title.querySelector(`.lang-${currentLang()}`);
    return (localized || title).textContent.trim();
  }

  function addService(card) {
    const id = card.dataset.serviceId;
    const price = Number(card.dataset.servicePrice);
    if (!Number.isFinite(price) || price <= 0) return; /* %-of-night card not priceable yet */
    const name = serviceName(card);
    if (!state.cart[id]) state.cart[id] = { id, price, name, quantity: 0 };
    state.cart[id].quantity += 1;
    renderCart();
    $('#guestCart').hidden = false;
  }

  async function submitOrder() {
    const items = Object.values(state.cart).map(item => ({ id: item.id, quantity: item.quantity }));
    const button = $('#submitOrder');
    const preference = $('#paymentPreference').value === 'online' && state.booking && state.booking.onlinePayment
      ? 'online'
      : 'account';
    const data = await submitAction({
      type: 'order',
      items,
      deliveryTime: $('#deliveryTime').value,
      notes: $('#orderNotes').value,
      paymentPreference: preference,
      lang: currentLang()
    }, $('#orderStatus'), button, t('orderReceived'));
    if (data) {
      state.cart = {};
      renderCart();
      $('#guestCart').hidden = true;
      if (data.paymentUrl) window.location.href = data.paymentUrl;
    }
  }

  async function submitSupport(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const result = await submitAction({
      type: 'support',
      category: data.get('category'),
      message: data.get('message'),
      lang: currentLang()
    }, $('#supportStatus'), form.querySelector('button[type="submit"]'), t('messageSent'));
    if (result) form.reset();
  }

  async function submitChange(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const result = await submitAction({
      type: 'reservation_change',
      requestKind: data.get('requestKind'),
      requestedCheckIn: data.get('requestedCheckIn'),
      requestedCheckOut: data.get('requestedCheckOut'),
      message: data.get('message'),
      lang: currentLang()
    }, $('#changeStatus'), form.querySelector('button[type="submit"]'), t('requestReceived'));
    if (result) {
      form.reset();
      $('#requestedDates').hidden = $('#requestKind').value !== 'dates';
    }
  }

  async function login(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const bookingCode = $('#bookingCode').value.trim();
    const accessKey = $('#accessKey').value.trim();
    setButtonLoading(button, true, t('consulting'));
    setStatus($('#loginStatus'), t('searchingBooking'), 'loading');
    try {
      const data = await request(API.session, {
        method: 'POST',
        body: JSON.stringify({ bookingCode, accessKey })
      });
      clearSession();
      state.token = data.token;
      state.booking = data.booking;
      state.checkinId = String((data.booking && data.booking.checkinId) || '');
      saveSession();
      setStatus($('#loginStatus'), '', '');
      showApp();
    } catch (error) {
      setStatus($('#loginStatus'), error.message, 'error');
    } finally {
      setButtonLoading(button, false);
    }
  }

  function bindEvents() {
    $('#guestLoginForm').addEventListener('submit', login);
    $('#guestLogout').addEventListener('click', () => {
      clearSession();
      showLogin();
    });
    $$('[data-guest-tab]').forEach(button => {
      button.addEventListener('click', () => openTab(button.dataset.guestTab));
    });
    $$('[data-open-tab]').forEach(button => {
      button.addEventListener('click', () => openTab(button.dataset.openTab));
    });
    $('#identityDocument').addEventListener('change', handleDocumentSelection);
    $('#cameraFileCapture').addEventListener('change', handleNativeCameraSelection);
    $('#openCamera').addEventListener('click', openCamera);
    const uploadBtn = $('#uploadDocument');
    if (uploadBtn) uploadBtn.addEventListener('click', () => $('#identityDocument').click());
    $('#closeCamera').addEventListener('click', closeCamera);
    $('#capturePhoto').addEventListener('click', capturePhoto);
    $('#retakePhoto').addEventListener('click', () => setCameraStatus('', ''));
    $('#cameraModal').addEventListener('click', event => {
      if (event.target.id === 'cameraModal') closeCamera();
    });
    $('[name="documentType"]').addEventListener('change', updateFieldRequirements);
    $('#analyzeDocument').addEventListener('click', analyzeDocument);
    $('#checkinForm').addEventListener('submit', submitCheckin);
    formFields().forEach(name => {
      const field = $(`[name="${name}"]`);
      if (field) field.addEventListener('input', () => {
        saveActiveGuestFromForm();
        if (name === 'birthDate' || name === 'nationality' || name === 'documentType') {
          updateFieldRequirements();
          renderMinorSection();
        }
        renderGuestCards();
      });
    });
    $('[name="privacyAccepted"]').addEventListener('change', () => {
      saveActiveGuestFromForm();
      renderGuestCards();
    });
    $('#occupantCount').addEventListener('change', event => setGuestSlotCount(event.target.value));
    $('#signContract').addEventListener('click', signContract);
    const openContractBtn = $('#openContract');
    if (openContractBtn) openContractBtn.addEventListener('click', openContractModal);
    const closeContractBtn = $('#closeContract');
    if (closeContractBtn) closeContractBtn.addEventListener('click', closeContractModal);
    const confirmReadBtn = $('#confirmContractRead');
    if (confirmReadBtn) confirmReadBtn.addEventListener('click', closeContractModal);
    const ackInput = $('#contractAcknowledge');
    if (ackInput) ackInput.addEventListener('change', event => setContractGate(event.target.checked && Boolean(state.previewHash)));
    const downloadBtn = $('#downloadContract');
    if (downloadBtn) downloadBtn.addEventListener('click', downloadContractPDF);
    const signedDownloadBtn = $('#downloadSignedContract');
    if (signedDownloadBtn) signedDownloadBtn.addEventListener('click', downloadSignedContract);
    const contractModal = $('#contractModal');
    if (contractModal) contractModal.addEventListener('click', event => {
      if (event.target.id === 'contractModal') closeContractModal();
    });
    $$('.guest-add-service').forEach(button => {
      button.addEventListener('click', () => addService(button.closest('.guest-service-card')));
    });
    $('#openCart').addEventListener('click', () => {
      $('#guestCart').hidden = false;
      renderCart();
    });
    $('#closeCart').addEventListener('click', () => {
      $('#guestCart').hidden = true;
    });
    $('#submitOrder').addEventListener('click', submitOrder);
    $('#supportForm').addEventListener('submit', submitSupport);
    $('#changeForm').addEventListener('submit', submitChange);
    $('#requestKind').addEventListener('change', event => {
      $('#requestedDates').hidden = event.target.value !== 'dates';
    });
    const minorRcnFile = $('#minorRcnFile');
    if (minorRcnFile) minorRcnFile.addEventListener('change', handleMinorRcnSelection);
    const minorAuthFile = $('#minorAuthFile');
    if (minorAuthFile) minorAuthFile.addEventListener('change', handleMinorAuthSelection);
    const minorRcnCamera = $('#minorRcnCamera');
    if (minorRcnCamera) minorRcnCamera.addEventListener('change', handleMinorRcnCamera);
    const openMinorRcnCameraBtn = $('#openMinorRcnCamera');
    if (openMinorRcnCameraBtn) openMinorRcnCameraBtn.addEventListener('click', () => {
      const camera = $('#minorRcnCamera');
      if (camera) camera.click();
    });
    const minorFatherInput = $('#minorFatherName');
    if (minorFatherInput) minorFatherInput.addEventListener('input', onMinorParentInput);
    const minorMotherInput = $('#minorMotherName');
    if (minorMotherInput) minorMotherInput.addEventListener('input', onMinorParentInput);
  }

  /* After paying a service order online, Wompi redirects back to
     guest.html?order=<ref>. Show a neutral confirmation (the charge lands on the
     folio asynchronously via the webhook) and clean the URL. */
  function handlePaymentReturn() {
    const params = new URLSearchParams(window.location.search);
    if (!params.get('order') || !state.token) return;
    openTab('services');
    $('#guestCart').hidden = false;
    setStatus($('#orderStatus'), t('paymentReturn'), 'success');
    if (window.history && window.history.replaceState) {
      params.delete('order');
      const q = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (q ? `?${q}` : ''));
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    applyGuestI18n();
    renderCart();
    updateFieldRequirements();
    updateUploadAvailability();
    $('#requestedDates').hidden = $('#requestKind').value !== 'dates';
    if (restoreSession()) {
      showApp();
    } else if (
      new URLSearchParams(window.location.search).get('demo') === '1' &&
      ['localhost', '127.0.0.1'].includes(window.location.hostname)
    ) {
      localDemoSession();
      showApp();
    } else {
      showLogin();
    }
    handlePaymentReturn();
    if (window.lucide) window.lucide.createIcons();
    window.addEventListener('load', () => {
      if (window.lucide) window.lucide.createIcons();
    });
  });
})();
