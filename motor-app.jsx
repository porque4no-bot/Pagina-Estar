import React from 'react';
import * as ReactDOM from 'react-dom/client';
import i18nEngineEs from './i18n/motor.es.json';
import i18nEngineEn from './i18n/motor.en.json';
import {
  MAX_GUESTS,
  clampGuests,
  roomCapacity,
  roomFitsGuests,
  fill,
  phaseForPaymentStatus,
  interpretBookingStatus,
  interpretWompiStatus,
  wompiApiBase,
  nextPollDelay,
  fastPollsDone,
  readMpReturn,
  PAY_PENDING_KEY,
  readPendingPayment,
  splitPhoneForWompi,
  errorKeyForServerReason
} from './motor-logic.js';

const { useState, useEffect, useRef } = React;

/* ── Icon helper (Lucide UMD) ─────────────────────── */
function Icon({ name, size = 20, style, className }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && window.lucide) {
      window.lucide.createIcons({ nodes: [ref.current] });
    }
  }, [name]);
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', width: size, height: size, flexShrink: 0, ...style }}
      className={className}
    >
      <i key={name} ref={ref} data-lucide={name} />
    </span>
  );
}

/* ── Translation Dictionary (sourced from i18n/motor.{es,en}.json) ─ */
const i18nEngine = { es: i18nEngineEs, en: i18nEngineEn };

/* ── Analytics (A-6) ──────────────────────────────────
   GA4 e-commerce events for the booking funnel. gtag is loaded site-wide and
   gated by Consent Mode v2 (consent.js), so these calls are safe no-ops until
   the visitor opts in — we never branch on consent here. Every call is wrapped
   so a missing gtag (ad blocker / dev) never breaks the flow. */
function beTrack(eventName, params) {
  try {
    if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
      window.gtag('event', eventName, params || {});
    }
  } catch (e) { /* analytics must never break the booking flow */ }
}

/* Map a selected room + rate into a GA4 items[] entry. */
function gaItem(room, rate, search) {
  if (!room) return null;
  const nights = dateDiff(search.checkin, search.checkout);
  const nightly = rate === 'best' ? room.priceFlexible : Math.round(room.priceFlexible * 1.10);
  return {
    item_id: room.roomTypeId || room.id,
    item_name: room.name,
    item_category: 'habitacion',
    item_variant: rate === 'best' ? 'best_price' : 'flexible',
    price: nightly,
    quantity: Math.max(1, nights)
  };
}

/* ── Helper: get query parameters on load ────────── */
function parseQueryParams() {
  const params = new URLSearchParams(window.location.search);
  const checkin = params.get('checkin') || getOffset(1);
  const checkout = params.get('checkout') || getOffset(4);
  /* Tope = capacidad máxima (Selección admite 5); el select ofrece 1-5. */
  const guests = clampGuests(params.get('guests'), 2);

  let roomParam = params.get('room');
  if (roomParam === 'clasic') roomParam = 'clasica'; // compatibility mapping
  
  const payment = params.get('payment') || '';
  /* Frente codes: el correo del código personal/reseña enlaza a
     reservar.html?codigo=XXXX para dejarlo prellenado en el paso de pago (el
     servidor lo valida igual; esto solo ahorra escribirlo). */
  const promoCode = String(params.get('codigo') || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40);
  return { checkin, checkout, guests, roomParam, payment, promoCode };
}

/* Retorno de Mercado Pago: código de reserva leído de external_reference (MP lo
   agrega a la back_url) o, en su defecto, el guardado antes del redirect.
   La decodificación vive en motor-logic.readMpReturn (probada en unit tests). */
const MP_PENDING_KEY = 'estar-mp-pending';
function readMpReturnFromPage() {
  let stored = null;
  try { stored = sessionStorage.getItem(MP_PENDING_KEY); } catch (e) { /* noop */ }
  return readMpReturn(window.location.search, stored, Date.now());
}

/* Pago en curso (Wompi o Mercado Pago) guardado en sessionStorage: si el huésped
   recarga mientras confirmamos, retomamos la consulta en vez de devolverlo al
   paso de pago (donde podría pagar dos veces). */
function savePendingPayment(data) {
  try { sessionStorage.setItem(PAY_PENDING_KEY, JSON.stringify({ ...data, savedAt: Date.now() })); } catch (e) { /* noop */ }
}
function clearPendingPayment() {
  try { sessionStorage.removeItem(PAY_PENDING_KEY); } catch (e) { /* noop */ }
}
function loadPendingPayment() {
  try { return readPendingPayment(sessionStorage.getItem(PAY_PENDING_KEY), Date.now()); } catch (e) { return null; }
}

/* Estado de una transacción Wompi desde su API pública (solo lectura, la misma
   que consulta el widget). Ante cualquier fallo responde 'pending' y se sigue
   consultando booking-status, que es la fuente de verdad de la reserva. */
async function checkWompiTransaction(txId) {
  try {
    const r = await fetch(`${wompiApiBase(window.WOMPI_PUBLIC_KEY)}/transactions/${encodeURIComponent(txId)}`);
    if (!r.ok) return 'pending';
    const d = await r.json();
    return interpretWompiStatus(d && d.data && d.data.status);
  } catch (e) {
    return 'pending';
  }
}

/* Confirmación mínima cuando no hay borrador: habitación, fechas, huésped y
   monto salen de la referencia del pago de Mercado Pago (si la hay). */
function minimalFromReference(ref) {
  if (!ref) return { room: null, search: null, guest: {}, payableCents: null };
  const room = BE_ROOMS.find(r => String(r.roomTypeId) === String(ref.roomTypeId)) || null;
  return {
    room,
    search: (ref.checkin && ref.checkout) ? { checkin: ref.checkin, checkout: ref.checkout, guests: ref.guests || 1 } : null,
    guest: { nombre: ref.firstName, apellido: ref.lastName, email: ref.email },
    payableCents: ref.amountCents
  };
}

/* Aviso de respaldo cuando volvemos de Mercado Pago SIN forma de identificar la
   reserva (sin código guardado ni external_reference): no afirmamos que la
   reserva está confirmada porque no la pudimos consultar. */
function PaymentReturnNotice({ status, lang }) {
  if (!status) return null;
  const t = i18nEngine[lang];
  const copy = {
    success: { icon: 'check-circle', title: t.returnSuccessTitle, text: t.returnSuccessText },
    pending: { icon: 'clock', title: t.returnPendingTitle, text: t.returnPendingText },
    failure: { icon: 'alert-triangle', title: t.returnFailureTitle, text: t.returnFailureText }
  }[status];
  if (!copy) return null;
  return (
    <div className={`be-info-box${status === 'failure' ? ' be-info-error' : ''}`} style={{ marginBottom: 20 }}>
      <Icon name={copy.icon} size={18} />
      <p><strong>{copy.title}.</strong> {copy.text}</p>
    </div>
  );
}

/* ── SearchBar ────────────────────────────────────── */
function normalizeChoice(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function guestCountry(guest) {
  return (guest && guest.pais) || 'Colombia';
}

function guestMotive(guest, lang) {
  return (guest && guest.motivo) || (lang === 'es' ? 'Turismo / Vacaciones' : 'Tourism / Vacation');
}

function isColombianGuest(guest) {
  return normalizeChoice(guestCountry(guest)) === 'colombia';
}

function isBusinessGuest(guest, lang) {
  const motive = normalizeChoice(guestMotive(guest, lang));
  return motive.includes('negocio') || motive.includes('trabajo') || motive.includes('business') || motive.includes('work');
}

function mustChargeIva(guest, lang) {
  return isColombianGuest(guest) || isBusinessGuest(guest, lang);
}

function SearchBar({ search, onSearch, lang }) {
  const [s, setS] = useState(search);
  const [expanded, setExpanded] = useState(false);
  const t = i18nEngine[lang];

  useEffect(() => {
    setS(search);
  }, [expanded, search]);

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
              onChange={e => {
                const newCheckin = e.target.value;
                let newCheckout = s.checkout;
                if (newCheckout && newCheckin >= newCheckout) {
                  const parts = newCheckin.split('-');
                  const d = new Date(parts[0], parts[1] - 1, parts[2]);
                  d.setDate(d.getDate() + 1);
                  const year = d.getFullYear();
                  const month = String(d.getMonth() + 1).padStart(2, '0');
                  const day = String(d.getDate()).padStart(2, '0');
                  newCheckout = `${year}-${month}-${day}`;
                }
                setS({ ...s, checkin: newCheckin, checkout: newCheckout });
              }} />
          </div>
          <div className="be-field">
            <label>{t.checkout}</label>
            {/* min = checkin + 1: antes min={s.checkin} permitía checkout == checkin
                (0 noches), que el servidor rechaza con 400 y la UI mostraba como
                falso "sistema caído". Se fuerza al menos 1 noche. */}
            <input type="date" value={s.checkout} min={s.checkin ? addDays(s.checkin, 1) : getOffset(1)} required
              onChange={e => {
                let newCheckout = e.target.value;
                if (s.checkin && newCheckout && newCheckout <= s.checkin) {
                  newCheckout = addDays(s.checkin, 1);
                }
                setS({ ...s, checkout: newCheckout });
              }} />
          </div>
          <div className="be-field">
            <label>{t.guests}</label>
            <select value={s.guests} onChange={e => setS({ ...s, guests: parseInt(e.target.value) })}>
              {Array.from({ length: MAX_GUESTS }, (_, i) => i + 1).map(n => (
                <option key={n} value={n}>{t[String(n)]}</option>
              ))}
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
function RoomCard({ room, nights, guests, rate, onSelect, onRateChange, preselected, lang }) {
  const t = i18nEngine[lang];
  const priceBest = room.priceFlexible;
  const priceFlex = Math.round(room.priceFlexible * 1.10);
  /* Sin tarifa elegida no se asume ninguna: el huésped elige Flexible o
     Estricta de forma explícita antes de seleccionar el apartaestudio. */
  const hasRate = rate === 'best' || rate === 'flexible';
  const activePrice = rate === 'best' ? priceBest : priceFlex;
  const [rateHint, setRateHint] = useState(false);

  // Translate details
  const roomName = t.roomNames[room.id] || room.name;
  const roomDesc = t.roomDescs[room.id] || room.desc;
  const roomBed = t.roomBeds[room.bed] || room.bed;
  const roomView = t.roomViews[room.view] || room.view;

  /* Capacidad: con más huéspedes de los que admite, la tarjeta no se puede
     elegir y lo dice (antes salía "Agotado" o, si venía preseleccionada desde la
     página de la habitación, se podía pagar una Clásica para 4). */
  const capacity = roomCapacity(room);
  const overCapacity = !roomFitsGuests(room, guests);
  const isAvailable = !overCapacity && room.available !== false; // default to true

  function selectRoom() {
    if (!hasRate) { setRateHint(true); return; }
    onSelect(room, rate);
  }

  // Slider state
  const [activePhoto, setActivePhoto] = useState(0);
  const images = room.images || room.gallery || (room.image ? [room.image] : []) || [];

  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  function handleTouchStart(e) {
    touchStartX.current = e.changedTouches[0].screenX;
  }

  function handleTouchEnd(e) {
    touchEndX.current = e.changedTouches[0].screenX;
    const diff = touchStartX.current - touchEndX.current;
    const threshold = 40;
    if (diff > threshold) {
      nextPhoto(e);
    } else if (diff < -threshold) {
      prevPhoto(e);
    }
  }

  function nextPhoto(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setActivePhoto((prev) => (prev + 1) % images.length);
  }

  function prevPhoto(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setActivePhoto((prev) => (prev - 1 + images.length) % images.length);
  }

  return (
    <div className={`be-room-card${!isAvailable ? ' be-room-unavailable' : ''}${preselected && isAvailable ? ' be-room-card-preselected' : ''}`}
      data-room={room.id}>
      <div 
        className="be-room-photo"
        onTouchStart={images.length > 1 ? handleTouchStart : undefined}
        onTouchEnd={images.length > 1 ? handleTouchEnd : undefined}
        style={{ position: 'relative' }}
      >
        {images.length > 0 ? (
          <div className="slider-wrapper">
            <div 
              className="slider-track" 
              style={{ transform: `translateX(-${activePhoto * 100}%)`, display: 'flex', width: '100%', height: '100%', transition: 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)' }}
            >
              {images.map((imgUrl, idx) => (
                <div className="slider-slide" key={idx} style={{ width: '100%', height: '100%', flexShrink: 0 }}>
                  <img src={imgUrl} alt={`${roomName} - ${idx + 1}`} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <span className="be-room-photo-name">{roomName}</span>
        )}

        {images.length > 1 && (
          <React.Fragment>
            <button className="slider-arrow prev" aria-label="Imagen anterior" type="button" onClick={prevPhoto}>
              <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </button>
            <button className="slider-arrow next" aria-label="Imagen siguiente" type="button" onClick={nextPhoto}>
              <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
            <div className="slider-indicators">
              {images.map((_, idx) => (
                <span 
                  key={idx} 
                  className={`indicator${idx === activePhoto ? ' active' : ''}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setActivePhoto(idx);
                  }}
                />
              ))}
            </div>
          </React.Fragment>
        )}
        <div className="be-room-badge" style={{ zIndex: 1 }}>{lang === 'es' ? 'Tipología' : 'Typology'} {room.num}</div>
        {!isAvailable && (
          <div className="be-room-status-badge">
            {overCapacity ? fill(t.overCapacityBadge, { capacity }) : t.soldOut}
          </div>
        )}
      </div>
      <div className="be-room-info">
        <div>
          <h3 className="be-room-name">{roomName}</h3>
          <p className="be-room-desc">{roomDesc}</p>
        </div>
        <p className="be-room-specs-compact">
          {room.area} m² · {roomBed} · {room.capacity} {lang === 'es' ? 'pers.' : 'guests'} · {roomView}
        </p>
        {isAvailable ? (
          <React.Fragment>
            <p className="be-rate-heading" id={`rate-heading-${room.id}`}>{t.chooseRate}</p>
            <div className="be-rate-options" role="radiogroup" aria-labelledby={`rate-heading-${room.id}`}>
              <button type="button" role="radio" aria-checked={rate === 'flexible'}
                className={`be-rate-opt${rate === 'flexible' ? ' active' : ''}`}
                onClick={() => { setRateHint(false); onRateChange('flexible'); }}>
                <div className="be-rate-tag">
                  <span className="be-label">{t.flexible}</span>
                  <span className="be-badge-policy">{t.refundable}</span>
                </div>
                <div className="be-rate-price">{formatCOP(priceFlex)}<span>/{t.noche}</span></div>
                <div className="be-rate-sub">{t.freeCancel}</div>
              </button>
              <button type="button" role="radio" aria-checked={rate === 'best'}
                className={`be-rate-opt best${rate === 'best' ? ' active' : ''}`}
                onClick={() => { setRateHint(false); onRateChange('best'); }}>
                <div className="be-rate-tag">
                  <span className="be-label">{t.bestPrice}</span>
                  <span className="be-badge-save">{t.save10}</span>
                </div>
                <div className="be-rate-price">{formatCOP(priceBest)}<span>/{t.noche}</span></div>
                <div className="be-rate-sub">{t.strictCancel}</div>
              </button>
            </div>
            {rateHint && !hasRate && (
              <p className="be-rate-hint" role="alert">{t.rateRequired}</p>
            )}
            <div className="be-room-total-row">
              <span className="be-room-total-label">
                {nights} {nights === 1 ? t.noche : t.noches} · {guests} {guests === 1 ? t.huesped : t.huespedes}
              </span>
              <span className="be-room-total">
                {hasRate ? formatCOP(activePrice * nights) : `${t.fromPrice} ${formatCOP(priceBest * nights)}`} <span>{t.plusTax}</span>
              </span>
            </div>
            <p style={{ fontSize: 11, color: 'var(--ink-300)', fontStyle: 'italic', margin: '4px 0 8px 0', lineHeight: 1.4 }}>
              {lang === 'es' ? '* IVA alojamiento (19%) según nacionalidad y motivo del viaje. El desayuno paga INC 8% (no exento).' : '* Accommodation VAT (19%) depends on nationality and travel purpose. Breakfast pays 8% consumption tax (not exempt).'}
            </p>
            <button className="be-btn-primary be-room-select-btn" onClick={selectRoom}>
              {t.selectBtn}
            </button>
          </React.Fragment>
        ) : (
          <div className="be-room-unavailable-msg">
            <p>{overCapacity ? fill(t.overCapacityMsg, { capacity, guests }) : t.soldOutMsg}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── ExtrasPanel ──────────────────────────────────── */
function ExtrasPanel({ extras, setExtras, search, room, onContinue, lang }) {
  const t = i18nEngine[lang];
  const nights = dateDiff(search.checkin, search.checkout);
  const base = room ? room.priceFlexible : 0; /* los % usan la noche base */

  function toggle(id) { setExtras(prev => ({ ...prev, [id]: !prev[id] })); }

  /* Monto resuelto de cada extra. */
  function lineAmount(ex) {
    if (ex.kind === 'perGuestNight') return ex.price * search.guests * nights;
    if (ex.kind === 'pct') return Math.round(base * ex.pct);
    if (ex.kind === 'flat') return ex.price;
    return 0;
  }

  return (
    <div>
      <p className="be-section-intro">{t.extrasIntro}</p>
      <div className="be-extras-list">
        {BE_EXTRAS.map(ex => {
          const exName = t.extrasNames[ex.id] || ex.name;
          const exDesc = t.extrasDescs[ex.id] || ex.desc;

          /* Extras (checkbox): desayuno, late, early, mascota. */
          const exUnit = t.extrasUnits[ex.unit] || ex.unit;
          const displayPrice = ex.kind === 'perGuestNight' ? ex.price : lineAmount(ex);
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
                <span>{formatCOP(displayPrice)}</span>
                <span className="be-extra-unit">{exUnit}</span>
                {ex.kind === 'perGuestNight' && extras[ex.id] && lineAmount(ex) > 0 && (
                  <span className="be-extra-total">= {formatCOP(lineAmount(ex))}</span>
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
  function submit(e) {
    e.preventDefault();
    setGuest(prev => ({
      ...prev,
      pais: guestCountry(prev),
      motivo: guestMotive(prev, lang)
    }));
    onContinue();
  }

  const countries = lang === 'es'
    ? ['Colombia','Venezuela','Ecuador','Perú','México','Argentina','España','Estados Unidos','Otro']
    : ['Colombia','Venezuela','Ecuador','Peru','Mexico','Argentina','Spain','United States','Other'];

  return (
    <form onSubmit={submit}>
      <p className="be-section-intro">{t.guestIntro}</p>
      <div className="be-form-grid">
        <div className="be-field">
          <label htmlFor="guest-nombre">{t.firstName}</label>
          <input id="guest-nombre" type="text" required placeholder={t.firstName}
            value={guest.nombre || ''} onChange={e => set('nombre', e.target.value)} />
        </div>
        <div className="be-field">
          <label htmlFor="guest-apellido">{t.lastName}</label>
          <input id="guest-apellido" type="text" required placeholder={t.lastName}
            value={guest.apellido || ''} onChange={e => set('apellido', e.target.value)} />
        </div>
        <div className="be-field be-field-full">
          <label htmlFor="guest-email">{t.email}</label>
          <input id="guest-email" type="email" required placeholder="correo@ejemplo.com"
            value={guest.email || ''} onChange={e => set('email', e.target.value)} />
        </div>
        <div className="be-field">
          <label htmlFor="guest-tel">{t.phone}</label>
          <input id="guest-tel" type="tel" required placeholder="+57 300 000 0000"
            value={guest.tel || ''} onChange={e => set('tel', e.target.value)} />
        </div>
        <div className="be-field">
          <label htmlFor="guest-pais">{t.country}</label>
          <select id="guest-pais" value={guest.pais || 'Colombia'} onChange={e => set('pais', e.target.value)}>
            {countries.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="be-field">
          <label htmlFor="guest-motivo">{lang === 'es' ? 'Motivo del viaje' : 'Travel motive'}</label>
          <select id="guest-motivo" value={guest.motivo || (lang === 'es' ? 'Turismo / Vacaciones' : 'Tourism / Vacation')} onChange={e => set('motivo', e.target.value)}>
            {lang === 'es' ? (
              <>
                <option value="Turismo / Vacaciones">Turismo / Vacaciones</option>
                <option value="Trabajo / Negocios">Trabajo / Negocios</option>
                <option value="Estudios / Educación">Estudios / Educación</option>
                <option value="Tratamiento médico">Tratamiento médico</option>
                <option value="Otro">Otro</option>
              </>
            ) : (
              <>
                <option value="Tourism / Vacation">Tourism / Vacation</option>
                <option value="Work / Business">Work / Business</option>
                <option value="Studies / Education">Studies / Education</option>
                <option value="Medical treatment">Medical treatment</option>
                <option value="Other">Other</option>
              </>
            )}
          </select>
        </div>
        <div className="be-field be-field-full">
          <label htmlFor="guest-notas">{t.notes} <span style={{ fontWeight: 400, color: 'var(--ink-300)' }}>{t.notesOptional}</span></label>
          <textarea id="guest-notas" rows={3} placeholder={t.notesPlaceholder}
            value={guest.notas || ''} onChange={e => set('notas', e.target.value)} />
        </div>
        <div className="be-field be-field-full">
          <label htmlFor="guest-privacy" className="be-checkbox-label">
            <input id="guest-privacy" type="checkbox" required />
            {/* Enlaces a las políticas (pestaña nueva para no perder el formulario).
                Rutas relativas: en /en/ resuelven a las versiones en inglés. */}
            <span>
              {t.privacyAccept}{' '}
              <a href="cancelacion.html" target="_blank" rel="noopener noreferrer">{t.privacyCancelLink}</a>{' '}
              {t.privacyAnd}{' '}
              <a href="privacidad.html" target="_blank" rel="noopener noreferrer">{t.privacyPolicyLink}</a>
            </span>
          </label>
        </div>
        {/* Frente C — opt-in de marketing OPCIONAL, separado del consentimiento de
            privacidad (que sigue obligatorio arriba). Ley 1581: solo opt-in; sin
            marcar = NO marketing. El valor viaja en el body de create-wompi-signature
            (no en la referencia) y, con opt-in, el webhook lo cablea a Odoo. */}
        <div className="be-field be-field-full">
          <label htmlFor="guest-marketing" className="be-checkbox-label">
            <input id="guest-marketing" type="checkbox"
              checked={Boolean(guest.marketingOptIn)}
              onChange={e => set('marketingOptIn', e.target.checked)} />
            <span>{t.marketingOptIn}</span>
          </label>
          <p className="be-field-help" style={{ marginTop: 'var(--space-1)', color: 'var(--ink-300)' }}>{t.marketingOptInHelp}</p>
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

/* ── Sandbox credential detection ────────────────────
 * Returns true when the currently configured public key uses a sandbox prefix:
 *   - Wompi sandbox keys start with `pub_test_` (production keys are `pub_prod_`).
 *   - Mercado Pago test keys start with `TEST-` (production keys are `APP_USR-`).
 * Used to show a non-blocking visual signal on the payment step.
 */
function isSandboxPaymentEnv() {
  if (typeof window === 'undefined') return false;
  const wompiKey = window.WOMPI_PUBLIC_KEY;
  const mpKey = window.MERCADOPAGO_PUBLIC_KEY;
  const wompiSandbox = typeof wompiKey === 'string' && wompiKey.startsWith('pub_test_');
  const mpSandbox = typeof mpKey === 'string' && mpKey.startsWith('TEST-');
  return wompiSandbox || mpSandbox;
}

/* ── SandboxBanner ───────────────────────────────────
 * Small yellow pill shown at the top of the payment step when sandbox
 * credentials are detected. Hidden in production (returns null).
 */
function SandboxBanner({ lang }) {
  if (!isSandboxPaymentEnv()) return null;
  const t = i18nEngine[lang] || i18nEngine.es;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="sandbox-banner"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        margin: '0 0 16px 0',
        padding: '10px 14px',
        borderRadius: 999,
        background: '#fff7d6',
        border: '1px solid #e6c84a',
        color: '#6b5200',
        fontSize: 12,
        lineHeight: 1.4
      }}>
      <span
        style={{
          display: 'inline-block',
          padding: '2px 8px',
          borderRadius: 999,
          background: '#e6c84a',
          color: '#3a2d00',
          fontWeight: 700,
          letterSpacing: '0.04em',
          fontSize: 11,
          flexShrink: 0
        }}>
        {t.sandboxBannerTitle}
      </span>
      <span style={{ flex: 1 }}>{t.sandboxBannerBody}</span>
    </div>
  );
}

/* Medios de pago que aplican un código de descuento en el servidor.
   Wompi: create-wompi-signature/wompi-webhook validan y consumen el código
   (verifyDiscountCode/consumeDiscountUse). Mercado Pago (frente mp, oct-2026):
   create-mercadopago-preference revalida el código con el correo de la reserva
   (verifyDirectBookingAmount → verifyDiscountCode, incluido boundEmail) y cobra el
   monto con descuento; el webhook consume el uso tras crear la reserva. */
const DISCOUNT_PAYMENT_METHODS = ['wompi', 'mercadopago'];
function discountAllowedFor(paymentMethod) {
  return DISCOUNT_PAYMENT_METHODS.indexOf(paymentMethod) !== -1;
}

/* ── PaymentPanel ─────────────────────────────────── */
function PaymentPanel({ paymentMethod, setPaymentMethod, booking, search, onConfirm, discountApplied, setDiscountApplied, paymentNotice, onNoticeShown, initialDiscountCode, lang }) {
  const t = i18nEngine[lang];
  const calc = calcTotal(booking.room, booking.rate, booking.extras, search);
  const [loading, setLoading] = useState(false);
  const [paymentError, setPaymentError] = useState(null);

  /* Aviso que llega desde el seguimiento del pago (p. ej. Wompi rechazó un
     PSE que estaba en proceso): se muestra como error del paso de pago una sola
     vez (el padre lo limpia para que no reaparezca al volver a este paso). */
  useEffect(() => {
    if (!paymentNotice) return;
    setPaymentError(paymentNotice);
    if (onNoticeShown) onNoticeShown();
  }, [paymentNotice]);

  /* ── Frente A: discount code ──────────────────────────────────
     The field stays hidden until /api/validate-discount-code reports the
     feature is enabled (DISCOUNT_CODES_ENABLED). The discount is ALWAYS
     re-validated and re-priced server-side at signing time; this is only the
     in-line UX. `applied` holds the server's confirmed { code, discountCents }. */
  const [discountEnabledUi, setDiscountEnabledUi] = useState(false);
  const [discountInput, setDiscountInput] = useState(initialDiscountCode || '');
  const [discountChecking, setDiscountChecking] = useState(false);
  /* discountApplied/setDiscountApplied ahora vienen de BookingEngine (estado
     elevado) para que el resumen/confirmación/correo vean el descuento. */
  const [discountError, setDiscountError] = useState(null);

  /* The amount actually charged today (online subtotal minus any applied
     discount, never below 0). Used everywhere we previously used calc.subtotal. */
  const baseSubtotalCents = calc ? Math.round(calc.subtotal * 100) : 0;
  const discountCents = discountApplied ? Math.min(discountApplied.discountCents || 0, baseSubtotalCents) : 0;
  const payableCents = Math.max(0, baseSubtotalCents - discountCents);
  /* El medio elegido no aplica descuentos en el servidor (Mercado Pago hoy):
     no se puede aplicar un código y uno ya aplicado se retira. */
  const discountBlocked = !discountAllowedFor(paymentMethod);

  React.useEffect(() => {
    if (discountBlocked && discountApplied) {
      setDiscountApplied(null);
      setDiscountError(null);
    }
  }, [discountBlocked, discountApplied]);

  const discountReasonText = (reason) => {
    switch (reason) {
      case 'expired': return t.discountExpired;
      case 'already_used': return t.discountAlreadyUsed;
      case 'exhausted': return t.discountExhausted;
      case 'min_nights': return t.discountMinNights;
      case 'room_not_eligible': return t.discountRoom;
      case 'blackout': return t.discountBlackout;
      case 'email_mismatch': return t.discountEmailMismatch;
      default: return t.discountInvalid;
    }
  };

  React.useEffect(() => {
    /* Probe whether discounts are enabled (and hide the field if not). A blank
       code returns reason:'invalid' with enabled flag, which is all we need. */
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/validate-discount-code?code=__probe__');
        const d = await r.json();
        if (alive && d && d.enabled === true) setDiscountEnabledUi(true);
      } catch (e) { /* feature stays hidden */ }
    })();
    return () => { alive = false; };
  }, []);

  /* If the booking (room/rate/extras/dates) changes, drop a previously applied
     discount so the displayed total can never be stale vs. the server price. */
  React.useEffect(() => {
    setDiscountApplied(null);
    setDiscountError(null);
  }, [booking.room && booking.room.id, booking.rate, JSON.stringify(booking.extras), search.checkin, search.checkout, search.guests]);

  const applyDiscount = async () => {
    const code = (discountInput || '').trim().toUpperCase();
    if (!code || discountBlocked) return;
    setDiscountChecking(true);
    setDiscountError(null);
    setDiscountApplied(null);
    try {
      const params = new URLSearchParams({
        code,
        email: (booking.guest && booking.guest.email) || '',
        nights: String(calc ? calc.nights : ''),
        roomTypeId: booking.room.roomTypeId || '',
        checkin: search.checkin || '',
        checkout: search.checkout || '',
        subtotalCents: String(baseSubtotalCents)
      });
      const r = await fetch('/api/validate-discount-code?' + params.toString());
      const d = await r.json();
      if (d && d.valid) {
        setDiscountApplied({ code: d.code || code, discountCents: d.discountCents || 0 });
      } else {
        setDiscountError(discountReasonText(d && d.reason));
      }
    } catch (e) {
      setDiscountError(t.discountInvalid);
    } finally {
      setDiscountChecking(false);
    }
  };

  const removeDiscount = () => {
    setDiscountApplied(null);
    setDiscountError(null);
    setDiscountInput('');
  };

  const translatedRoomName = t.roomNames[booking.room.id] || booking.room.name;

  const isColombian = isColombianGuest(booking.guest);
  const isBusinessTrip = isBusinessGuest(booking.guest, lang);
  const mustPayIVA = mustChargeIva(booking.guest, lang);

  const handlePayment = async () => {
    setPaymentError(null);
    /* Capacidad: el servidor también lo rechaza (over_capacity), pero no
       dejamos ni siquiera intentar el pago si no caben. */
    if (!roomFitsGuests(booking.room, search.guests)) {
      setPaymentError(t.overCapacityError);
      return;
    }
    /* A-6: payment initiated. value is what we charge online (subtotal, no IVA,
       matching the Wompi amount). */
    const gi = gaItem(booking.room, booking.rate, search);
    beTrack('add_payment_info', {
      currency: 'COP',
      value: calc ? calc.subtotal : 0,
      payment_type: paymentMethod,
      items: gi ? [gi] : []
    });

    if (paymentMethod === 'mercadopago') {
      setLoading(true);
      const code = genCode();
      const extrasMask = buildExtrasMask(booking.extras);

      try {
        const response = await fetch('/api/create-mercadopago-preference', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'direct',
            bookingCode: code,
            /* Monto con el descuento ya aplicado (igual que Wompi); el servidor
               revalida el código y el precio contra OTASync. */
            amountCents: payableCents,
            discountCode: discountApplied ? discountApplied.code : '',
            checkin: search.checkin,
            checkout: search.checkout,
            guestsCount: search.guests,
            roomTypeId: booking.room.roomTypeId || "31349",
            roomName: booking.room.name,
            firstName: booking.guest?.nombre || '',
            lastName: booking.guest?.apellido || '',
            email: booking.guest?.email || '',
            phone: booking.guest?.tel || '',
            extrasMask,
            isColombian,
            isBusiness: isBusinessTrip,
            ratePlan: booking.rate === 'flexible' ? 'flexible' : 'best',
            /* Nota libre y opt-in de marketing (Ley 1581): viajan en el body, el
               servidor los guarda y el webhook los usa al crear la reserva. */
            notes: ((booking.guest && booking.guest.notas) || '').trim().slice(0, 500),
            marketingOptIn: Boolean(booking.guest && booking.guest.marketingOptIn),
            /* Para volver a /en/reservar.html si el huésped reservó en inglés. */
            lang
          })
        });
        const data = await response.json();
        if (!response.ok || !data.init_point) {
          const publicMessage = data.message || data.error || 'Mercado Pago preference failed';
          throw new Error(publicMessage);
        }
        /* Al volver de Mercado Pago (?payment=success) el motor retoma este código
           para consultar booking-status y mostrar la confirmación (como Wompi). */
        try {
          sessionStorage.setItem(MP_PENDING_KEY, JSON.stringify({ code: data.bookingCode || code, savedAt: Date.now() }));
        } catch (e) { /* noop: se recupera también desde external_reference */ }
        window.location.href = data.init_point;
      } catch (e) {
        console.error('[PaymentPanel] Mercado Pago error:', e.message);
        setLoading(false);
        /* Nunca mostrar el código interno (p. ej. "price_mismatch") al huésped. */
        let mpError;
        if (e.message === 'sold_out') {
          mpError = lang === 'es'
            ? 'Lo sentimos, la habitación seleccionada ya no tiene disponibilidad para las fechas elegidas.'
            : 'Sorry, the selected room is no longer available for the chosen dates.';
        } else if (e.message === 'price_mismatch') {
          mpError = lang === 'es'
            ? 'Hubo un cambio en la tarifa de la habitación. Por favor, recarga la página para ver los precios actualizados.'
            : 'There was a change in the room rate. Please refresh the page to view the updated pricing.';
        } else if (e.message === 'over_capacity') {
          mpError = t.overCapacityError;
        } else {
          mpError = t.paymentErrorFailed;
        }
        setPaymentError(mpError);
      }
      return;
    }

    // Wompi active path. Mercado Pago remains available as rollback via
    // PAYMENT_PROVIDER=mercadopago and the Mercado Pago Netlify variables.
    if (paymentMethod === 'wompi') {
      if (typeof window.WidgetCheckout === 'undefined') {
        setPaymentError(
          lang === 'es'
            ? 'La pasarela de pago Wompi no se cargó correctamente. Por favor recarga la página.'
            : 'Wompi payment gateway failed to load. Please refresh the page.'
        );
        return;
      }

      const wompiKey = window.WOMPI_PUBLIC_KEY;
      if (!wompiKey) {
        console.error('[PaymentPanel] WOMPI_PUBLIC_KEY is not set. Payment cannot be initialized.');
        setPaymentError(
          lang === 'es'
            ? 'La llave pública de Wompi no está configurada. Por favor recarga la página o contáctanos.'
            : 'Wompi public key is not configured. Please refresh the page or contact us.'
        );
        return;
      }

      setLoading(true);
      const code = genCode();

      // Encode booking details into the Wompi reference (max 255 chars)
      // Format: 1|checkinYYMMDD|checkoutYYMMDD|guests|roomTypeId|firstName|lastName|email|phone|extrasMask|code|colombian|business|priceCents|ratePlan
      const formatDateYYMMDD = (dStr) => {
        if (!dStr) return '000000';
        return dStr.replace(/-/g, '').substring(2);
      };

      const extrasMask = buildExtrasMask(booking.extras);

      const serialized = [
        '1', // version
        formatDateYYMMDD(search.checkin),
        formatDateYYMMDD(search.checkout),
        search.guests,
        booking.room.roomTypeId || "31349",
        (booking.guest?.nombre || '').trim().replace(/\|/g, ''),
        (booking.guest?.apellido || '').trim().replace(/\|/g, ''),
        (booking.guest?.email || '').trim().replace(/\|/g, ''),
        (booking.guest?.tel || '').trim().replace(/\|/g, ''),
        extrasMask,
        code,
        isColombian ? '1' : '0',
        isBusinessTrip ? '1' : '0',
        payableCents, // 14th field: price in cents (con descuento ya aplicado si lo hay)
        booking.rate === 'flexible' ? 'F' : 'B' // 15th field: plan tarifario (F=Flexible 100% hasta 24 h / B=Best=Estricta 100% hasta 7 días)
      ].join('|');

      const encodedRef = btoa(unescape(encodeURIComponent(serialized)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      if (encodedRef.length > 255) {
        setLoading(false);
        setPaymentError(t.paymentRefTooLong);
        return;
      }

      let wompiSignature;
      let sigData;
      try {
        const sigRes = await fetch('/api/create-wompi-signature', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reference: encodedRef,
            amountInCents: payableCents,
            currency: 'COP',
            /* Frente A: discount code travels APART from the reference; the
               server re-validates it and signs the discounted amount. */
            discountCode: discountApplied ? discountApplied.code : '',
            /* A8: free-text guest note (server persists it and the payment
               webhook attaches it to the OTASync reservation). */
            notes: ((booking.guest && booking.guest.notas) || '').trim().slice(0, 500),
            /* Frente C: opt-in de marketing (Ley 1581). Viaja en el body, NO en
               la referencia; el server lo persiste y, con opt-in, el webhook lo
               cablea a Odoo (tag + lista de Email Marketing). */
            marketingOptIn: Boolean(booking.guest && booking.guest.marketingOptIn)
          })
        });
        sigData = await sigRes.json();
        if (!sigRes.ok || !sigData.signature || !sigData.signature.integrity) {
          throw new Error(sigData.error || 'Wompi signature failed');
        }
        wompiSignature = sigData.signature.integrity;
      } catch (e) {
        console.error('[PaymentPanel] Wompi signature error:', e.message);
        setLoading(false);
        /* Códigos del servidor (sold_out / price_mismatch / over_capacity) →
           mensaje amable; nunca el código interno. */
        const errorKey = errorKeyForServerReason(e.message);
        const errorMsg = errorKey
          ? t[errorKey]
          : (lang === 'es'
            ? 'No se pudo preparar la firma de seguridad de Wompi. Por favor intenta de nuevo o contáctanos.'
            : 'Could not prepare the Wompi security signature. Please try again or contact us.');
        setPaymentError(errorMsg);
        return;
      }

      /* Teléfono e indicativo según el país del huésped (antes iba siempre +57
         con el número tal cual). Si no se puede deducir, el widget lo pide. */
      const customerData = {
        email: booking.guest?.email || '',
        fullName: `${booking.guest?.nombre || ''} ${booking.guest?.apellido || ''}`.trim()
      };
      const wompiPhone = splitPhoneForWompi(booking.guest?.tel, guestCountry(booking.guest));
      if (wompiPhone) {
        customerData.phoneNumber = wompiPhone.number;
        customerData.phoneNumberPrefix = wompiPhone.prefix;
      }

      const checkout = new window.WidgetCheckout({
        currency: 'COP',
        amountInCents: sigData.amountInCents,
        reference: sigData.reference,
        publicKey: wompiKey,
        signature: wompiSignature,
        customerData
      });

      checkout.open(function (result) {
        setLoading(false);
        const transaction = (result && result.transaction) || {};
        console.log('Wompi Transaction Callback:', transaction);

        /* APPROVED → confirmamos la reserva. PENDING (PSE, Nequi…) NO es un
           error: el pago sigue en proceso, así que mostramos "pago en proceso"
           y seguimos consultando (antes salía un error con "Intentar de nuevo",
           que invitaba a pagar dos veces). */
        if (transaction.status === 'APPROVED' || transaction.status === 'PENDING') {
          onConfirm(code, {
            provider: 'wompi',
            id: transaction.id,
            status: transaction.status,
            paymentMethod: transaction.payment_method_type,
            reference: transaction.reference
          });
        } else if (transaction.status === 'DECLINED') {
          setPaymentError(t.paymentErrorDeclined);
        } else if (transaction.status) {
          setPaymentError(t.paymentErrorFailed);
        }
        /* Sin transacción (el huésped cerró el widget): no es un error. */
      });

      // Reset loading after opening so that the button is not permanently disabled
      // if the user closes the checkout overlay manually.
      setTimeout(() => {
        setLoading(false);
      }, 1000);
    }
  };

  return (
    <div>
      <SandboxBanner lang={lang} />
      {calc && (
        <>
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
              <span>{mustPayIVA ? (lang === 'es' ? 'IVA a pagar en alojamiento (19%)*' : 'VAT due at property (19%)*') : (lang === 'es' ? 'IVA exento sujeto a validación*' : 'VAT exempt, subject to validation*')}</span>
              <span style={!mustPayIVA ? { textDecoration: 'line-through', opacity: 0.75 } : undefined}>{formatCOP(calc.iva)}</span>
            </div>
            {calc.inc > 0 && (
              <div className="be-summary-line">
                <span>{lang === 'es' ? 'INC desayuno (8%)*' : 'Breakfast consumption tax (8%)*'}</span>
                <span>{formatCOP(calc.inc)}</span>
              </div>
            )}
            {discountApplied && discountCents > 0 && (
              <div className="be-summary-line" style={{ color: 'var(--olive-700)' }}>
                <span>{t.discountLine} ({discountApplied.code})</span>
                <span>−{formatCOP(Math.round(discountCents / 100))}</span>
              </div>
            )}
            <div className="be-summary-line be-summary-total">
              <span>{lang === 'es' ? 'Total a pagar hoy' : 'Total to pay today'}</span>
              <span>{formatCOP(Math.round(payableCents / 100))}</span>
            </div>
          </div>

          {/* IVA note box */}
          {!mustPayIVA ? (
            <div className="be-info-box" style={{ marginTop: -4, marginBottom: 16, backgroundColor: 'var(--olive-100)', borderColor: 'var(--olive-300)' }}>
              <Icon name="sparkles" size={16} style={{ color: 'var(--olive-700)', marginTop: 2, flexShrink: 0 }} />
              <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--olive-700)' }}>
                <strong>{lang === 'es' ? '¡Estás exento de IVA!' : 'You are exempt from VAT!'}</strong>
                <p style={{ margin: '4px 0 0 0', opacity: 0.9 }}>
                  {lang === 'es' ? (
                    <>
                      Hoy solo cancelas el valor neto. Al declarar origen <strong>{booking.guest?.pais || 'Otro'}</strong> y viaje por turismo/ocio, el IVA queda exento de forma preliminar. Esta exención se valida con tu documento y motivo real de viaje; si la información no corresponde, el IVA ({formatCOP(calc.iva)}) se cobrará en el alojamiento.
                    </>
                  ) : (
                    <>
                      Today you only pay the net value. With declared origin <strong>{booking.guest?.pais || 'Other'}</strong> and a tourism/leisure trip, VAT is preliminarily exempt. This exemption is validated against your document and actual travel purpose; if the information does not match, VAT ({formatCOP(calc.iva)}) will be charged at the property.
                    </>
                  )}
                </p>
              </div>
            </div>
          ) : (
            <div className="be-info-box" style={{ marginTop: -4, marginBottom: 16, backgroundColor: 'var(--paper)', borderColor: 'var(--paper-400)' }}>
              <Icon name="info" size={16} style={{ color: 'var(--olive)', marginTop: 2, flexShrink: 0 }} />
              <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--ink)' }}>
                <strong>{lang === 'es' ? 'Sobre el IVA (19%)' : 'About VAT (19%)'}</strong>
                <p style={{ margin: '4px 0 0 0', opacity: 0.9 }}>
                  {lang === 'es' ? (
                    <>
                      Hoy solo cancelas el valor neto. {isBusinessTrip ? (
                        <>Como tu motivo de viaje es <strong>negocios/trabajo</strong> (a pesar de viajar desde el extranjero), debes pagar el IVA ({formatCOP(calc.iva)}) directamente en recepción al hacer check-in.</>
                      ) : (
                        <>Como tu país es <strong>Colombia</strong>, el IVA ({formatCOP(calc.iva)}) se pagará directamente en recepción durante el check-in.</>
                      )}
                    </>
                  ) : (
                    <>
                      Today you only pay the net value. {isBusinessTrip ? (
                        <>Since your travel motive is <strong>business/work</strong> (despite traveling from abroad), you are required to pay the VAT ({formatCOP(calc.iva)}) directly at the reception during check-in.</>
                      ) : (
                        <>Since your country is <strong>Colombia</strong>, the VAT ({formatCOP(calc.iva)}) will be paid directly at the reception during check-in.</>
                      )}
                    </>
                  )}
                </p>
              </div>
            </div>
          )}
        </>
      )}
      {discountEnabledUi && (
        <div style={{ marginTop: 8, marginBottom: 16 }}>
          <label style={{ display: 'block', fontFamily: 'var(--font-label)', fontSize: 12, letterSpacing: '0.06em', color: 'var(--ink)', marginBottom: 8 }}>
            {t.discountLabel}
          </label>
          {discountApplied ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 8, background: 'var(--olive-100)', border: '1px solid var(--olive-300)', color: 'var(--olive-700)', fontSize: 13 }}>
                <Icon name="check" size={14} />
                {t.discountApplied}: <strong>{discountApplied.code}</strong>
              </span>
              <button type="button" className="be-btn-secondary" style={{ padding: '8px 14px', fontSize: 12 }}
                onClick={removeDiscount} disabled={loading}>
                {t.discountRemove}
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                type="text"
                value={discountInput}
                onChange={(e) => setDiscountInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyDiscount(); } }}
                placeholder={t.discountPlaceholder}
                disabled={discountChecking || loading}
                style={{ flex: '1 1 180px', minWidth: 0, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14, textTransform: 'uppercase' }}
              />
              <button type="button" className="be-btn-secondary" style={{ padding: '10px 18px', fontSize: 13 }}
                onClick={applyDiscount} disabled={discountChecking || loading || discountBlocked || !discountInput.trim()}>
                {discountChecking ? t.discountChecking : t.discountApply}
              </button>
            </div>
          )}
          {discountBlocked && (
            <p className="be-discount-method-note" style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--fg-muted)' }}>{t.discountNotWithMercadoPago}</p>
          )}
          {discountError && (
            <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--terracotta-700)' }}>{discountError}</p>
          )}
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
              onClick={() => { setPaymentMethod(pm.id); setPaymentError(null); }}
              disabled={loading}>
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

      {paymentError && (
        <div className="be-info-box be-info-error" style={{ flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name="alert-triangle" size={18} style={{ color: 'var(--terracotta-700)', flexShrink: 0 }} />
            <p style={{ margin: 0 }}>{paymentError}</p>
          </div>
          <button
            className="be-btn-secondary"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => setPaymentError(null)}>
            {t.tryAgain}
          </button>
        </div>
      )}

      {paymentMethod === 'mercadopago' && !paymentError && (
        <div className="be-info-box">
          <Icon name="credit-card" size={16} style={{ color: 'var(--sand-700)', marginTop: 1 }} />
          <p>{t.paymentMercadoPagoInfo}</p>
        </div>
      )}

      {paymentMethod === 'wompi' && !paymentError && (
        <div className="be-info-box">
          <Icon name="credit-card" size={16} style={{ color: 'var(--sand-700)', marginTop: 1 }} />
          <p>{t.paymentWompiInfo}</p>
        </div>
      )}
      <div className="be-step-footer">
        <button className="be-btn-primary" style={{ padding: '14px 28px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, minWidth: 180, justifyContent: 'center' }}
          disabled={!paymentMethod || loading} onClick={handlePayment}>
          {loading ? (
            <>
              <div className="be-spinner-small"></div>
              <span>{lang === 'es' ? 'Procesando...' : 'Processing...'}</span>
            </>
          ) : (
            <span>{t.confirmBooking}</span>
          )}
        </button>
      </div>
    </div>
  );
}

/* ── MobileSummaryBar (sticky total on phones) ─────────────
   The editorial sidebar summary is hidden at <=680px; this collapsible
   sticky bar keeps the running total visible while the guest fills the
   form on mobile. Tapping it expands the full BookingSummary. */
function MobileSummaryBar({ booking, search, lang }) {
  const [open, setOpen] = useState(false);
  if (!booking.room) return null;
  const calc = calcTotal(booking.room, booking.rate, booking.extras, search);
  if (!calc) return null;
  const nights = dateDiff(search.checkin, search.checkout);
  const t = i18nEngine[lang];
  return (
    <div className={`be-mobile-summary${open ? ' open' : ''}`}>
      <button type="button" className="be-msum-bar" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="be-msum-info">
          <span className="be-msum-meta">{(lang === 'es' ? 'Total online hoy' : 'Total online today')} · {nights} {nights === 1 ? t.noche : t.noches}</span>
          <span className="be-msum-total">{formatCOP(booking.payableCents != null ? Math.round(booking.payableCents / 100) : calc.subtotal)}</span>
        </span>
        <Icon name="chevron-down" size={20} className="be-msum-chevron" />
      </button>
      {open && (
        <div className="be-msum-panel">
          <BookingSummary booking={booking} search={search} lang={lang} />
        </div>
      )}
    </div>
  );
}

/* ── BookingSummary (sidebar editorial) ───────────── */
function BookingSummary({ booking, search, lang }) {
  const t = i18nEngine[lang];
  const isColombian = isColombianGuest(booking.guest);
  const isBusinessTrip = isBusinessGuest(booking.guest, lang);
  const mustPayIVA = mustChargeIva(booking.guest, lang);
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
          : `✶ ${t.bestPrice} — ${t.strictCancel}`}
      </p>
      {calc && (
        <div className="be-summary-breakdown">
          <div className="be-summary-line sm"><span>{formatCOP(calc.nightly)} × {nights} {nights === 1 ? t.noche : t.noches}</span><span>{formatCOP(calc.roomSub)}</span></div>
          {calc.extrasLines && calc.extrasLines.map((line, li) => {
            const exName = t.extrasNames[line.key] || line.key;
            let label = exName;
            let breakdown = '';
            if (line.key === 'desayuno') {
              breakdown = `${formatCOP(20000)} × ${search.guests} ${search.guests === 1 ? t.huesped : t.huespedes} × ${nights} ${nights === 1 ? t.noche : t.noches}`;
            }
            return (
              <div key={line.key + li} className="be-summary-line sm" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                  <span>{label}</span>
                  <span>{formatCOP(line.amount)}</span>
                </div>
                {breakdown && <span style={{ fontSize: 10, opacity: 0.65, fontStyle: 'italic' }}>{breakdown}</span>}
              </div>
            );
          })}
          <div className="be-summary-line sm">
            <span>{mustPayIVA ? (lang === 'es' ? 'IVA a pagar en alojamiento (19%)*' : 'VAT due at property (19%)*') : (lang === 'es' ? 'IVA exento sujeto a validación*' : 'VAT exempt, subject to validation*')}</span>
            <span style={!mustPayIVA ? { textDecoration: 'line-through', opacity: 0.75 } : undefined}>{formatCOP(calc.iva)}</span>
          </div>
          {calc.inc > 0 && (
            <div className="be-summary-line sm">
              <span>{lang === 'es' ? 'INC desayuno (8%)*' : 'Breakfast consumption tax (8%)*'}</span>
              <span>{formatCOP(calc.inc)}</span>
            </div>
          )}
          {booking.discountCents > 0 && (
            <div className="be-summary-line sm"><span>{lang === 'es' ? 'Descuento' : 'Discount'}{booking.discountCode ? ` (${booking.discountCode})` : ''}</span><span>−{formatCOP(Math.round(booking.discountCents / 100))}</span></div>
          )}
          <div className="be-summary-line total"><span>{lang === 'es' ? 'Total online hoy' : 'Total online today'}</span><span>{formatCOP(booking.payableCents != null ? Math.round(booking.payableCents / 100) : calc.subtotal)}</span></div>
          <p style={{ fontSize: 10, opacity: 0.8, fontStyle: 'italic', margin: '6px 0 0 0', lineHeight: 1.3 }}>
            {lang === 'es' 
              ? (mustPayIVA
                ? `* El IVA se paga en el alojamiento (${isBusinessTrip ? 'requerido por viaje de negocios' : 'aplica para residentes en Colombia'}).`
                : '* Exención preliminar para extranjero en turismo/ocio; se validará al llegar y se cobrará IVA si la información no corresponde.')
              : (mustPayIVA
                ? `* VAT is paid at the property (${isBusinessTrip ? 'required for business travel' : 'applies to Colombian residents'}).`
                : '* Preliminary exemption for foreign tourism/leisure travel; it will be validated on arrival and VAT will be charged if the information does not match.')}
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Confirmation ─────────────────────────────────── */
/* outcome:
     'confirmed'  → reserva creada (código final de la reserva).
     'confirming' → pago aprobado; la reserva aún se está registrando (el
                    webhook no ha terminado o quedó en revisión). Llega por correo.
     'processing' → el pago sigue en proceso en el banco / la pasarela.
     'declined'   → la pasarela rechazó el pago.
     'soldout'    → el pago entró pero ya no había disponibilidad: la reserva no
                    se crea; el equipo contacta al huésped (devolución o alternativa).
   minimal: volvimos de Mercado Pago sin el borrador (otro navegador o venció):
   solo mostramos lo que viene en la referencia del pago, sin desglose de IVA. */
function Confirmation({ booking, search, code, paymentDetails, outcome = 'confirmed', polling, minimal, onManage, onNew, onRetry, lang }) {
  const t = i18nEngine[lang];
  const room = booking.room || null;
  const calc = (!minimal && room) ? calcTotal(room, booking.rate, booking.extras, search) : null;
  const isConfirmed = outcome === 'confirmed';

  const roomName = room ? (t.roomNames[room.id] || room.name) : '';
  const rateLabel = booking.rate === 'flexible' ? `${t.flexible} — ${t.refundable}` : `${t.bestPrice} — ${t.strictCancel}`;

  const isColombian = isColombianGuest(booking.guest);
  const isBusinessTrip = isBusinessGuest(booking.guest, lang);
  const mustPayIVA = mustChargeIva(booking.guest, lang);
  const paidAmount = booking.payableCents != null
    ? Math.round(booking.payableCents / 100)
    : (calc ? calc.subtotal : null);

  const heroTitle = {
    confirmed: t.successTitle,
    confirming: t.confirmingHero,
    processing: t.processingHero,
    declined: t.declinedHero,
    soldout: t.confirmingHero
  }[outcome] || t.successTitle;

  const statusBox = {
    confirming: { icon: 'clock', title: t.confirmingBoxTitle, text: t.confirmingBoxText },
    processing: { icon: 'clock', title: t.processingBoxTitle, text: t.processingBoxText },
    declined: { icon: 'alert-triangle', title: t.declinedHero + '.', text: t.paymentErrorDeclined },
    soldout: { icon: 'alert-triangle', title: t.soldOutBoxTitle, text: t.soldOutBoxText }
  }[outcome];
  const isError = outcome === 'declined' || outcome === 'soldout';

  /* App del huésped (check-in en línea) con el código prellenado: solo cuando la
     reserva ya existe en el PMS (antes no la encontraría). Ruta absoluta porque
     la app vive solo en la raíz (/guest.html), también para /en/. */
  const checkinHref = `/guest.html?code=${encodeURIComponent(code || '')}`;

  return (
    <div className={`be-confirmation be-confirmation-${outcome}`}>
      <div className="be-confirm-hero">
        <span className="be-confirm-icon">✶</span>
        <h2>{heroTitle}</h2>
        <p>{isConfirmed ? t.successCode : t.referenceLabel} <strong>{code}</strong></p>
        {/* El correo lo envía SOLO el servidor (webhook) cuando la reserva ya
            existe: confirmada → "Confirmación enviada a"; mientras se confirma o
            el pago sigue en proceso → "Te confirmaremos la reserva por correo a".
            Sin el correo en mano (retorno de MP sin borrador) no se promete. */}
        {isConfirmed && !minimal && booking.guest?.email && (
          <p style={{ marginTop: 8 }}>
            {t.successSent} <strong>{booking.guest.email}</strong>
          </p>
        )}
        {(outcome === 'confirming' || outcome === 'processing') && booking.guest?.email && (
          <p style={{ marginTop: 8 }}>
            {t.confirmByEmailAt} <strong>{booking.guest.email}</strong>
          </p>
        )}
      </div>
      {statusBox && (
        <div className={`be-info-box be-confirm-status${isError ? ' be-info-error' : ' be-pending-box'}`} role="status"
          style={{ marginBottom: 16, flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Icon name={statusBox.icon} size={18} />
            <p style={{ margin: 0 }}>
              <strong>{statusBox.title}</strong>{' '}{statusBox.text}
            </p>
          </div>
          {polling && !isError && (
            <p className="be-confirm-polling">
              <span className="be-spinner-small" aria-hidden="true"></span>
              <span>{t.stillChecking}</span>
            </p>
          )}
          {outcome === 'declined' && onRetry && (
            <button type="button" className="be-btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={onRetry}>
              {t.tryAgain}
            </button>
          )}
        </div>
      )}
      <div className="be-confirm-card">
        {room && (
          <div className="be-confirm-row">
            <span className="be-eyebrow">{t.stepRooms}</span>
            <p className="be-confirm-val">{lang === 'es' ? 'Tipología' : 'Typology'} {room.num} — {roomName}{room.area ? ` · ${room.area} m²` : ''}</p>
          </div>
        )}
        {search && search.checkin && search.checkout && (
          <div className="be-confirm-row two">
            <div>
              <span className="be-eyebrow">{t.checkin}</span>
              <p className="be-confirm-val">{fmtDate(search.checkin)} · 3:00 pm</p>
            </div>
            <div>
              <span className="be-eyebrow">{t.checkout}</span>
              <p className="be-confirm-val">{fmtDate(search.checkout)} · 11:00 am</p>
            </div>
          </div>
        )}
        {!minimal && booking.rate && (
          <div className="be-confirm-row">
            <span className="be-eyebrow">{lang === 'es' ? 'Tarifa' : 'Rate'}</span>
            <p className="be-confirm-val">{rateLabel}</p>
          </div>
        )}
        {paidAmount != null && outcome !== 'declined' && (
          <div className="be-confirm-row">
            <span className="be-eyebrow">
              {outcome === 'processing'
                ? (lang === 'es' ? 'Valor del pago (en proceso)' : 'Payment amount (in process)')
                : (lang === 'es' ? 'Pagado hoy (en línea)' : 'Paid today (online)')}
            </span>
            <p className="be-confirm-total" style={{ fontSize: 20 }}>{formatCOP(paidAmount)}</p>
          </div>
        )}
        {calc && mustPayIVA && (
          <div className="be-confirm-row" style={{ backgroundColor: 'var(--sand-100)' }}>
            <span className="be-eyebrow" style={{ color: 'var(--terracotta)' }}>{lang === 'es' ? 'IVA a pagar en Check-in' : 'VAT to pay at Check-in'}</span>
            <p className="be-confirm-val" style={{ fontSize: 16, color: 'var(--terracotta-700)', margin: '4px 0 0 0' }}>{formatCOP(calc.iva)}</p>
            <p style={{ fontSize: 11, color: 'var(--ink-500)', margin: '4px 0 0 0', lineHeight: 1.4 }}>
              {lang === 'es' ? (
                isBusinessTrip 
                  ? 'El IVA se cobrará en la recepción debido a que tu motivo de viaje es negocios o trabajo.' 
                  : 'Como residente de Colombia, el IVA se cobrará en la recepción del hotel.'
              ) : (
                isBusinessTrip 
                  ? 'VAT will be charged at reception because your travel motive is business or work.' 
                  : 'As a resident of Colombia, the VAT will be charged at the hotel reception.'
              )}
            </p>
          </div>
        )}
        {calc && !mustPayIVA && (
          <div className="be-confirm-row" style={{ backgroundColor: 'var(--olive-100)' }}>
            <span className="be-eyebrow" style={{ color: 'var(--olive-700)' }}>{lang === 'es' ? 'IVA (19%)' : 'VAT (19%)'}</span>
            <p className="be-confirm-val" style={{ fontSize: 14, color: 'var(--olive-700)', margin: '4px 0 0 0', textDecoration: 'line-through' }}>{formatCOP(calc.iva)}</p>
            <p style={{ fontSize: 11, color: 'var(--olive-700)', margin: '4px 0 0 0', lineHeight: 1.4, fontWeight: 'bold' }}>
              {lang === 'es' 
                ? 'Exención preliminar por extranjero en turismo/ocio. Se validará la información al llegar; si no corresponde, se cobrará IVA en el alojamiento.'
                : 'Preliminary exemption for foreign tourism/leisure travel. Information will be validated on arrival; if it does not match, VAT will be charged at the property.'}
            </p>
          </div>
        )}
        {paymentDetails && (() => {
          /* El estado del pago sale del desenlace (no solo del callback inicial:
             un PSE "PENDING" que luego se aprobó debe verse como Aprobado). */
          const payApproved = outcome === 'confirmed' || outcome === 'confirming' || paymentDetails.status === 'APPROVED';
          const payLabel = outcome === 'declined'
            ? (lang === 'es' ? 'Rechazado' : 'Declined')
            : payApproved
              ? (lang === 'es' ? 'Aprobado' : 'Approved')
              : (lang === 'es' ? 'En proceso' : 'In process');
          return (
            <div className="be-confirm-row" style={{ backgroundColor: 'var(--paper-200)', borderTop: '1px solid var(--paper-400)' }}>
              <span className="be-eyebrow" style={{ color: 'var(--olive)' }}>{lang === 'es' ? 'Detalles del pago' : 'Payment details'}</span>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, flexWrap: 'wrap', gap: 10 }}>
                <div>
                  {paymentDetails.id && (
                    <p className="be-confirm-val" style={{ fontSize: 13, margin: 0 }}>
                      <strong>{lang === 'es' ? 'ID de transacción:' : 'Transaction ID:'}</strong> {paymentDetails.id}
                    </p>
                  )}
                  <p className="be-confirm-val" style={{ fontSize: 13, margin: '4px 0 0 0', opacity: 0.85 }}>
                    <strong>{lang === 'es' ? 'Medio de pago:' : 'Payment method:'}</strong> {paymentDetails.paymentMethod || 'Wompi'}
                  </p>
                </div>
                <span style={{
                  backgroundColor: payApproved ? 'var(--olive-100)' : 'var(--terracotta-100)',
                  color: payApproved ? 'var(--olive-700)' : 'var(--terracotta-700)',
                  padding: '4px 10px',
                  fontSize: 10,
                  fontWeight: 700,
                  borderRadius: 'var(--radius-pill)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  display: 'inline-block'
                }}>
                  {payLabel}
                </span>
              </div>
            </div>
          );
        })()}
        {isConfirmed && (
          <div className="be-confirm-row be-confirm-checkin">
            <span className="be-eyebrow">{t.checkinOnline}</span>
            <p className="be-confirm-val" style={{ fontSize: 13, fontWeight: 400, margin: '4px 0 12px 0' }}>{t.checkinOnlineDesc}</p>
            <a className="be-btn-primary be-checkin-link" href={checkinHref} target="_blank" rel="noopener noreferrer">
              <Icon name="scan-line" size={15} /> {t.checkinOnline}
            </a>
          </div>
        )}
        {/* Siempre hay salida: en 'confirming'/'processing' el huésped puede hacer
            otra reserva (handleSearch detiene la consulta y borra el pago en
            curso, así una recarga no lo devuelve a esta pantalla). */}
        {onNew && (
          <div className="be-confirm-actions">
            {isConfirmed && (
              <button className="be-btn-secondary" onClick={onManage}>
                <Icon name="settings" size={15} /> {t.manageBooking}
              </button>
            )}
            <button className="be-btn-ghost" onClick={onNew}>{t.newBooking}</button>
          </div>
        )}
      </div>
      {!isError && <div className="be-confirm-next">
        <span className="be-eyebrow">{t.beforeArrival}</span>
        <div className="be-confirm-tips">
          {[
            { icon: 'map-pin', title: t.howToGet, body: t.howToGetDesc },
            { icon: 'clock', title: t.checkInOut, body: t.checkInOutDesc },
            { icon: 'phone', title: t.directContact, body: '+57 310 249 0414 · reservas@estar.com.co' },
          ].map(tip => (
            <div key={tip.icon} className="be-confirm-tip">
              <Icon name={tip.icon} size={18} style={{ color: 'var(--terracotta)', marginTop: 2 }} />
              <div><strong>{tip.title}</strong><p>{tip.body}</p></div>
            </div>
          ))}
        </div>
      </div>}
    </div>
  );
}

/* ── ManageBooking ────────────────────────────────── */
function ManageBooking({ onBack, lang }) {
  const t = i18nEngine[lang];
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  // result: null | 'loading' | 'found' | 'not-found' | 'error' | 'cancel-requested'
  const [result, setResult] = useState(null);
  const [bookingData, setBookingData] = useState(null);
  const [showCancel, setShowCancel] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [cancelSending, setCancelSending] = useState(false);
  const [cancelError, setCancelError] = useState(null);

  async function doRequestCancellation() {
    setCancelSending(true);
    setCancelError(null);
    try {
      const response = await fetch('/api/request-cancellation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim(), email: email.trim() })
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success) {
        setShowCancel(false);
        setResult('cancel-requested');
      } else if (data && data.reason === 'not_cancellable') {
        setCancelError(t.resCancelNotCancellable);
      } else {
        setCancelError(t.resCancelSendError);
      }
    } catch (err) {
      console.error('[ManageBooking] Cancellation request failed:', err.message);
      setCancelError(t.resCancelSendError);
    } finally {
      setCancelSending(false);
    }
  }

  async function doSearch(e) {
    e.preventDefault();
    setResult('loading');
    setBookingData(null);
    setShowCancel(false);
    setSearchError(null);

    try {
      const response = await fetch(`/api/get-booking?code=${encodeURIComponent(code.trim())}&email=${encodeURIComponent(email.trim())}`);
      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }
      const data = await response.json();

      if (data.found) {
        setBookingData(data);
        setResult('found');
      } else {
        setResult('not-found');
      }
    } catch (err) {
      console.error('[ManageBooking] Error fetching booking:', err.message);
      setSearchError(err.message);
      setResult('error');
    }
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
          <label htmlFor="manage-code">{t.bookingCodeLabel}</label>
          {/* El número de reserva es el del PMS (el que llega en el correo de
              confirmación); get-booking lo busca por ese id. */}
          <input id="manage-code" type="text" inputMode="text" autoComplete="off" placeholder={t.bookingCodePlaceholder} value={code}
            aria-describedby="manage-code-help"
            onChange={e => setCode(e.target.value)} required />
          <span id="manage-code-help" className="be-field-help">{t.bookingCodeHelp}</span>
        </div>
        <div className="be-field">
          <label>{t.email}</label>
          <input type="email" placeholder="correo@ejemplo.com" value={email}
            onChange={e => setEmail(e.target.value)} required />
        </div>
        <button type="submit" className="be-btn-primary" disabled={result === 'loading'}>
          {result === 'loading' ? (
            <><div className="be-spinner-small" style={{ display: 'inline-block', marginRight: 8 }}></div>{lang === 'es' ? 'Buscando...' : 'Searching...'}</>
          ) : t.searchBooking}
        </button>
      </form>

      {result === 'found' && bookingData && !showCancel && (
        <div className="be-manage-result">
          <div className="be-manage-found-header">
            <span>✶</span>
            <div>
              <span className="be-eyebrow">{t.resFound}</span>
              <p style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 17, color: 'var(--white)' }}>
                {bookingData.bookingCode}
              </p>
            </div>
          </div>
          <div className="be-manage-details">
            <div>
              <span className="be-eyebrow">{lang === 'es' ? 'Habitación' : 'Room'}</span>
              <p>{bookingData.roomName || (lang === 'es' ? 'Apartaestudio' : 'Apartaestudio')}</p>
            </div>
            <div>
              <span className="be-eyebrow">{t.resDates}</span>
              <p>{bookingData.checkIn} → {bookingData.checkOut}</p>
            </div>
            <div>
              <span className="be-eyebrow">{t.total}</span>
              <p>{formatCOP(bookingData.totalAmount)}</p>
            </div>
            {bookingData.guestName && (
              <div>
                <span className="be-eyebrow">{lang === 'es' ? 'Huésped' : 'Guest'}</span>
                <p>{bookingData.guestName}</p>
              </div>
            )}
          </div>
          <div className="be-manage-actions">
            <a className="be-btn-secondary" target="_blank" rel="noopener noreferrer"
              href={`https://api.whatsapp.com/send/?phone=573102490414&text=${encodeURIComponent(
                (lang === 'es'
                  ? `Hola, quiero modificar las fechas de mi reserva ${bookingData.bookingCode}.`
                  : `Hi, I would like to modify the dates of my booking ${bookingData.bookingCode}.`)
              )}`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
              <Icon name="calendar" size={14} /> {t.resModDates}
            </a>
            {bookingData.canCancel && (
              <button className="be-btn-danger" onClick={() => setShowCancel(true)}>
                {t.resCancel}
              </button>
            )}
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
          {cancelError && (
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--terracotta-700)', marginBottom: 16 }}>
              {cancelError}
            </p>
          )}
          <div style={{ display: 'flex', gap: 12 }}>
            <button className="be-btn-danger" disabled={cancelSending} onClick={doRequestCancellation}>
              {cancelSending ? (
                <><div className="be-spinner-small" style={{ display: 'inline-block', marginRight: 8 }}></div>{t.resCancelSending}</>
              ) : t.resCancelConfirmYes}
            </button>
            <button className="be-btn-secondary" disabled={cancelSending} onClick={() => { setShowCancel(false); setCancelError(null); }}>{t.back}</button>
          </div>
        </div>
      )}

      {result === 'cancel-requested' && (
        <div className="be-manage-result" style={{ marginTop: 24 }}>
          <div className="be-manage-found-header">
            <span>✶</span>
            <div>
              <span className="be-eyebrow">{t.resCancelRequested}</span>
              <p style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 17, color: 'var(--white)' }}>
                {bookingData ? bookingData.bookingCode : code}
              </p>
            </div>
          </div>
          <p style={{ padding: '16px 22px', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-500)', lineHeight: 1.6 }}>
            {t.resCancelRequestedDesc}
          </p>
        </div>
      )}

      {result === 'not-found' && (
        <div className="be-info-box be-info-error" style={{ marginTop: 24 }}>
          <Icon name="alert-circle" size={16} />
          <p>{t.resCancelError}</p>
        </div>
      )}

      {result === 'error' && (
        <div className="be-info-box be-info-error" style={{ marginTop: 24 }}>
          <Icon name="alert-triangle" size={16} />
          <p>
            {lang === 'es'
              ? 'Error al consultar la reserva. Por favor intenta de nuevo o contáctanos por WhatsApp.'
              : 'Error retrieving booking. Please try again or contact us on WhatsApp.'}
            {searchError && <span style={{ fontSize: 11, opacity: 0.7, display: 'block', marginTop: 4 }}>{searchError}</span>}
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Main App ─────────────────────────────────────── */
function BookingEngine() {
  const initialParams = parseQueryParams();
  
  /* Booking draft persistence — survives accidental refresh, back/forward
     navigation and the Wompi/Mercado Pago return redirect that lands the
     user back on reservar.html with a payment status in the query string.
     Drops anything older than 30 min so an abandoned draft does not surprise
     the next user of the same browser. */
  const DRAFT_KEY = 'estar-booking-draft';
  const DRAFT_TTL_MS = 30 * 60 * 1000;
  const readDraft = () => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.savedAt || Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
        sessionStorage.removeItem(DRAFT_KEY);
        return null;
      }
      return parsed;
    } catch (e) { return null; }
  };
  const draft = readDraft();

  const [lang, setLang] = useState(window.location.pathname.startsWith('/en/') ? 'en' : 'es');
  const [mode, setMode] = useState('book'); // 'book' | 'manage'
  const [search, setSearch] = useState(() => (draft && draft.search) || ({
    checkin: initialParams.checkin,
    checkout: initialParams.checkout,
    guests: initialParams.guests
  }));

  // State for API integration
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  /* Habitación pedida desde su página (?room=slug). Ya NO se salta al paso 2 con
     una tarifa asumida (Flexible quedaba elegida sin que el huésped la viera):
     se muestra primera y resaltada en el paso 1 para que vea disponibilidad,
     cupo y elija la tarifa. Si no caben los huéspedes, se avisa. */
  const matchingRoom = BE_ROOMS.find(r => r.id === initialParams.roomParam) || null;
  const [preselectedRoomId] = useState(() => (matchingRoom ? matchingRoom.id : null));
  const [capacityNotice, setCapacityNotice] = useState(() => {
    const guestsNow = (draft && draft.search && draft.search.guests) || initialParams.guests;
    if (!matchingRoom || roomFitsGuests(matchingRoom, guestsNow)) return null;
    return { roomId: matchingRoom.id, name: matchingRoom.name, capacity: roomCapacity(matchingRoom), guests: guestsNow };
  });

  /* Un borrador solo retoma pasos posteriores si trae habitación, tarifa
     elegida y cupo para los huéspedes; si no, vuelve al paso 1. */
  const draftReady = !!(draft && draft.selectedRoom && (draft.selectedRate === 'best' || draft.selectedRate === 'flexible')
    && roomFitsGuests(draft.selectedRoom, draft.search && draft.search.guests));
  const [selectedRoom, setSelectedRoom] = useState(() => (draftReady ? draft.selectedRoom : null));
  const [selectedRate, setSelectedRate] = useState(() => (draftReady ? draft.selectedRate : null));
  const [currentStep, setCurrentStep] = useState(() => (draftReady && draft.currentStep) ? draft.currentStep : 'rooms');
  const [ratePerRoom, setRatePerRoom] = useState(() => (draft && draft.ratePerRoom) || {});
  const [extras, setExtras] = useState(() => (draft && draft.extras) || {});
  const [guestData, setGuestData] = useState(() => (draft && draft.guestData) || {});
  /* Default to Wompi (Colombia's primary rail). The cliente can switch to
     Mercado Pago freely from the payment step — both flows are kept live. */
  const [paymentMethod, setPaymentMethod] = useState(() =>
    (draft && draft.paymentMethod) || 'wompi'
  );

  /* ── Seguimiento del pago ──────────────────────────────────────────────
     Al volver de Mercado Pago (?payment=success|pending con código) o si hay un
     pago en curso guardado (recarga durante la espera), se retoma la consulta a
     booking-status en vez de mostrar el paso de pago otra vez. */
  const [mpReturn] = useState(() => readMpReturnFromPage());
  const [resumePayment] = useState(() => (mpReturn ? null : loadPendingPayment()));
  const initialTracking = mpReturn || resumePayment;
  const [bookingCode, setBookingCode] = useState(null);
  const [paymentDetails, setPaymentDetails] = useState(null);
  const [creatingReservation, setCreatingReservation] = useState(() => !!initialTracking);
  /* payPhase: 'confirming' (pago aprobado) | 'processing' (pago en proceso). */
  const [payPhase, setPayPhase] = useState(() =>
    initialTracking ? (phaseForPaymentStatus(initialTracking.status) || 'confirming') : null);
  /* payOutcome: lo que muestra la confirmación — 'confirmed' | 'confirming' |
     'processing' | 'declined'. */
  const [payOutcome, setPayOutcome] = useState(null);
  const [payPolling, setPayPolling] = useState(false);
  const [paymentNotice, setPaymentNotice] = useState(null);
  /* Retorno de MP sin borrador: datos mínimos sacados de la referencia del pago. */
  const [minimalInfo, setMinimalInfo] = useState(null);
  const payRunRef = useRef(0);
  /* Cupón aplicado (elevado desde PaymentPanel): así el resumen, la barra móvil,
     la confirmación y el correo muestran el monto REALMENTE cobrado (con descuento)
     y no el subtotal. El descuento se re-valida/re-precia server-side igual. */
  const [discountApplied, setDiscountApplied] = useState(null); /* { code, discountCents } */

  /* Persist a snapshot of the draft on every meaningful change. Guest data
     can include email/phone — we accept that risk on a session-scoped store
     because it lets the user recover after a redirect. The draft is cleared
     in the confirmation handler once a reservation succeeds. */
  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
        savedAt: Date.now(),
        search,
        /* Persistir los campos de PRECIO y display, no solo id/roomTypeId/name:
           sin priceFlexible, calcTotal daba Math.round(undefined*1.10) = NaN y el
           resumen/pago mostraban "$ NaN", "undefined m²", "Tipología undefined" si
           el fetch de disponibilidad fallaba al restaurar. Al cargar disponibilidad
           la habitación se refresca; el precio se re-verifica server-side igual. */
        selectedRoom: selectedRoom ? {
          id: selectedRoom.id,
          roomTypeId: selectedRoom.roomTypeId,
          name: selectedRoom.name,
          priceFlexible: selectedRoom.priceFlexible,
          num: selectedRoom.num,
          area: selectedRoom.area,
          capacity: selectedRoom.capacity,
          bed: selectedRoom.bed,
          view: selectedRoom.view,
          image: selectedRoom.image,
          images: selectedRoom.images
        } : null,
        selectedRate,
        currentStep,
        ratePerRoom,
        extras,
        guestData,
        paymentMethod
      }));
    } catch (e) { /* quota exceeded or storage disabled — silently skip */ }
  }, [search, selectedRoom, selectedRate, currentStep, ratePerRoom, extras, guestData, paymentMethod]);

  // Track the latest in-flight availability request so quick date changes
  // never let an old response overwrite the newer one ("last write wins").
  const availabilityAbortRef = useRef(null);
  const availabilityRequestIdRef = useRef(0);

  // Fetch availability from Netlify serverless function
  const fetchAvailability = async () => {
    /* Cancel any in-flight request and bump the request id. The completion
       handler checks the id before touching state so a slow response from a
       previous query can never overwrite the latest one. */
    if (availabilityAbortRef.current) {
      try { availabilityAbortRef.current.abort(); } catch (e) { /* noop */ }
    }
    const myId = ++availabilityRequestIdRef.current;
    const controller = new AbortController();
    availabilityAbortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/check-availability?checkin=${search.checkin}&checkout=${search.checkout}&guests=${search.guests}`,
        { signal: controller.signal }
      );
      if (myId !== availabilityRequestIdRef.current) return; /* superseded */
      if (!response.ok) {
        throw new Error(i18nEngine[lang].availabilityError);
      }
      const data = await response.json();
      if (myId !== availabilityRequestIdRef.current) return;

      if (data && Array.isArray(data.rooms)) {
        // Render the list of rooms dynamically from the check-availability output array.
        // Use local static BE_ROOMS for secondary metadata lookup (images, icons).
        const mapped = data.rooms.map(apiRoom => {
          const localRoom = BE_ROOMS.find(r => String(r.roomTypeId) === String(apiRoom.id_room_types));
          if (localRoom) {
            return {
              ...localRoom,
              priceFlexible: apiRoom.avgPrice,
              available: apiRoom.available,
              totalPrice: apiRoom.totalPrice,
              image: apiRoom.image || localRoom.image
            };
          }
          return {
            id: apiRoom.id_room_types,
            roomTypeId: apiRoom.id_room_types,
            num: "0",
            name: apiRoom.name,
            area: 30,
            capacity: apiRoom.capacity || 2,
            bed: apiRoom.beds || "1 Queen size",
            view: apiRoom.view || "Vista ciudad",
            desc: apiRoom.description || "",
            priceFlexible: apiRoom.avgPrice,
            available: apiRoom.available,
            totalPrice: apiRoom.totalPrice,
            images: apiRoom.image ? [apiRoom.image] : [],
            amenities: []
          };
        });
        setRooms(mapped);
      } else {
        throw new Error(i18nEngine[lang].availabilityError);
      }
    } catch (err) {
      if (err.name === 'AbortError') return; /* cancelled, not a real error */
      if (myId !== availabilityRequestIdRef.current) return;
      console.error('Fetch availability error:', err);
      /* Siempre el texto para el huésped (nunca "Failed to fetch" ni el PMS). */
      setError(i18nEngine[lang].availabilityError);
    } finally {
      if (myId === availabilityRequestIdRef.current) setLoading(false);
    }
  };

  // Trigger fetch on search parameters change
  useEffect(() => {
    fetchAvailability();
    return () => {
      /* cleanup: abort in-flight request when the effect re-runs */
      if (availabilityAbortRef.current) {
        try { availabilityAbortRef.current.abort(); } catch (e) { /* noop */ }
      }
    };
  }, [search]);

  // Sync selected room details (like real price) once rooms array updates from the API
  useEffect(() => {
    if (selectedRoom) {
      const updated = rooms.find(r => r.id === selectedRoom.id);
      if (updated) {
        setSelectedRoom(updated);
      }
    }
  }, [rooms]);

  /* Guardas del flujo (no aplican mientras se sigue un pago ya hecho):
     - sin habitación o sin tarifa elegida no se puede estar más allá del paso 1;
     - si la habitación elegida no tiene cupo para los huéspedes, se vuelve al
       paso 1 con un aviso (el servidor también lo rechaza: over_capacity). */
  useEffect(() => {
    if (creatingReservation || bookingCode) return;
    if (selectedRoom && !roomFitsGuests(selectedRoom, search.guests)) {
      setCapacityNotice({ roomId: selectedRoom.id, name: selectedRoom.name, capacity: roomCapacity(selectedRoom), guests: search.guests });
      setSelectedRoom(null);
      setCurrentStep('rooms');
      return;
    }
    if (currentStep !== 'rooms' && (!selectedRoom || (selectedRate !== 'best' && selectedRate !== 'flexible'))) {
      setCurrentStep('rooms');
    }
  }, [selectedRoom, selectedRate, currentStep, search.guests, creatingReservation, bookingCode]);

  // Skip auto-scroll on initial mount so the SearchBar is visible above the room cards.
  // Only scroll when the user navigates between steps after the first render.
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    const timer = setTimeout(() => {
      const steps = document.querySelector('.be-steps');
      const target = steps || document.querySelector('.be-progress') || document.body;
      const offsetTop = target.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top: Math.max(0, offsetTop), behavior: 'smooth' });
    }, 80);
    return () => clearTimeout(timer);
  }, [currentStep]);

  useEffect(() => {
    window.enterManageMode = () => setMode('manage');
    return () => { delete window.enterManageMode; };
  }, []);

  /* Descuento aplicado (cupón): se pasa por booking para que el resumen, la barra
     móvil y la confirmación muestren el monto REALMENTE cobrado (payableCents) y
     no el subtotal sin descuento. */
  const bookingCalc = calcTotal(selectedRoom, selectedRate, extras, search);
  const baseSubtotalCents = bookingCalc ? Math.round(bookingCalc.subtotal * 100) : 0;
  const discountCents = discountApplied ? Math.min(discountApplied.discountCents || 0, baseSubtotalCents) : 0;
  const payableCents = Math.max(0, baseSubtotalCents - discountCents);
  const booking = {
    room: selectedRoom, rate: selectedRate, extras, guest: guestData, payment: paymentMethod,
    discountCents, payableCents, discountCode: discountApplied ? discountApplied.code : null
  };
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
    /* Elección explícita: sin tarifa o sin cupo no se avanza. */
    if ((rate !== 'best' && rate !== 'flexible') || !roomFitsGuests(room, search.guests)) return;
    setCapacityNotice(null);
    setSelectedRoom(room);
    setSelectedRate(rate);
    setCurrentStep('extras');
    /* A-6: room chosen → select_item + begin_checkout (start of the funnel). */
    const gi = gaItem(room, rate, search);
    if (gi) {
      beTrack('select_item', { item_list_id: 'rooms', items: [gi] });
      beTrack('begin_checkout', { currency: 'COP', value: gi.price * gi.quantity, items: [gi] });
    }
  }

  /* Detiene cualquier seguimiento de pago en curso (nueva búsqueda, gestionar…). */
  function stopPaymentTracking() {
    payRunRef.current += 1;
    setPayPolling(false);
  }

  function handleSearch(s) {
    stopPaymentTracking();
    clearPendingPayment();
    setSearch(s);
    setCurrentStep('rooms');
    setSelectedRoom(null);
    setSelectedRate(null);
    setCapacityNotice(null);
    setExtras({});
    setGuestData({});
    setPaymentMethod('wompi');
    setBookingCode(null);
    setPaymentDetails(null);
    setPayOutcome(null);
    setPayPhase(null);
    setPaymentNotice(null);
    setMinimalInfo(null);
    setCreatingReservation(false);
  }

  /* After payment lands, the cliente no longer creates the OTASync reservation
     directly — that's now the exclusive job of the payment webhook (Wompi or
     Mercado Pago). We poll /api/booking-status until the webhook reports the
     booking is confirmed, then drive the confirmation UI from that.

     Estados (motor-logic):
     - Pago APROBADO → "Estamos confirmando tu reserva". Si en ~1 min no hay
       confirmación, se muestra "estamos terminando de confirmarla, te llega por
       correo" y se sigue consultando en segundo plano unos minutos.
     - Pago EN PROCESO (PSE/Nequi/MP pending) → "Tu pago está en proceso" (no es
       un error ni se invita a pagar de nuevo) y se sigue consultando; en Wompi
       también se lee el estado de la transacción para detectar si se aprobó o
       se rechazó. */
  function handleConfirmBooking(code, details = null, opts = {}) {
    const run = ++payRunRef.current;
    const alive = () => payRunRef.current === run;
    const provider = (details && details.provider) || 'wompi';
    let phase = phaseForPaymentStatus(details && details.status) || 'confirming';

    setPaymentDetails(details);
    setPaymentNotice(null);
    setBookingCode(null);
    setPayOutcome(null);
    setPayPhase(phase);
    setPayPolling(true);
    setCreatingReservation(true);
    /* Registro del pago en curso: permite retomarlo si el huésped recarga. */
    const pendingRecord = {
      code,
      provider,
      txId: (details && details.id) || '',
      status: (details && details.status) || '',
      paymentMethod: (details && details.paymentMethod) || ''
    };
    savePendingPayment(pendingRecord);

    const calc = calcTotal(booking.room, booking.rate, booking.extras, search);
    /* paidAmount = lo REALMENTE cobrado online (con descuento), no el subtotal:
       antes el correo reportaba un "pagado" mayor al cargo real de Wompi. */
    const paidVal = payableCents != null ? Math.round(payableCents / 100) : (calc ? calc.subtotal : 0);

    /* El correo de confirmación lo envía SOLO el servidor (webhook de pago),
       cuando la reserva ya existe en el PMS. El navegador ya no lo pide: antes
       mandaba "Reserva confirmada" aun sin reserva (timeout/pendiente), con el
       código EST-, y el endpoint público permitía enviar correos a cualquiera. */

    const showInterim = (outcome) => {
      setBookingCode(code);
      setPayOutcome(outcome);
      setCreatingReservation(false);
    };

    const onConfirmed = (finalCode) => {
      if (!alive()) return;
      payRunRef.current += 1; /* fin del seguimiento */
      /* A-6: client-side purchase. The webhook also reports the conversion
         server-side (Measurement Protocol) so ad-blocked sessions still
         count; GA4 dedupes on transaction_id. value = amount charged online
         (subtotal, no IVA). */
      const gi = gaItem(booking.room, booking.rate, search);
      beTrack('purchase', {
        transaction_id: finalCode,
        currency: 'COP',
        /* Ingreso real cobrado online = con descuento aplicado (no el subtotal). */
        value: paidVal,
        items: gi ? [gi] : []
      });
      setPaymentDetails(prev => ({ ...(prev || details || {}), status: 'APPROVED' }));
      setBookingCode(finalCode);
      setPayOutcome('confirmed');
      setPayPolling(false);
      setCreatingReservation(false);
      /* Reservation locked in — clear the draft so a future visitor on this
         browser does not see this guest's data pre-filled. */
      try { sessionStorage.removeItem(DRAFT_KEY); } catch (e) { /* noop */ }
      clearPendingPayment();
    };

    const onDeclined = () => {
      if (!alive()) return;
      payRunRef.current += 1;
      clearPendingPayment();
      setPayPolling(false);
      setCreatingReservation(false);
      if (booking.room && booking.guest && booking.guest.email) {
        /* Con el borrador en mano: de vuelta al paso de pago con el aviso. */
        setBookingCode(null);
        setPayOutcome(null);
        setPaymentDetails(null);
        setCurrentStep('payment');
        setPaymentNotice(i18nEngine[lang].paymentErrorDeclined);
      } else {
        setBookingCode(code);
        setPayOutcome('declined');
      }
    };

    let attempt = 0;
    let interimShown = false;

    const pollOnce = async () => {
      if (!alive()) return;
      attempt += 1;
      let data = null;
      try {
        const r = await fetch(`/api/booking-status?ref=${encodeURIComponent(code)}`);
        data = await r.json().catch(() => null);
      } catch (err) {
        console.error('[booking-status] poll error:', err);
      }
      if (!alive()) return;
      const status = interpretBookingStatus(data);

      if (status === 'confirmed') {
        onConfirmed((data && data.bookingCode) || code);
        return;
      }

      if (status === 'soldOut') {
        /* Pago recibido sin disponibilidad: la reserva no se va a crear. Ni
           "llegará por correo" ni correo de confirmación; el equipo ya recibió
           la alerta y contacta al huésped (devolución o alternativa). */
        payRunRef.current += 1;
        clearPendingPayment();
        setPayPolling(false);
        showInterim('soldout');
        return;
      }

      if (status === 'reservationPending') {
        /* El webhook recibió el pago pero la reserva quedó en revisión: no es un
           error del huésped. "Estamos terminando de confirmarla" y seguimos
           consultando en segundo plano. */
        if (phase !== 'confirming') { phase = 'confirming'; setPayPhase('confirming'); }
        if (!interimShown) { interimShown = true; showInterim('confirming'); }
        else setPayOutcome('confirming');
      }

      if (phase === 'processing' && provider === 'wompi' && details && details.id) {
        const tx = await checkWompiTransaction(details.id);
        if (!alive()) return;
        if (tx === 'declined') { onDeclined(); return; }
        if (tx === 'approved') {
          phase = 'confirming';
          setPayPhase('confirming');
          setPaymentDetails(prev => ({ ...(prev || details || {}), status: 'APPROVED' }));
          if (interimShown) setPayOutcome('confirming');
          pendingRecord.status = 'APPROVED';
          savePendingPayment(pendingRecord);
        }
      }

      if (!interimShown && fastPollsDone(attempt, phase)) {
        console.warn('[booking-status] sin confirmación todavía; se sigue consultando en segundo plano');
        interimShown = true;
        showInterim(phase);
      }

      const delay = nextPollDelay(attempt, phase);
      if (delay == null) {
        /* Se acabaron las consultas: se borra el pago en curso para que una
           recarga posterior no vuelva a dejar al huésped en la espera. */
        clearPendingPayment();
        setPayPolling(false);
        if (!interimShown) { interimShown = true; showInterim(phase); }
        return;
      }
      setTimeout(pollOnce, delay);
    };

    /* Start polling immediately — the webhook is usually faster than the
       cliente-side redirect, so the first poll often returns confirmed. */
    pollOnce();
    return;
  }

  /* Retorno de Mercado Pago (?payment=success|pending) o pago en curso guardado
     (recarga durante la espera): se consulta booking-status igual que en Wompi
     y se muestra la confirmación. Sin borrador (otro navegador o venció) se
     muestra una confirmación mínima con lo que trae la referencia del pago. */
  const resumeHandledRef = useRef(false);
  useEffect(() => {
    if (resumeHandledRef.current) return;
    resumeHandledRef.current = true;
    if (initialParams.payment === 'failure') {
      try { sessionStorage.removeItem(MP_PENDING_KEY); } catch (e) { /* noop */ }
    }
    if (mpReturn) {
      try { sessionStorage.removeItem(MP_PENDING_KEY); } catch (e) { /* noop */ }
      /* Limpia ?payment=… para que un refresh no repita el flujo (el pago en
         curso queda guardado y se retoma desde ahí). */
      try { window.history.replaceState(null, '', window.location.pathname); } catch (e) { /* noop */ }
      if (!selectedRoom) setMinimalInfo(minimalFromReference(mpReturn.reference));
      handleConfirmBooking(mpReturn.code, {
        provider: 'mercadopago',
        id: mpReturn.paymentId || '',
        paymentMethod: 'Mercado Pago',
        status: mpReturn.status
      });
    } else if (resumePayment) {
      if (!selectedRoom) setMinimalInfo(minimalFromReference(null));
      handleConfirmBooking(resumePayment.code, {
        provider: resumePayment.provider || 'wompi',
        id: resumePayment.txId || '',
        paymentMethod: resumePayment.paymentMethod || '',
        status: resumePayment.status || 'APPROVED'
      });
    }
  }, []);

  function goToStep(id) {
    const ci = stepOrder.indexOf(currentStep);
    const ti = stepOrder.indexOf(id);
    if (ti <= ci) setCurrentStep(id);
  }

  const extraCount = Object.values(extras).filter(Boolean).length;

  /* ── Creating reservation loading screen ── */
  /* Cada estado con su texto: aprobado ("confirmando") ≠ en proceso. */
  if (creatingReservation && !bookingCode) {
    const processing = payPhase === 'processing';
    return (
      <div className="be-app" data-theme="editorial">
        <div className={`be-page-inner be-pay-wait be-pay-wait-${processing ? 'processing' : 'confirming'}`} role="status" aria-live="polite"
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 340, gap: 24, textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ width: 56, height: 56, border: '3px solid var(--border)', borderTopColor: 'var(--olive)', borderRadius: '50%', animation: 'booking-spin 0.9s linear infinite' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p className="t-h4" style={{ margin: 0 }}>
              {processing ? t.waitProcessingTitle : t.waitConfirmingTitle}
            </p>
            <p className="t-body-sm" style={{ margin: 0, color: 'var(--fg-muted)' }}>
              {processing ? t.waitProcessingText : t.waitConfirmingText}
            </p>
            <p className="t-body-sm" style={{ margin: '4px 0 0 0', color: 'var(--fg-muted)' }}>
              {t.waitCloseNote}
            </p>
          </div>
        </div>
      </div>
    );
  }

  /* ── Confirmation ── */
  if (bookingCode) {
    /* Sin borrador (retorno de MP en otro navegador o borrador vencido): se
       muestra lo que trae la referencia del pago, sin desglose. */
    const minimal = !selectedRoom;
    const mi = minimalInfo || {};
    const confirmBooking = minimal
      ? { room: mi.room || null, rate: null, extras: {}, guest: mi.guest || {}, payableCents: mi.payableCents != null ? mi.payableCents : null }
      : booking;
    const confirmSearch = minimal ? (mi.search || null) : search;
    return (
      <div className="be-app" data-theme="editorial">
        <div className="be-page-inner">
          <Confirmation
            booking={confirmBooking} search={confirmSearch} code={bookingCode} paymentDetails={paymentDetails}
            outcome={payOutcome || 'confirmed'} polling={payPolling} minimal={minimal} lang={lang}
            onManage={() => { stopPaymentTracking(); setMode('manage'); setBookingCode(null); }}
            onNew={() => handleSearch({ checkin: getOffset(1), checkout: getOffset(4), guests: 2 })}
            onRetry={() => handleSearch({ checkin: getOffset(1), checkout: getOffset(4), guests: 2 })}
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
        {/* Aviso de respaldo solo si volvimos de Mercado Pago sin poder identificar la reserva. */}
        {!mpReturn && <PaymentReturnNotice status={initialParams.payment} lang={lang} />}
        <SearchBar search={search} onSearch={handleSearch} lang={lang} />
        <StepProgress currentStep={currentStep} lang={lang} />
        <MobileSummaryBar booking={booking} search={search} lang={lang} />
        <div className="be-body">
          <div className="be-steps">

            <StepWrapper num="1" title={lang === 'es' ? "Elige tu apartaestudio" : "Choose your apartaestudio"}
              state={stepState('rooms')} summaryLine={roomSummary} lang={lang}
              onEdit={() => goToStep('rooms')}>
              {loading ? (
                <div className="be-loading">
                  <div className="be-spinner"></div>
                  <p>{lang === 'es' ? 'Buscando apartaestudios disponibles en tiempo real...' : 'Searching available apartaestudios in real-time...'}</p>
                </div>
              ) : error ? (
                <div className="be-error-box">
                  <Icon name="alert-triangle" size={24} style={{ color: 'var(--terracotta)' }} />
                  <p>{error}</p>
                  <button type="button" className="be-btn-primary" onClick={fetchAvailability}>
                    {lang === 'es' ? 'Intentar de nuevo' : 'Try again'}
                  </button>
                </div>
              ) : rooms.length === 0 || rooms.every(r => !r.available) ? (
                <div className="be-no-availability" style={{ padding: '40px 24px', textAlign: 'center', background: 'var(--white)', border: '1px solid var(--paper-400)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                  <Icon name="calendar-off" size={40} style={{ color: 'var(--terracotta)' }} />
                  <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--ink)' }}>
                    {lang === 'es' ? 'No hay disponibilidad para las fechas seleccionadas' : 'No availability for selected dates'}
                  </h3>
                  <p style={{ fontSize: 13, color: 'var(--ink-500)', lineHeight: 1.6, margin: '0 0 8px 0', maxWidth: 480 }}>
                    {lang === 'es' 
                      ? 'No encontramos apartaestudios libres para estas fechas. Puedes intentar buscando una semana después o escribirnos directamente por WhatsApp para ver si contamos con alguna alternativa o cancelación de última hora.' 
                      : 'We could not find free apartaestudios for these dates. You can try searching for a week later or write to us directly on WhatsApp to see if we have any alternatives or last-minute cancellations.'}
                  </p>
                  
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
                    <button className="be-btn-secondary" onClick={() => {
                      /* addDays trabaja en fecha local (toISOString pasaba a UTC y
                         podía correr un día fuera de Colombia). */
                      handleSearch({
                        checkin: addDays(search.checkin, 7),
                        checkout: addDays(search.checkout, 7),
                        guests: search.guests
                      });
                    }} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Icon name="calendar-days" size={14} />
                      <span>{lang === 'es' ? 'Buscar 1 semana después' : 'Search 1 week later'}</span>
                    </button>

                    <a href={`https://api.whatsapp.com/send/?phone=573102490414&text=${encodeURIComponent(
                      lang === 'es' 
                        ? `¡Hola! Estaba buscando disponibilidad en estar del ${search.checkin} al ${search.checkout} para ${search.guests} ${search.guests === 1 ? 'persona' : 'personas'} y el motor indica que no hay habitaciones libres. ¿Tienen alguna alternativa o cancelación?`
                        : `Hi! I was looking for availability at estar from ${search.checkin} to ${search.checkout} for ${search.guests} ${search.guests === 1 ? 'guest' : 'guests'} and the booking engine shows no available rooms. Do you have any alternatives or cancellations?`
                    )}`} target="_blank" rel="noopener noreferrer" className="be-btn-primary" style={{ backgroundColor: '#25D366', borderColor: '#25D366', color: 'var(--white)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <Icon name="message-circle" size={14} />
                      <span>{lang === 'es' ? 'Consultar por WhatsApp' : 'Inquire on WhatsApp'}</span>
                    </a>
                  </div>
                </div>
              ) : (
                <div className="be-rooms-list">
                  {capacityNotice && (
                    <div className="be-info-box be-capacity-notice" role="status" style={{ marginTop: 0 }}>
                      <Icon name="users" size={16} />
                      <p style={{ margin: 0 }}>
                        {fill(t.overCapacityNotice, {
                          room: t.roomNames[capacityNotice.roomId] || capacityNotice.name,
                          capacity: capacityNotice.capacity,
                          guests: capacityNotice.guests
                        })}
                      </p>
                    </div>
                  )}
                  {/* Con cupo y disponibles primero (la pedida desde su página va
                      de primera), luego sin cupo / agotadas; se respeta el orden
                      de la API dentro de cada grupo. */}
                  {[...rooms].sort((a, b) => {
                    const rank = r => {
                      const ok = r.available !== false && roomFitsGuests(r, search.guests);
                      if (!ok) return 2;
                      return r.id === preselectedRoomId ? 0 : 1;
                    };
                    return rank(a) - rank(b);
                  }).map(room => (
                    <RoomCard key={room.id} room={room}
                      nights={dateDiff(search.checkin, search.checkout)}
                      guests={search.guests}
                      rate={ratePerRoom[room.id]}
                      preselected={room.id === preselectedRoomId}
                      onSelect={handleSelectRoom}
                      onRateChange={r => setRatePerRoom(p => ({ ...p, [room.id]: r }))}
                      lang={lang}
                    />
                  ))}
                </div>
              )}
            </StepWrapper>

            <StepWrapper num="2" title={lang === 'es' ? "Extras y servicios" : "Extras & services"}
              state={stepState('extras')} summaryLine={extraSummary} lang={lang}
              onEdit={() => goToStep('extras')}>
              <ExtrasPanel extras={extras} setExtras={setExtras} search={search} room={selectedRoom}
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
                onConfirm={handleConfirmBooking}
                discountApplied={discountApplied}
                setDiscountApplied={setDiscountApplied}
                paymentNotice={paymentNotice}
                onNoticeShown={() => setPaymentNotice(null)}
                initialDiscountCode={initialParams.promoCode}
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
