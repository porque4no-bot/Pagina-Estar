const { useState, useEffect, useRef } = React;

/* ── Icon helper (Lucide UMD) ─────────────────────── */
function Icon({ name, size = 20, style, className }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = '';
    const el = document.createElement('i');
    el.setAttribute('data-lucide', name);
    ref.current.appendChild(el);
    if (window.lucide) window.lucide.createIcons({ nodes: [el] });
  }, [name]);
  return (
    <span
      ref={ref}
      style={{ display: 'inline-flex', alignItems: 'center', width: size, height: size, flexShrink: 0, ...style }}
      className={className}
    ></span>
  );
}

/* ── Translation Dictionary ───────────────────────── */
const i18nEngine = {
  es: {
    modifySearch: "Modificar búsqueda",
    cancel: "Cancelar",
    checkin: "Llegada",
    checkout: "Salida",
    guests: "Huéspedes",
    searchBtn: "Buscar →",
    huesped: "huésped",
    huespedes: "huéspedes",
    noche: "noche",
    noches: "noches",
    1: "1 persona",
    2: "2 personas",
    3: "3 personas",
    4: "4 personas o más",
    stepRooms: "Habitación",
    stepExtras: "Extras",
    stepGuest: "Datos",
    stepPayment: "Pago",
    edit: "Editar",
    flexible: "Flexible",
    refundable: "Reembolsable",
    freeCancel: "Cancela sin cargo hasta 48h antes",
    bestPrice: "Mejor precio",
    save10: "Ahorra 10%",
    nonRefundable: "No reembolsable",
    selectBtn: "Seleccionar →",
    extrasIntro: "Personaliza tu estadía. Todos los servicios se confirman al reservar.",
    continueGuest: "Continuar con datos →",
    guestIntro: "Tus datos se usan solo para la confirmación y para comunicarnos contigo.",
    firstName: "Nombre",
    lastName: "Apellido",
    email: "Correo electrónico",
    phone: "Teléfono",
    country: "País de origen",
    notes: "Notas",
    notesOptional: "(opcional)",
    notesPlaceholder: "Hora de llegada, peticiones especiales...",
    privacyAgreement: "Acepto las políticas de cancelación y la política de privacidad",
    escnnaNotice: "En cumplimiento de la Ley 679 de 2001, advertimos que la explotación y el abuso sexual de menores de edad son sancionados penal y administrativamente.",
    escnnaLink: "Ver normatividad",
    continuePayment: "Continuar al pago →",
    summary: "Resumen",
    extrasSelected: "Extras seleccionados",
    iva: "IVA (19%)",
    total: "Total",
    plusTax: "+ imp.",
    paymentIntro: "Elige cómo quieres pagar.",
    paymentHotelInfo: "Tu reserva queda confirmada sin cargo previo. Pagas al hacer check-in. Cancelación gratuita hasta 24h antes.",
    paymentTransferInfo: "Recibirás los datos bancarios por correo. Tienes 24 horas para realizar la transferencia y confirmar tu reserva.",
    paymentNequiInfo: "Te enviaremos el número Nequi al correo. Incluye el código de reserva en el mensaje de pago.",
    confirmBooking: "Confirmar reserva →",
    emptySummary: "Elige tu habitación para ver el resumen aquí.",
    successTitle: "¡Reserva confirmada!",
    successCode: "Código:",
    successSent: "Confirmación enviada a",
    beforeArrival: "Antes de llegar",
    howToGet: "Cómo llegar",
    howToGetDesc: "Carrera 23 #62-70, Manizales. Parqueadero cubierto disponible.",
    checkInOut: "Check-in / check-out",
    checkInOutDesc: "Llegada desde las 3:00 pm. Salida antes de las 12:00 m.",
    directContact: "Contacto directo",
    manageBooking: "Gestionar reserva",
    manageIntro: "Consulta, modifica o cancela tu reserva. Solo necesitas el código y tu correo.",
    bookingCodeLabel: "Código de reserva",
    searchBooking: "Buscar reserva →",
    resFound: "Reserva encontrada",
    resDates: "Fechas",
    resModDates: "Modificar fechas",
    resCancel: "Cancelar reserva",
    resCancelPolicy: "Tarifa flexible · cancelación gratuita hasta 48h antes del check-in.",
    resCancelConfirm: "¿Confirmar cancelación?",
    resCancelConfirmDesc: "Esta acción no se puede deshacer. Recibirás confirmación por correo.",
    resCancelConfirmYes: "Sí, cancelar",
    resCancelError: "No encontramos ninguna reserva con ese código y correo. Verifica los datos o escríbenos por WhatsApp.",
    back: "Volver",
    newBooking: "Nueva reserva",
    
    // Room mapping translations
    roomNames: {
      clasica: "Clásica",
      seleccion: "Selección",
      reserva: "Reserva",
      origen: "Origen",
      especial: "Especial"
    },
    roomDescs: {
      clasica: "Diseño eficiente y cálido. Todo lo esencial en 28 m² bien aprovechados.",
      seleccion: "Balcón privado con vistas a la cordillera. Ideal para el café de las mañanas.",
      reserva: "Dormitorio privado separado de la zona social. Escritorio ergonómico. 42 m².",
      origen: "El más espacioso. Diseño con referencia cafetera. Vista panorámica de Manizales.",
      especial: "Nuestra tipología más completa. Terraza privada. Para quedar muy bien."
    },
    roomBeds: {
      "1 Queen size": "1 Queen size",
      "1 King size": "1 King size",
      "King + sofacama": "1 King + sofá cama"
    },
    roomViews: {
      "Vista ciudad": "Vista ciudad",
      "Cordillera + balcón": "Balcón + cordillera",
      "Panorámica": "Vista panorámica",
      "Panorámica premium": "Panorámica premium"
    },
    roomAmenities: {
      "WiFi fibra": "WiFi fibra",
      "Smart TV 43\"": "Smart TV 43\"",
      "Smart TV 55\"": "Smart TV 55\"",
      "Smart TV 65\"": "Smart TV 65\"",
      "Cocina equipada": "Cocina equipada",
      "Cocina premium": "Cocina premium",
      "Baño privado": "Baño privado",
      "Baño privado amplio": "Baño privado amplio",
      "Aseo semanal": "Aseo semanal",
      "Balcón privado": "Balcón privado",
      "Ambientes separados": "Ambientes separados",
      "Escritorio": "Escritorio",
      "Vista panorámica": "Vista panorámica",
      "Bañera": "Bañera",
      "Terraza privada": "Terraza privada",
      "Hasta 3 personas": "Hasta 3 personas"
    },
    
    // Extras mapping translations
    extrasNames: {
      desayuno: "Desayuno",
      parqueadero: "Parqueadero",
      late: "Late check-out",
      early: "Early check-in",
      traslado: "Traslado aeropuerto",
      tour: "Tour Manizales"
    },
    extrasDescs: {
      desayuno: "Café, fruta y huevos cada mañana",
      parqueadero: "Garaje cubierto en el edificio",
      late: "Salida hasta las 3:00 pm (sujeto a disponibilidad)",
      early: "Entrada desde las 10:00 am (sujeto a disponibilidad)",
      traslado: "Hacia o desde La Nubia",
      tour: "4 horas con guía local certificado"
    },
    extrasUnits: {
      "/persona/noche": "/persona/noche",
      "/noche": "/noche",
      "por reserva": "por reserva",
      "por trayecto": "por trayecto",
      "/persona": "/persona"
    },
    
    // Payments translations
    paymentNames: {
      card: "Tarjeta crédito / débito",
      pse: "PSE",
      nequi: "Nequi",
      hotel: "Pagar en el hotel",
      transfer: "Transferencia bancaria"
    },
    paymentDescs: {
      card: "Visa, Mastercard, Amex",
      pse: "Débito bancario en línea",
      nequi: "Desde tu cuenta Nequi",
      hotel: "Reserva sin cargo previo, pago al llegar",
      transfer: "Te enviamos los datos por correo"
    }
  },
  en: {
    modifySearch: "Modify search",
    cancel: "Cancel",
    checkin: "Arrival",
    checkout: "Departure",
    guests: "Guests",
    searchBtn: "Search →",
    huesped: "guest",
    huespedes: "guests",
    noche: "night",
    noches: "nights",
    1: "1 guest",
    2: "2 guests",
    3: "3 guests",
    4: "4 guests or more",
    stepRooms: "Accommodation",
    stepExtras: "Extras",
    stepGuest: "Details",
    stepPayment: "Payment",
    edit: "Edit",
    flexible: "Flexible",
    refundable: "Refundable",
    freeCancel: "Free cancellation up to 48 hours before check-in",
    bestPrice: "Best rate",
    save10: "Save 10%",
    nonRefundable: "Non-refundable",
    selectBtn: "Select →",
    extrasIntro: "Personalize your stay. All additional services are confirmed upon booking.",
    continueGuest: "Continue to details →",
    guestIntro: "Your information is only used for confirmation and communication purposes.",
    firstName: "First name",
    lastName: "Last name",
    email: "Email address",
    phone: "Phone number",
    country: "Country of origin",
    notes: "Notes",
    notesOptional: "(optional)",
    notesPlaceholder: "Arrival time, special requests...",
    privacyAgreement: "I accept the cancellation policies and the privacy policy",
    escnnaNotice: "In compliance with Colombian Law 679 of 2001, we warn that child sexual exploitation and abuse are criminally and administratively punished.",
    escnnaLink: "Read regulations",
    continuePayment: "Continue to payment →",
    summary: "Summary",
    extrasSelected: "Selected extras",
    iva: "IVA (19%)",
    total: "Total",
    plusTax: "+ tax",
    paymentIntro: "Choose how you would like to pay.",
    paymentHotelInfo: "Your reservation is confirmed without prior charge. You pay upon check-in. Free cancellation up to 24 hours prior.",
    paymentTransferInfo: "You will receive bank details by email. You have 24 hours to complete the transfer and confirm your booking.",
    paymentNequiInfo: "We will send you the Nequi number by email. Include the booking reference in the payment note.",
    confirmBooking: "Confirm booking →",
    emptySummary: "Choose your apartaestudio to view the summary here.",
    successTitle: "Booking confirmed!",
    successCode: "Reference:",
    successSent: "Confirmation sent to",
    beforeArrival: "Before you arrive",
    howToGet: "How to get here",
    howToGetDesc: "Carrera 23 #62-70, Manizales. Covered parking available on site.",
    checkInOut: "Check-in / check-out",
    checkInOutDesc: "Check-in from 3:00 pm. Check-out before 12:00 pm.",
    directContact: "Direct contact",
    manageBooking: "Manage booking",
    manageIntro: "Check, modify or cancel your booking. You only need your booking reference and email.",
    bookingCodeLabel: "Booking reference",
    searchBooking: "Search booking →",
    resFound: "Booking found",
    resDates: "Dates",
    resModDates: "Modify dates",
    resCancel: "Cancel booking",
    resCancelPolicy: "Flexible rate · free cancellation up to 48 hours prior to check-in.",
    resCancelConfirm: "Confirm cancellation?",
    resCancelConfirmDesc: "This action cannot be undone. You will receive a confirmation email.",
    resCancelConfirmYes: "Yes, cancel",
    resCancelError: "We could not find any booking with that reference and email. Please check the details or contact us on WhatsApp.",
    back: "Back",
    newBooking: "New booking",
    
    // Room mapping translations
    roomNames: {
      clasica: "Classic",
      seleccion: "Selection",
      reserva: "Reserva",
      origen: "Origen",
      especial: "Special"
    },
    roomDescs: {
      clasica: "Compact, warm, and functional. Designed to optimize every square meter for a hassle-free stay.",
      seleccion: "Private balcony with mountain views. Ideal for your morning coffee.",
      reserva: "Private bedroom separate from the living space. Ergonomic desk. 42 sqm.",
      origen: "Our most spacious layout. Coffee-inspired design elements. Panoramic views of Manizales.",
      especial: "Our most complete typology. Private terrace. Ideal to make an impression."
    },
    roomBeds: {
      "1 Queen size": "1 Queen size bed",
      "1 King size": "1 King size bed",
      "King + sofacama": "1 King size + sofa bed"
    },
    roomViews: {
      "Vista ciudad": "City view",
      "Cordillera + balcón": "Mountain view + balcony",
      "Panorámica": "Panoramic view",
      "Panorámica premium": "Premium panoramic view"
    },
    roomAmenities: {
      "WiFi fibra": "WiFi (fiber)",
      "Smart TV 43\"": "Smart TV 43\"",
      "Smart TV 55\"": "Smart TV 55\"",
      "Smart TV 65\"": "Smart TV 65\"",
      "Cocina equipada": "Equipped kitchen",
      "Cocina premium": "Premium kitchen",
      "Baño privado": "Private bathroom",
      "Baño privado amplio": "Large private bathroom",
      "Aseo semanal": "Weekly cleaning",
      "Balcón privado": "Private balcony",
      "Ambientes separados": "Separate rooms",
      "Escritorio": "Ergonomic desk",
      "Vista panorámica": "Panoramic view",
      "Bañera": "Bathtub",
      "Terraza privada": "Private terrace",
      "Hasta 3 personas": "Up to 3 guests"
    },
    
    // Extras mapping translations
    extrasNames: {
      desayuno: "Breakfast",
      parqueadero: "Parking",
      late: "Late check-out",
      early: "Early check-in",
      traslado: "Airport transfer",
      tour: "Manizales Tour"
    },
    extrasDescs: {
      desayuno: "Coffee, fresh fruit, and eggs served every morning",
      parqueadero: "Covered parking garage in the building",
      late: "Late check-out until 3:00 pm (subject to availability)",
      early: "Early check-in from 10:00 am (subject to availability)",
      traslado: "To or from La Nubia Airport",
      tour: "4 hours with a certified local guide"
    },
    extrasUnits: {
      "/persona/noche": "/person/night",
      "/noche": "/night",
      "por reserva": "per booking",
      "por trayecto": "per way",
      "/persona": "/person"
    },
    
    // Payments translations
    paymentNames: {
      card: "Credit / debit card",
      pse: "PSE (Online Bank Debit)",
      nequi: "Nequi Mobile Pay",
      hotel: "Pay at hotel",
      transfer: "Bank transfer"
    },
    paymentDescs: {
      card: "Visa, Mastercard, Amex",
      pse: "Online secure bank transaction",
      nequi: "From your Nequi wallet",
      hotel: "Book now without prepay, pay upon check-in",
      transfer: "We will email you our bank details"
    }
  }
};

/* ── Helper: get query parameters on load ────────── */
function parseQueryParams() {
  const params = new URLSearchParams(window.location.search);
  const checkin = params.get('checkin') || getOffset(1);
  const checkout = params.get('checkout') || getOffset(4);
  let guests = parseInt(params.get('guests'));
  if (isNaN(guests) || guests < 1) guests = 2;
  
  let roomParam = params.get('room');
  if (roomParam === 'clasic') roomParam = 'clasica'; // compatibility mapping
  
  return { checkin, checkout, guests, roomParam };
}

/* ── SearchBar ────────────────────────────────────── */
function SearchBar({ search, onSearch, lang }) {
  const [s, setS] = useState(search);
  const [expanded, setExpanded] = useState(false);
  const t = i18nEngine[lang];

  function submit(e) {
    e.preventDefault();
    onSearch(s);
    setExpanded(false);
  }

  if (!expanded) {
    const nights = dateDiff(search.checkin, search.checkout);
    return (
      <div className="be-searchbar-wrap">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="be-searchbar-dates">
            <Icon name="calendar" size={14} style={{ color: 'var(--terracotta)' }} />
            <span>{fmtDate(search.checkin)}</span>
            <span className="be-searchbar-arrow">→</span>
            <span>{fmtDate(search.checkout)}</span>
          </div>
          <div className="be-searchbar-meta">
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Icon name="users" size={13} />
              {search.guests} {search.guests === 1 ? t.huesped : t.huespedes}
            </span>
            <span>·</span>
            <span>{nights} {nights === 1 ? t.noche : t.noches}</span>
          </div>
        </div>
        <button className="be-searchbar-edit" onClick={() => setExpanded(true)}>
          {t.modifySearch}
        </button>
      </div>
    );
  }

  return (
    <div className="be-searchbar-wrap" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="be-eyebrow" style={{ marginBottom: 0 }}>{t.modifySearch}</span>
        <button className="be-btn-text" onClick={() => setExpanded(false)}>{t.cancel}</button>
      </div>
      <form onSubmit={submit}>
        <div className="be-searchform-fields">
          <div className="be-field">
            <label>{t.checkin}</label>
            <input type="date" value={s.checkin} min={getToday()} required
              onChange={e => setS({ ...s, checkin: e.target.value })} />
          </div>
          <div className="be-field">
            <label>{t.checkout}</label>
            <input type="date" value={s.checkout} min={s.checkin || getOffset(1)} required
              onChange={e => setS({ ...s, checkout: e.target.value })} />
          </div>
          <div className="be-field">
            <label>{t.guests}</label>
            <select value={s.guests} onChange={e => setS({ ...s, guests: parseInt(e.target.value) })}>
              <option value={1}>{t["1"]}</option>
              <option value={2}>{t["2"]}</option>
              <option value={3}>{t["3"]}</option>
            </select>
          </div>
          <button type="submit" className="be-btn-primary">{t.searchBtn}</button>
        </div>
      </form>
    </div>
  );
}

/* ── Progress bar ─────────────────────────────────── */
function StepProgress({ currentStep, lang }) {
  const t = i18nEngine[lang];
  const steps = [
    { id: 'rooms', label: t.stepRooms },
    { id: 'extras', label: t.stepExtras },
    { id: 'guest', label: t.stepGuest },
    { id: 'payment', label: t.stepPayment },
  ];
  const order = steps.map(s => s.id);
  const ci = order.indexOf(currentStep);

  return (
    <div className="be-progress">
      {steps.map((s, i) => (
        <React.Fragment key={s.id}>
          <div className={`be-progress-step ${i < ci ? 'done' : ''} ${i === ci ? 'active' : ''} ${i > ci ? 'pending' : ''}`}>
            <div className="be-progress-dot">
              {i < ci ? <Icon name="check" size={11} /> : i + 1}
            </div>
            <span className="be-progress-label">{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={`be-progress-line${i < ci ? ' be-progress-line-done' : ''}`}
              style={{ flex: 1, height: 1, background: i < ci ? 'var(--olive)' : 'var(--paper-400)', margin: '0 4px', transition: 'background .24s' }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

/* ── StepWrapper ──────────────────────────────────── */
function StepWrapper({ num, title, state, summaryLine, onEdit, children, lang }) {
  const t = i18nEngine[lang];
  return (
    <div className={`be-step be-step-${state}`}>
      <div className="be-step-header"
        onClick={state === 'complete' ? onEdit : undefined}
        style={{ cursor: state === 'complete' ? 'pointer' : 'default' }}>
        <div className="be-step-num-wrap">
          <div className="be-step-num">
            {state === 'complete'
              ? <Icon name="check" size={12} style={{ color: 'var(--white)' }} />
              : num}
          </div>
          <span className="be-step-title">{title}</span>
        </div>
        <div className="be-step-header-right">
          {state === 'complete' && (
            <button className="be-btn-text"
              onClick={e => { e.stopPropagation(); onEdit(); }}>
              {t.edit}
            </button>
          )}
          {state === 'pending' && (
            <Icon name="lock" size={14} style={{ color: 'var(--ink-300)' }} />
          )}
        </div>
      </div>
      {state === 'complete' && summaryLine && (
        <div className="be-step-summary">{summaryLine}</div>
      )}
      {state === 'active' && (
        <div className="be-step-content">{children}</div>
      )}
    </div>
  );
}

/* ── RoomCard ─────────────────────────────────────── */
function RoomCard({ room, nights, guests, rate, onSelect, onRateChange, lang }) {
  const t = i18nEngine[lang];
  const priceFlex = room.priceFlexible;
  const priceBest = Math.round(room.priceFlexible * 0.9);
  const activePrice = rate === 'best' ? priceBest : priceFlex;

  // Translate details
  const roomName = t.roomNames[room.id] || room.name;
  const roomDesc = t.roomDescs[room.id] || room.desc;
  const roomBed = t.roomBeds[room.bed] || room.bed;
  const roomView = t.roomViews[room.view] || room.view;

  return (
    <div className="be-room-card">
      <div className="be-room-photo">
        <div className="be-room-badge">{lang === 'es' ? 'Tipología' : 'Typology'} {room.num}</div>
        <span className="be-room-photo-name">{roomName}</span>
      </div>
      <div className="be-room-info">
        <div>
          <h3 className="be-room-name">{roomName}</h3>
          <p className="be-room-desc">{roomDesc}</p>
        </div>
        <div className="be-room-specs">
          <span><Icon name="maximize-2" size={13} />{room.area} m²</span>
          <span><Icon name="moon" size={13} />{roomBed}</span>
          <span><Icon name="users" size={13} />{room.capacity} {lang === 'es' ? 'pers.' : 'guests'}</span>
          <span><Icon name="eye" size={13} />{roomView}</span>
        </div>
        <div className="be-rate-options">
          <button type="button" className={`be-rate-opt${rate === 'flexible' ? ' active' : ''}`}
            onClick={() => onRateChange('flexible')}>
            <div className="be-rate-tag">
              <span className="be-label">{t.flexible}</span>
              <span className="be-badge-policy">{t.refundable}</span>
            </div>
            <div className="be-rate-price">{formatCOP(priceFlex)}<span>/{t.noche}</span></div>
            <div className="be-rate-sub">{t.freeCancel}</div>
          </button>
          <button type="button" className={`be-rate-opt best${rate === 'best' ? ' active' : ''}`}
            onClick={() => onRateChange('best')}>
            <div className="be-rate-tag">
              <span className="be-label">{t.bestPrice}</span>
              <span className="be-badge-save">{t.save10}</span>
            </div>
            <div className="be-rate-price">{formatCOP(priceBest)}<span>/{t.noche}</span></div>
            <div className="be-rate-sub">{t.nonRefundable}</div>
          </button>
        </div>
        <div className="be-room-total-row">
          <span className="be-room-total-label">
            {nights} {nights === 1 ? t.noche : t.noches} · {guests} {guests === 1 ? t.huesped : t.huespedes}
          </span>
          <span className="be-room-total">{formatCOP(activePrice * nights)} <span>{t.plusTax}</span></span>
        </div>
        <button className="be-btn-primary be-room-select-btn" onClick={() => onSelect(room, rate)}>
          {t.selectBtn}
        </button>
      </div>
    </div>
  );
}

/* ── ExtrasPanel ──────────────────────────────────── */
function ExtrasPanel({ extras, setExtras, search, onContinue, lang }) {
  const t = i18nEngine[lang];
  const nights = dateDiff(search.checkin, search.checkout);

  function toggle(id) { setExtras(prev => ({ ...prev, [id]: !prev[id] })); }

  function extraTotal(ex) {
    if (!extras[ex.id]) return 0;
    if (ex.id === 'desayuno') return ex.price * search.guests * nights;
    if (ex.id === 'parqueadero') return ex.price * nights;
    if (ex.id === 'tour') return ex.price * search.guests;
    return ex.price;
  }

  return (
    <div>
      <p className="be-section-intro">{t.extrasIntro}</p>
      <div className="be-extras-list">
        {BE_EXTRAS.map(ex => {
          const exName = t.extrasNames[ex.id] || ex.name;
          const exDesc = t.extrasDescs[ex.id] || ex.desc;
          const exUnit = t.extrasUnits[ex.unit] || ex.unit;
          return (
            <label key={ex.id} className={`be-extra-row${extras[ex.id] ? ' checked' : ''}`}>
              <div className="be-extra-check">
                {extras[ex.id] ? '✶' : ''}
                <input type="checkbox" checked={!!extras[ex.id]} onChange={() => toggle(ex.id)} />
              </div>
              <Icon name={ex.icon} size={18} className="be-extra-icon" />
              <div className="be-extra-info">
                <span className="be-extra-name">{exName}</span>
                <span className="be-extra-desc">{exDesc}</span>
              </div>
              <div className="be-extra-price">
                <span>{formatCOP(ex.price)}</span>
                <span className="be-extra-unit">{exUnit}</span>
                {extras[ex.id] && extraTotal(ex) > 0 && (
                  <span className="be-extra-total">= {formatCOP(extraTotal(ex))}</span>
                )}
              </div>
            </label>
          );
        })}
      </div>
      <div className="be-step-footer">
        <button className="be-btn-primary" onClick={onContinue}>
          {t.continueGuest}
        </button>
      </div>
    </div>
  );
}

/* ── GuestForm ────────────────────────────────────── */
function GuestForm({ guest, setGuest, onContinue, lang }) {
  const t = i18nEngine[lang];
  function set(field, val) { setGuest(prev => ({ ...prev, [field]: val })); }
  function submit(e) { e.preventDefault(); onContinue(); }

  const countries = lang === 'es'
    ? ['Colombia','Venezuela','Ecuador','Perú','México','Argentina','España','Estados Unidos','Otro']
    : ['Colombia','Venezuela','Ecuador','Peru','Mexico','Argentina','Spain','United States','Other'];

  return (
    <form onSubmit={submit}>
      <p className="be-section-intro">{t.guestIntro}</p>
      <div className="be-form-grid">
        <div className="be-field">
          <label>{t.firstName}</label>
          <input type="text" required placeholder={t.firstName}
            value={guest.nombre || ''} onChange={e => set('nombre', e.target.value)} />
        </div>
        <div className="be-field">
          <label>{t.lastName}</label>
          <input type="text" required placeholder={t.lastName}
            value={guest.apellido || ''} onChange={e => set('apellido', e.target.value)} />
        </div>
        <div className="be-field be-field-full">
          <label>{t.email}</label>
          <input type="email" required placeholder="correo@ejemplo.com"
            value={guest.email || ''} onChange={e => set('email', e.target.value)} />
        </div>
        <div className="be-field">
          <label>{t.phone}</label>
          <input type="tel" required placeholder="+57 300 000 0000"
            value={guest.tel || ''} onChange={e => set('tel', e.target.value)} />
        </div>
        <div className="be-field">
          <label>{t.country}</label>
          <select value={guest.pais || 'Colombia'} onChange={e => set('pais', e.target.value)}>
            {countries.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="be-field be-field-full">
          <label>{t.notes} <span style={{ fontWeight: 400, color: 'var(--ink-300)' }}>{t.notesOptional}</span></label>
          <textarea rows={3} placeholder={t.notesPlaceholder}
            value={guest.notas || ''} onChange={e => set('notas', e.target.value)} />
        </div>
        <div className="be-field be-field-full">
          <label className="be-checkbox-label">
            <input type="checkbox" required />
            <span>{t.privacyAgreement}</span>
          </label>
        </div>
        <div className="be-field be-field-full">
          <p className="be-legal-notice">
            {t.escnnaNotice} <a href="escnna.html" target="_blank">{t.escnnaLink}</a>.
          </p>
        </div>
      </div>
      <div className="be-step-footer">
        <button type="submit" className="be-btn-primary">{t.continuePayment}</button>
      </div>
    </form>
  );
}

/* ── PaymentPanel ─────────────────────────────────── */
function PaymentPanel({ paymentMethod, setPaymentMethod, booking, search, onConfirm, lang }) {
  const t = i18nEngine[lang];
  const calc = calcTotal(booking.room, booking.rate, booking.extras, search);

  const translatedRoomName = t.roomNames[booking.room.id] || booking.room.name;

  return (
    <div>
      {calc && (
        <div className="be-inline-summary">
          <span className="be-eyebrow" style={{ marginBottom: 10 }}>{t.summary}</span>
          <div className="be-summary-line">
            <span>{translatedRoomName} · {booking.rate === 'best' ? t.bestPrice : t.flexible}</span>
            <span></span>
          </div>
          <div className="be-summary-line">
            <span>{formatCOP(calc.nightly)} × {calc.nights} {calc.nights === 1 ? t.noche : t.noches}</span>
            <span>{formatCOP(calc.roomSub)}</span>
          </div>
          {calc.extrasSub > 0 && (
            <div className="be-summary-line">
              <span>{t.extrasSelected}</span>
              <span>{formatCOP(calc.extrasSub)}</span>
            </div>
          )}
          <div className="be-summary-line">
            <span>{t.iva}</span>
            <span>{formatCOP(calc.iva)}</span>
          </div>
          <div className="be-summary-line be-summary-total">
            <span>{t.total}</span>
            <span>{formatCOP(calc.total)}</span>
          </div>
        </div>
      )}
      <p className="be-section-intro" style={{ marginTop: 20 }}>{t.paymentIntro}</p>
      <div className="be-payment-options">
        {BE_PAYMENTS.map(pm => {
          const pmName = t.paymentNames[pm.id] || pm.name;
          const pmDesc = t.paymentDescs[pm.id] || pm.desc;
          return (
            <button key={pm.id} type="button"
              className={`be-payment-opt${paymentMethod === pm.id ? ' active' : ''}`}
              onClick={() => setPaymentMethod(pm.id)}>
              <Icon name={pm.icon} size={20} />
              <div className="be-payment-info">
                <span className="be-payment-name">{pmName}</span>
                <span className="be-payment-desc">{pmDesc}</span>
              </div>
              {paymentMethod === pm.id && <span className="be-payment-check">✶</span>}
            </button>
          );
        })}
      </div>
      {paymentMethod === 'hotel' && (
        <div className="be-info-box">
          <Icon name="info" size={16} style={{ color: 'var(--sand-700)', marginTop: 1 }} />
          <p>{t.paymentHotelInfo}</p>
        </div>
      )}
      {paymentMethod === 'transfer' && (
        <div className="be-info-box">
          <Icon name="mail" size={16} style={{ color: 'var(--sand-700)', marginTop: 1 }} />
          <p>{t.paymentTransferInfo}</p>
        </div>
      )}
      {paymentMethod === 'nequi' && (
        <div className="be-info-box">
          <Icon name="smartphone" size={16} style={{ color: 'var(--sand-700)', marginTop: 1 }} />
          <p>{t.paymentNequiInfo}</p>
        </div>
      )}
      <div className="be-step-footer">
        <button className="be-btn-primary" style={{ padding: '14px 28px', fontSize: 13 }}
          disabled={!paymentMethod} onClick={onConfirm}>
          {t.confirmBooking}
        </button>
      </div>
    </div>
  );
}

/* ── BookingSummary (sidebar editorial) ───────────── */
function BookingSummary({ booking, search, lang }) {
  const t = i18nEngine[lang];
  if (!booking.room) {
    return (
      <div style={{ background: 'var(--paper-200)', border: '1px solid var(--paper-400)', borderRadius: 'var(--radius-xl)', padding: 24, textAlign: 'center' }}>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-300)', fontStyle: 'italic' }}>
          {t.emptySummary}
        </p>
      </div>
    );
  }
  const calc = calcTotal(booking.room, booking.rate, booking.extras, search);
  const nights = dateDiff(search.checkin, search.checkout);

  const roomName = t.roomNames[booking.room.id] || booking.room.name;
  const roomBed = t.roomBeds[booking.room.bed] || booking.room.bed;

  return (
    <div className="be-summary-card">
      <div className="be-summary-room">
        <div className="be-summary-room-photo">
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 13 }}>{booking.room.num}</span>
        </div>
        <div>
          <span className="be-eyebrow">{lang === 'es' ? 'Tipología' : 'Typology'} {booking.room.num}</span>
          <p style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 18, color: 'var(--white)' }}>{roomName}</p>
          <p style={{ fontSize: 12, opacity: .7, fontFamily: 'var(--font-body)', marginTop: 2 }}>{booking.room.area} m² · {roomBed}</p>
        </div>
      </div>
      <div className="be-summary-dates">
        <div>
          <span className="be-eyebrow">{t.checkin}</span>
          <p>{fmtDate(search.checkin)}</p>
        </div>
        <div className="be-summary-nights">{nights}<span>{nights === 1 ? t.noche : t.noches}</span></div>
        <div style={{ textAlign: 'right' }}>
          <span className="be-eyebrow">{t.checkout}</span>
          <p>{fmtDate(search.checkout)}</p>
        </div>
      </div>
      <p className="be-summary-rate-badge">
        {booking.rate === 'flexible'
          ? `✶ ${t.flexible} — ${t.refundable}`
          : `✶ ${t.bestPrice} — ${t.nonRefundable}`}
      </p>
      {calc && (
        <div className="be-summary-breakdown">
          <div className="be-summary-line sm"><span>{formatCOP(calc.nightly)} × {nights} {nights === 1 ? t.noche : t.noches}</span><span>{formatCOP(calc.roomSub)}</span></div>
          {calc.extrasSub > 0 && <div className="be-summary-line sm"><span>{t.extras}</span><span>{formatCOP(calc.extrasSub)}</span></div>}
          <div className="be-summary-line sm"><span>{t.iva}</span><span>{formatCOP(calc.iva)}</span></div>
          <div className="be-summary-line total"><span>{t.total}</span><span>{formatCOP(calc.total)}</span></div>
        </div>
      )}
    </div>
  );
}

/* ── Confirmation ─────────────────────────────────── */
function Confirmation({ booking, search, code, onManage, onNew, lang }) {
  const t = i18nEngine[lang];
  const calc = calcTotal(booking.room, booking.rate, booking.extras, search);

  const roomName = t.roomNames[booking.room.id] || booking.room.name;
  const rateLabel = booking.rate === 'flexible' ? `${t.flexible} — ${t.refundable}` : `${t.bestPrice} — ${t.nonRefundable}`;

  return (
    <div className="be-confirmation">
      <div className="be-confirm-hero">
        <span className="be-confirm-icon">✶</span>
        <h2>{t.successTitle}</h2>
        <p>{t.successCode} <strong>{code}</strong></p>
        <p style={{ marginTop: 8 }}>{t.successSent} <strong>{booking.guest?.email || 'tu correo'}</strong></p>
      </div>
      <div className="be-confirm-card">
        <div className="be-confirm-row">
          <span className="be-eyebrow">{t.stepRoom}</span>
          <p className="be-confirm-val">{lang === 'es' ? 'Tipología' : 'Typology'} {booking.room.num} — {roomName} · {booking.room.area} m²</p>
        </div>
        <div className="be-confirm-row two">
          <div>
            <span className="be-eyebrow">{t.checkin}</span>
            <p className="be-confirm-val">{fmtDate(search.checkin)} · 3:00 pm</p>
          </div>
          <div>
            <span className="be-eyebrow">{t.checkout}</span>
            <p className="be-confirm-val">{fmtDate(search.checkout)} · 12:00 pm</p>
          </div>
        </div>
        <div className="be-confirm-row">
          <span className="be-eyebrow">{lang === 'es' ? 'Tarifa' : 'Rate'}</span>
          <p className="be-confirm-val">{rateLabel}</p>
        </div>
        {calc && (
          <div className="be-confirm-row">
            <span className="be-eyebrow">{t.total}</span>
            <p className="be-confirm-total">{formatCOP(calc.total)}</p>
          </div>
        )}
        <div className="be-confirm-actions">
          <button className="be-btn-secondary" onClick={onManage}>
            <Icon name="settings" size={15} /> {t.manageBooking}
          </button>
          <button className="be-btn-ghost" onClick={onNew}>{t.newBooking}</button>
        </div>
      </div>
      <div className="be-confirm-next">
        <span className="be-eyebrow">{t.beforeArrival}</span>
        <div className="be-confirm-tips">
          {[
            { icon: 'map-pin', title: t.howToGet, body: t.howToGetDesc },
            { icon: 'clock', title: t.checkInOut, body: t.checkInOutDesc },
            { icon: 'phone', title: t.directContact, body: '+57 310 249 0414 · reservas@hotelestar.com' },
          ].map(tip => (
            <div key={tip.icon} className="be-confirm-tip">
              <Icon name={tip.icon} size={18} style={{ color: 'var(--terracotta)', marginTop: 2 }} />
              <div><strong>{tip.title}</strong><p>{tip.body}</p></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── ManageBooking ────────────────────────────────── */
function ManageBooking({ onBack, lang }) {
  const t = i18nEngine[lang];
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [result, setResult] = useState(null);
  const [showCancel, setShowCancel] = useState(false);

  function doSearch(e) {
    e.preventDefault();
    setResult(code.toUpperCase().startsWith('EST-') ? 'found' : 'not-found');
    setShowCancel(false);
  }

  return (
    <div className="be-manage">
      <button className="be-btn-text" onClick={onBack}
        style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon name="arrow-left" size={13} /> {t.back}
      </button>
      <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 24, marginBottom: 6, color: 'var(--ink)' }}>
        {t.manageBooking}
      </h2>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--ink-500)', lineHeight: 1.6, marginBottom: 32 }}>
        {t.manageIntro}
      </p>
      <form onSubmit={doSearch} className="be-manage-form">
        <div className="be-field">
          <label>{t.bookingCodeLabel}</label>
          <input type="text" placeholder="EST-XXXXX" value={code}
            onChange={e => setCode(e.target.value)} required />
        </div>
        <div className="be-field">
          <label>{t.email}</label>
          <input type="email" placeholder="correo@ejemplo.com" value={email}
            onChange={e => setEmail(e.target.value)} required />
        </div>
        <button type="submit" className="be-btn-primary">{t.searchBooking}</button>
      </form>

      {result === 'found' && !showCancel && (
        <div className="be-manage-result">
          <div className="be-manage-found-header">
            <span>✶</span>
            <div>
              <span className="be-eyebrow">{t.resFound}</span>
              <p style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 17, color: 'var(--white)' }}>
                {code.toUpperCase()}
              </p>
            </div>
          </div>
          <div className="be-manage-details">
            <div><span className="be-eyebrow">{t.stepRoom}</span><p>{lang === 'es' ? 'Tipología 03 — Reserva' : 'Typology 03 — Reserva'}</p></div>
            <div><span className="be-eyebrow">{t.resDates}</span><p>10 Jun → 13 Jun</p></div>
            <div><span className="be-eyebrow">{t.total}</span><p>{formatCOP(1142400)}</p></div>
          </div>
          <div className="be-manage-actions">
            <button className="be-btn-secondary">
              <Icon name="calendar" size={14} /> {t.resModDates}
            </button>
            <button className="be-btn-danger" onClick={() => setShowCancel(true)}>
              {t.resCancel}
            </button>
          </div>
          <p style={{ padding: '0 22px 16px', fontSize: 12, color: 'var(--ink-300)', fontFamily: 'var(--font-body)' }}>
            {t.resCancelPolicy}
          </p>
        </div>
      )}

      {result === 'found' && showCancel && (
        <div style={{ background: 'var(--terracotta-100)', border: '1px solid var(--terracotta-300)', borderRadius: 'var(--radius-lg)', padding: 24, marginTop: 24 }}>
          <p style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 16, marginBottom: 8, color: 'var(--ink)' }}>
            {t.resCancelConfirm}
          </p>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-500)', marginBottom: 20, lineHeight: 1.6 }}>
            {t.resCancelConfirmDesc}
          </p>
          <div style={{ display: 'flex', gap: 12 }}>
            <button className="be-btn-danger"
              onClick={() => { setResult(null); setShowCancel(false); setCode(''); setEmail(''); }}>
              {t.resCancelConfirmYes}
            </button>
            <button className="be-btn-secondary" onClick={() => setShowCancel(false)}>{t.back}</button>
          </div>
        </div>
      )}

      {result === 'not-found' && (
        <div className="be-info-box be-info-error" style={{ marginTop: 24 }}>
          <Icon name="alert-circle" size={16} />
          <p>{t.resCancelError}</p>
        </div>
      )}
    </div>
  );
}

/* ── Main App ─────────────────────────────────────── */
function BookingEngine() {
  const initialParams = parseQueryParams();
  
  const [lang, setLang] = useState(document.documentElement.lang || 'es');
  const [mode, setMode] = useState('book'); // 'book' | 'manage'
  const [search, setSearch] = useState({ 
    checkin: initialParams.checkin, 
    checkout: initialParams.checkout, 
    guests: initialParams.guests 
  });
  
  // Find room if pre-selected
  const matchingRoom = BE_ROOMS.find(r => r.id === initialParams.roomParam);
  
  const [selectedRoom, setSelectedRoom] = useState(matchingRoom || null);
  const [selectedRate, setSelectedRate] = useState('flexible');
  const [currentStep, setCurrentStep] = useState(matchingRoom ? 'extras' : 'rooms');
  const [ratePerRoom, setRatePerRoom] = useState({});
  const [extras, setExtras] = useState({});
  const [guestData, setGuestData] = useState({});
  const [paymentMethod, setPaymentMethod] = useState(null);
  const [bookingCode, setBookingCode] = useState(null);

  /* Listener for decoupled language changes from shell.js */
  useEffect(() => {
    const handleLangChange = (e) => {
      if (e.detail && e.detail.lang) {
        setLang(e.detail.lang);
      }
    };
    document.addEventListener('estar-lang-change', handleLangChange);
    window.enterManageMode = () => setMode('manage');
    
    return () => { 
      document.removeEventListener('estar-lang-change', handleLangChange);
      delete window.enterManageMode; 
    };
  }, []);

  const booking = { room: selectedRoom, rate: selectedRate, extras, guest: guestData, payment: paymentMethod };
  const stepOrder = ['rooms', 'extras', 'guest', 'payment'];
  const t = i18nEngine[lang];

  function stepState(id) {
    const ci = stepOrder.indexOf(currentStep);
    const si = stepOrder.indexOf(id);
    if (si === ci) return 'active';
    if (si < ci) return 'complete';
    return 'pending';
  }

  function handleSelectRoom(room, rate) {
    setSelectedRoom(room);
    setSelectedRate(rate);
    setCurrentStep('extras');
  }

  function handleSearch(s) {
    setSearch(s);
    setCurrentStep('rooms');
    setSelectedRoom(null);
    setSelectedRate('flexible');
    setExtras({});
    setGuestData({});
    setPaymentMethod(null);
    setBookingCode(null);
  }

  function goToStep(id) {
    const ci = stepOrder.indexOf(currentStep);
    const ti = stepOrder.indexOf(id);
    if (ti <= ci) setCurrentStep(id);
  }

  const extraCount = Object.values(extras).filter(Boolean).length;

  /* ── Confirmation ── */
  if (bookingCode) {
    return (
      <div className="be-app" data-theme="editorial">
        <div className="be-page-inner">
          <Confirmation
            booking={booking} search={search} code={bookingCode} lang={lang}
            onManage={() => { setMode('manage'); setBookingCode(null); }}
            onNew={() => handleSearch({ checkin: getOffset(1), checkout: getOffset(4), guests: 2 })}
          />
        </div>
      </div>
    );
  }

  /* ── Manage ── */
  if (mode === 'manage') {
    return (
      <div className="be-app" data-theme="editorial">
        <div className="be-page-inner">
          <ManageBooking onBack={() => setMode('book')} lang={lang} />
        </div>
      </div>
    );
  }

  /* ── Booking flow ── */
  const translatedSelectedRoomName = selectedRoom ? (t.roomNames[selectedRoom.id] || selectedRoom.name) : '';
  const roomSummary = selectedRoom
    ? `${lang === 'es' ? 'Tipología' : 'Typology'} ${selectedRoom.num} — ${translatedSelectedRoomName} · ${selectedRate === 'best' ? t.bestPrice : t.flexible}`
    : '';
  
  const extraSummary = extraCount > 0
    ? (lang === 'es' 
        ? `${extraCount} extra${extraCount > 1 ? 's' : ''} seleccionado${extraCount > 1 ? 's' : ''}`
        : `${extraCount} extra${extraCount > 1 ? 's' : ''} selected`)
    : (lang === 'es' ? 'Sin extras adicionales' : 'No additional extras');
    
  const guestSummary = guestData.nombre
    ? `${guestData.nombre} ${guestData.apellido || ''} · ${guestData.email || ''}`
    : '';

  return (
    <div className="be-app" data-theme="editorial">
      <div className="be-page-inner">
        <SearchBar search={search} onSearch={handleSearch} lang={lang} />
        <StepProgress currentStep={currentStep} lang={lang} />
        <div className="be-body">
          <div className="be-steps">

            <StepWrapper num="1" title={lang === 'es' ? "Elige tu apartaestudio" : "Choose your apartaestudio"}
              state={stepState('rooms')} summaryLine={roomSummary} lang={lang}
              onEdit={() => goToStep('rooms')}>
              <div className="be-rooms-list">
                {BE_ROOMS.map(room => (
                  <RoomCard key={room.id} room={room}
                    nights={dateDiff(search.checkin, search.checkout)}
                    guests={search.guests}
                    rate={ratePerRoom[room.id] || 'flexible'}
                    onSelect={handleSelectRoom}
                    onRateChange={r => setRatePerRoom(p => ({ ...p, [room.id]: r }))}
                    lang={lang}
                  />
                ))}
              </div>
            </StepWrapper>

            <StepWrapper num="2" title={lang === 'es' ? "Extras y servicios" : "Extras & services"}
              state={stepState('extras')} summaryLine={extraSummary} lang={lang}
              onEdit={() => goToStep('extras')}>
              <ExtrasPanel extras={extras} setExtras={setExtras} search={search}
                onContinue={() => setCurrentStep('guest')} lang={lang} />
            </StepWrapper>

            <StepWrapper num="3" title={lang === 'es' ? "Datos del huésped" : "Guest details"}
              state={stepState('guest')} summaryLine={guestSummary} lang={lang}
              onEdit={() => goToStep('guest')}>
              <GuestForm guest={guestData} setGuest={setGuestData}
                onContinue={() => setCurrentStep('payment')} lang={lang} />
            </StepWrapper>

            <StepWrapper num="4" title={lang === 'es' ? "Resumen y pago" : "Summary & payment"}
              state={stepState('payment')} summaryLine="" lang={lang}
              onEdit={() => goToStep('payment')}>
              <PaymentPanel
                paymentMethod={paymentMethod}
                setPaymentMethod={setPaymentMethod}
                booking={booking}
                search={search}
                onConfirm={() => setBookingCode(genCode())}
                lang={lang}
              />
            </StepWrapper>

          </div>

          <aside className="be-summary-col">
            <div className="be-summary-sticky">
              <BookingSummary booking={booking} search={search} lang={lang} />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<BookingEngine />);
