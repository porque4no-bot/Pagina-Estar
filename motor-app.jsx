import React from 'react';
import * as ReactDOM from 'react-dom/client';
import i18nEngineEs from './i18n/motor.es.json';
import i18nEngineEn from './i18n/motor.en.json';

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
  const nightly = rate === 'best' ? room.priceFlexible : Math.round(room.priceFlexible / 0.9);
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
  let guests = parseInt(params.get('guests'));
  if (isNaN(guests) || guests < 1) guests = 2;
  
  let roomParam = params.get('room');
  if (roomParam === 'clasic') roomParam = 'clasica'; // compatibility mapping
  
  const payment = params.get('payment') || '';
  return { checkin, checkout, guests, roomParam, payment };
}

function PaymentReturnNotice({ status, lang }) {
  if (!status) return null;
  const copy = {
    success: {
      icon: 'check-circle',
      title: lang === 'es' ? 'Pago recibido' : 'Payment received',
      text: lang === 'es'
        ? 'Estamos confirmando tu reserva con Kunas. Recibirás la confirmación por correo cuando el webhook termine el proceso.'
        : 'We are confirming your booking with Kunas. You will receive an email confirmation once the webhook finishes processing.'
    },
    pending: {
      icon: 'clock',
      title: lang === 'es' ? 'Pago pendiente' : 'Payment pending',
      text: lang === 'es'
        ? 'Tu pago quedó pendiente de aprobación. La reserva se confirmará automáticamente cuando Mercado Pago apruebe la transacción.'
        : 'Your payment is pending approval. The booking will be confirmed automatically once Mercado Pago approves the transaction.'
    },
    failure: {
      icon: 'alert-triangle',
      title: lang === 'es' ? 'Pago no completado' : 'Payment not completed',
      text: lang === 'es'
        ? 'No se completó el pago. Puedes intentarlo de nuevo o escribirnos por WhatsApp.'
        : 'The payment was not completed. You can try again or contact us on WhatsApp.'
    }
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
            <input type="date" value={s.checkout} min={s.checkin || getOffset(1)} required
              onChange={e => setS({ ...s, checkout: e.target.value })} />
          </div>
          <div className="be-field">
            <label>{t.guests}</label>
            <select value={s.guests} onChange={e => setS({ ...s, guests: parseInt(e.target.value) })}>
              <option value={1}>{t["1"]}</option>
              <option value={2}>{t["2"]}</option>
              <option value={3}>{t["3"]}</option>
              <option value={4}>{t["4"]}</option>
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
  const priceBest = room.priceFlexible;
  const priceFlex = Math.round(room.priceFlexible / 0.9);
  const activePrice = rate === 'best' ? priceBest : priceFlex;

  // Translate details
  const roomName = t.roomNames[room.id] || room.name;
  const roomDesc = t.roomDescs[room.id] || room.desc;
  const roomBed = t.roomBeds[room.bed] || room.bed;
  const roomView = t.roomViews[room.view] || room.view;

  const isAvailable = room.available !== false; // default to true

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
    <div className={`be-room-card${!isAvailable ? ' be-room-unavailable' : ''}`}>
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
            {t.soldOut}
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
            <p style={{ fontSize: 11, color: 'var(--ink-300)', fontStyle: 'italic', margin: '4px 0 8px 0', lineHeight: 1.4 }}>
              {lang === 'es' ? '* IVA (19%) segun nacionalidad y motivo del viaje' : '* VAT (19%) depends on nationality and travel purpose'}
            </p>
            <button className="be-btn-primary be-room-select-btn" onClick={() => onSelect(room, rate)}>
              {t.selectBtn}
            </button>
          </React.Fragment>
        ) : (
          <div className="be-room-unavailable-msg">
            <p>{t.soldOutMsg}</p>
          </div>
        )}
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

/* ── PaymentPanel ─────────────────────────────────── */
function PaymentPanel({ paymentMethod, setPaymentMethod, booking, search, onConfirm, lang }) {
  const t = i18nEngine[lang];
  const calc = calcTotal(booking.room, booking.rate, booking.extras, search);
  const [loading, setLoading] = useState(false);
  const [paymentError, setPaymentError] = useState(null);

  const translatedRoomName = t.roomNames[booking.room.id] || booking.room.name;

  const isColombian = isColombianGuest(booking.guest);
  const isBusinessTrip = isBusinessGuest(booking.guest, lang);
  const mustPayIVA = mustChargeIva(booking.guest, lang);

  const handlePayment = async () => {
    setPaymentError(null);
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
      const extrasKeys = ['desayuno', 'parqueadero', 'late', 'early', 'traslado', 'tour'];
      const extrasMask = extrasKeys.map(k => booking.extras[k] ? '1' : '0').join('');

      try {
        const response = await fetch('/api/create-mercadopago-preference', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'direct',
            bookingCode: code,
            amountCents: Math.round(calc.subtotal * 100),
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
            isBusiness: isBusinessTrip
          })
        });
        const data = await response.json();
        if (!response.ok || !data.init_point) {
          const publicMessage = data.message || data.error || 'Mercado Pago preference failed';
          throw new Error(publicMessage);
        }
        window.location.href = data.init_point;
      } catch (e) {
        console.error('[PaymentPanel] Mercado Pago error:', e.message);
        setLoading(false);
        setPaymentError(e.message || t.paymentErrorFailed);
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
      // Format: 1|checkinYYMMDD|checkoutYYMMDD|guests|roomTypeId|firstName|lastName|email|phone|extrasMask|code
      const formatDateYYMMDD = (dStr) => {
        if (!dStr) return '000000';
        return dStr.replace(/-/g, '').substring(2);
      };

      const extrasKeys = ['desayuno', 'parqueadero', 'late', 'early', 'traslado', 'tour'];
      const extrasMask = extrasKeys.map(k => booking.extras[k] ? '1' : '0').join('');

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
        Math.round(calc.subtotal * 100) // 14th field: price in cents
      ].join('|');

      const encodedRef = btoa(unescape(encodeURIComponent(serialized)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      if (encodedRef.length > 255) {
        setLoading(false);
        setPaymentError(
          lang === 'es'
            ? 'Los datos de la reserva son demasiado largos para iniciar el pago. Acorta nombres, telefono o notas e intentalo de nuevo.'
            : 'The reservation data is too long to start payment. Shorten names, phone, or notes and try again.'
        );
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
            amountInCents: Math.round(calc.subtotal * 100),
            currency: 'COP'
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
        let errorMsg;
        if (e.message === 'sold_out') {
          errorMsg = lang === 'es'
            ? 'Lo sentimos, la habitación seleccionada ya no tiene disponibilidad para las fechas elegidas.'
            : 'Sorry, the selected room is no longer available for the chosen dates.';
        } else if (e.message === 'price_mismatch') {
          errorMsg = lang === 'es'
            ? 'Hubo un cambio en la tarifa de la habitación. Por favor, recarga la página para ver los precios actualizados.'
            : 'There was a change in the room rate. Please refresh the page to view the updated pricing.';
        } else {
          errorMsg = lang === 'es'
            ? 'No se pudo preparar la firma de seguridad de Wompi. Por favor intenta de nuevo o contáctanos.'
            : 'Could not prepare the Wompi security signature. Please try again or contact us.';
        }
        setPaymentError(errorMsg);
        return;
      }

      const checkout = new window.WidgetCheckout({
        currency: 'COP',
        amountInCents: sigData.amountInCents,
        reference: sigData.reference,
        publicKey: wompiKey,
        signature: wompiSignature,
        customerData: {
          email: booking.guest?.email || '',
          fullName: `${booking.guest?.nombre || ''} ${booking.guest?.apellido || ''}`.trim(),
          phoneNumber: booking.guest?.tel || '',
          phoneNumberPrefix: '+57'
        }
      });

      checkout.open(function (result) {
        setLoading(false);
        const transaction = result.transaction;
        console.log('Wompi Transaction Callback:', transaction);

        if (transaction.status === 'APPROVED') {
          onConfirm(code, {
            id: transaction.id,
            status: transaction.status,
            paymentMethod: transaction.payment_method_type,
            reference: transaction.reference
          });
        } else if (transaction.status === 'PENDING') {
          setPaymentError(
            lang === 'es'
              ? 'Tu pago quedo pendiente de aprobacion. La reserva se confirmara cuando Wompi apruebe la transaccion.'
              : 'Your payment is pending approval. The booking will be confirmed when Wompi approves the transaction.'
          );
        } else if (transaction.status === 'DECLINED') {
          setPaymentError(t.paymentErrorDeclined);
        } else {
          setPaymentError(t.paymentErrorFailed);
        }
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
              <span>{mustPayIVA ? (lang === 'es' ? 'IVA a pagar en alojamiento (19%)*' : 'VAT due at property (19%)*') : (lang === 'es' ? 'IVA exento sujeto a validacion*' : 'VAT exempt, subject to validation*')}</span>
              <span style={!mustPayIVA ? { textDecoration: 'line-through', opacity: 0.75 } : undefined}>{formatCOP(calc.iva)}</span>
            </div>
            <div className="be-summary-line be-summary-total">
              <span>{lang === 'es' ? 'Total a pagar hoy' : 'Total to pay today'}</span>
              <span>{formatCOP(calc.subtotal)}</span>
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
                      Hoy solo cancelas el valor neto. Al declarar origen <strong>{booking.guest?.pais || 'Otro'}</strong> y viaje por turismo/ocio, el IVA queda exento de forma preliminar. Esta exencion se valida con tu documento y motivo real de viaje; si la informacion no corresponde, el IVA ({formatCOP(calc.iva)}) se cobrara en el alojamiento.
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
            {lang === 'es' ? 'Intentar de nuevo' : 'Try again'}
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
          : `✶ ${t.bestPrice} — ${t.nonRefundable}`}
      </p>
      {calc && (
        <div className="be-summary-breakdown">
          <div className="be-summary-line sm"><span>{formatCOP(calc.nightly)} × {nights} {nights === 1 ? t.noche : t.noches}</span><span>{formatCOP(calc.roomSub)}</span></div>
          {calc.extrasSub > 0 && BE_EXTRAS.filter(ex => booking.extras && booking.extras[ex.id]).map(ex => {
            const exName = t.extrasNames[ex.id] || ex.name;
            let breakdown = '';
            let exTotal = 0;
            if (ex.id === 'desayuno') {
              exTotal = ex.price * search.guests * nights;
              breakdown = `${formatCOP(ex.price)} × ${search.guests} ${search.guests === 1 ? t.huesped : t.huespedes} × ${nights} ${nights === 1 ? t.noche : t.noches}`;
            } else if (ex.id === 'parqueadero') {
              exTotal = ex.price * nights;
              breakdown = `${formatCOP(ex.price)} × ${nights} ${nights === 1 ? t.noche : t.noches}`;
            } else if (ex.id === 'tour') {
              exTotal = ex.price * search.guests;
              breakdown = `${formatCOP(ex.price)} × ${search.guests} ${search.guests === 1 ? t.huesped : t.huespedes}`;
            } else {
              exTotal = ex.price;
              breakdown = formatCOP(ex.price);
            }
            return (
              <div key={ex.id} className="be-summary-line sm" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                  <span>{exName}</span>
                  <span>{formatCOP(exTotal)}</span>
                </div>
                <span style={{ fontSize: 10, opacity: 0.65, fontStyle: 'italic' }}>{breakdown}</span>
              </div>
            );
          })}
          <div className="be-summary-line sm">
            <span>{mustPayIVA ? (lang === 'es' ? 'IVA a pagar en alojamiento (19%)*' : 'VAT due at property (19%)*') : (lang === 'es' ? 'IVA exento sujeto a validacion*' : 'VAT exempt, subject to validation*')}</span>
            <span style={!mustPayIVA ? { textDecoration: 'line-through', opacity: 0.75 } : undefined}>{formatCOP(calc.iva)}</span>
          </div>
          <div className="be-summary-line total"><span>{lang === 'es' ? 'Total online hoy' : 'Total online today'}</span><span>{formatCOP(calc.subtotal)}</span></div>
          <p style={{ fontSize: 10, opacity: 0.8, fontStyle: 'italic', margin: '6px 0 0 0', lineHeight: 1.3 }}>
            {lang === 'es' 
              ? (mustPayIVA
                ? `* El IVA se paga en el alojamiento (${isBusinessTrip ? 'requerido por viaje de negocios' : 'aplica para residentes en Colombia'}).`
                : '* Exencion preliminar para extranjero en turismo/ocio; se validara al llegar y se cobrara IVA si la informacion no corresponde.')
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
function Confirmation({ booking, search, code, paymentDetails, onManage, onNew, lang }) {
  const t = i18nEngine[lang];
  const calc = calcTotal(booking.room, booking.rate, booking.extras, search);
  const reservationPending = !!(paymentDetails && paymentDetails.reservationPending);

  const roomName = t.roomNames[booking.room.id] || booking.room.name;
  const rateLabel = booking.rate === 'flexible' ? `${t.flexible} — ${t.refundable}` : `${t.bestPrice} — ${t.nonRefundable}`;

  const isColombian = isColombianGuest(booking.guest);
  const isBusinessTrip = isBusinessGuest(booking.guest, lang);
  const mustPayIVA = mustChargeIva(booking.guest, lang);

  return (
    <div className="be-confirmation">
      <div className="be-confirm-hero">
        <span className="be-confirm-icon">✶</span>
        <h2>{reservationPending ? (lang === 'es' ? 'Pago recibido' : 'Payment received') : t.successTitle}</h2>
        <p>{reservationPending ? (lang === 'es' ? 'Referencia:' : 'Reference:') : t.successCode} <strong>{code}</strong></p>
        <p style={{ marginTop: 8 }}>
          {reservationPending
            ? (lang === 'es' ? 'Guardamos esta referencia para seguimiento manual.' : 'We saved this reference for manual follow-up.')
            : <>{t.successSent} <strong>{booking.guest?.email || 'tu correo'}</strong></>}
        </p>
      </div>
      {reservationPending && (
        <div className="be-info-box" style={{ marginBottom: 16, backgroundColor: 'var(--sand-100)', borderColor: 'var(--terracotta-300)' }}>
          <Icon name="clock" size={18} />
          <p>
            <strong>{lang === 'es' ? 'Reserva pendiente de confirmacion.' : 'Booking pending confirmation.'}</strong>{' '}
            {lang === 'es'
              ? 'Tu pago fue aprobado, pero Kunas no creo la reserva automaticamente. Nuestro equipo debe confirmarla manualmente y te contactara con el codigo final.'
              : 'Your payment was approved, but Kunas did not create the booking automatically. Our team must confirm it manually and will contact you with the final code.'}
          </p>
        </div>
      )}
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
            <span className="be-eyebrow">{lang === 'es' ? 'Pagado Hoy (Online)' : 'Paid Today (Online)'}</span>
            <p className="be-confirm-total" style={{ fontSize: 20 }}>{formatCOP(calc.subtotal)}</p>
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
                ? 'Exencion preliminar por extranjero en turismo/ocio. Se validara la informacion al llegar; si no corresponde, se cobrara IVA en el alojamiento.'
                : 'Preliminary exemption for foreign tourism/leisure travel. Information will be validated on arrival; if it does not match, VAT will be charged at the property.'}
            </p>
          </div>
        )}
        {paymentDetails && (
          <div className="be-confirm-row" style={{ backgroundColor: 'var(--paper-200)', borderTop: '1px solid var(--paper-400)' }}>
            <span className="be-eyebrow" style={{ color: 'var(--olive)' }}>{lang === 'es' ? 'Detalles de Pago (Wompi)' : 'Payment Details (Wompi)'}</span>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, flexWrap: 'wrap', gap: 10 }}>
              <div>
                <p className="be-confirm-val" style={{ fontSize: 13, margin: 0 }}>
                  <strong>ID Transacción:</strong> {paymentDetails.id}
                </p>
                <p className="be-confirm-val" style={{ fontSize: 13, margin: '4px 0 0 0', opacity: 0.85 }}>
                  <strong>Medio de pago:</strong> {paymentDetails.paymentMethod || 'Wompi'}
                </p>
              </div>
              <span style={{
                backgroundColor: paymentDetails.status === 'APPROVED' ? 'var(--olive-100)' : 'var(--terracotta-100)',
                color: paymentDetails.status === 'APPROVED' ? 'var(--olive-700)' : 'var(--terracotta-700)',
                padding: '4px 10px',
                fontSize: 10,
                fontWeight: 700,
                borderRadius: 'var(--radius-pill)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                display: 'inline-block'
              }}>
                {paymentDetails.status === 'APPROVED' 
                  ? (lang === 'es' ? 'Aprobado' : 'Approved') 
                  : (lang === 'es' ? 'Pendiente' : 'Pending')}
              </span>
            </div>
            {paymentDetails.status === 'PENDING' && (
              <p style={{ fontSize: 11, color: 'var(--ink-500)', marginTop: 8, fontStyle: 'italic', lineHeight: 1.4, margin: '8px 0 0 0' }}>
                {lang === 'es' 
                  ? '✶ Tu pago está pendiente de confirmación por tu banco. Te enviaremos un correo cuando se apruebe.' 
                  : '✶ Your payment is pending confirmation by your bank. We will email you once approved.'}
              </p>
            )}
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
            { icon: 'phone', title: t.directContact, body: '+57 310 249 0414 · reservas@estar.com.co' },
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
          <label>{t.bookingCodeLabel}</label>
          <input type="text" placeholder="EST-XXXXX" value={code}
            onChange={e => setCode(e.target.value)} required />
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
  // Find room if pre-selected
  const matchingRoom = BE_ROOMS.find(r => r.id === initialParams.roomParam);

  const [selectedRoom, setSelectedRoom] = useState(() =>
    (draft && draft.selectedRoom) || matchingRoom || null
  );
  const [selectedRate, setSelectedRate] = useState(() => (draft && draft.selectedRate) || 'flexible');
  const [currentStep, setCurrentStep] = useState(() => {
    if (draft && draft.currentStep) return draft.currentStep;
    return matchingRoom ? 'extras' : 'rooms';
  });
  const [ratePerRoom, setRatePerRoom] = useState(() => (draft && draft.ratePerRoom) || {});
  const [extras, setExtras] = useState(() => (draft && draft.extras) || {});
  const [guestData, setGuestData] = useState(() => (draft && draft.guestData) || {});
  /* Default to Wompi (Colombia's primary rail). The cliente can switch to
     Mercado Pago freely from the payment step — both flows are kept live. */
  const [paymentMethod, setPaymentMethod] = useState(() =>
    (draft && draft.paymentMethod) || 'wompi'
  );
  const [bookingCode, setBookingCode] = useState(null);
  const [paymentDetails, setPaymentDetails] = useState(null);
  const [creatingReservation, setCreatingReservation] = useState(false);

  /* Persist a snapshot of the draft on every meaningful change. Guest data
     can include email/phone — we accept that risk on a session-scoped store
     because it lets the user recover after a redirect. The draft is cleared
     in the confirmation handler once a reservation succeeds. */
  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
        savedAt: Date.now(),
        search,
        selectedRoom: selectedRoom ? {
          id: selectedRoom.id,
          roomTypeId: selectedRoom.roomTypeId,
          name: selectedRoom.name
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
        throw new Error(lang === 'es' ? 'No se pudo obtener la disponibilidad desde Kunas PMS.' : 'Failed to retrieve availability from Kunas PMS.');
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
        throw new Error(lang === 'es' ? 'Respuesta de API de disponibilidad inválida.' : 'Invalid availability API response.');
      }
    } catch (err) {
      if (err.name === 'AbortError') return; /* cancelled, not a real error */
      if (myId !== availabilityRequestIdRef.current) return;
      console.error('Fetch availability error:', err);
      setError(err.message);
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
    /* A-6: room chosen → select_item + begin_checkout (start of the funnel). */
    const gi = gaItem(room, rate, search);
    if (gi) {
      beTrack('select_item', { item_list_id: 'rooms', items: [gi] });
      beTrack('begin_checkout', { currency: 'COP', value: gi.price * gi.quantity, items: [gi] });
    }
  }

  function handleSearch(s) {
    setSearch(s);
    setCurrentStep('rooms');
    setSelectedRoom(null);
    setSelectedRate('flexible');
    setExtras({});
    setGuestData({});
    setPaymentMethod('wompi');
    setBookingCode(null);
    setPaymentDetails(null);
  }

  /* After payment lands, the cliente no longer creates the OTASync reservation
     directly — that's now the exclusive job of the payment webhook (Wompi or
     Mercado Pago). We poll /api/booking-status until the webhook reports the
     booking is confirmed, then drive the confirmation UI from that. */
  function handleConfirmBooking(code, details = null) {
    setPaymentDetails(details);
    setCreatingReservation(true);

    const mustPayIVA = mustChargeIva(booking.guest, lang);
    const calc = calcTotal(booking.room, booking.rate, booking.extras, search);
    const roomPriceVal = mustPayIVA ? calc.total : calc.subtotal;

    /* The webhook writes booking-results['direct-<code>'] once OTASync
       confirms. Poll for up to ~60 s with backoff to give the webhook time to
       land. If it never lands, we still surrender the loading state and show
       a "tu pago se está procesando" message so the user is not stuck. */
    const MAX_POLLS = 30;          /* 30 attempts × ~2 s = 60 s max wait    */
    const POLL_INTERVAL_MS = 2000;
    let pollCount = 0;
    let cancelled = false;

    const stopAndShow = (success, finalCode, otasyncId = null, reservationPending = false) => {
      if (cancelled) return;
      setCreatingReservation(false);
      if (success) {
        /* A-6: client-side purchase. The webhook also reports the conversion
           server-side (Measurement Protocol) so ad-blocked sessions still
           count; GA4 dedupes on transaction_id. value = amount charged online
           (subtotal, no IVA). */
        const gi = gaItem(booking.room, booking.rate, search);
        beTrack('purchase', {
          transaction_id: finalCode,
          currency: 'COP',
          value: calc ? calc.subtotal : 0,
          items: gi ? [gi] : []
        });
        setBookingCode(finalCode);
        /* Reservation locked in — clear the draft so a future visitor on this
           browser does not see this guest's data pre-filled. */
        try { sessionStorage.removeItem(DRAFT_KEY); } catch (e) { /* noop */ }
      } else {
        setPaymentDetails(prev => ({ ...(prev || details || {}), reservationPending: true }));
        setBookingCode(finalCode);
      }
      sendConfirmationEmailIfPossible(finalCode, roomPriceVal, calc.subtotal);
    };

    const pollOnce = () => {
      if (cancelled) return;
      pollCount += 1;
      fetch(`/api/booking-status?ref=${encodeURIComponent(code)}`)
        .then(r => r.json())
        .then(data => {
          if (cancelled) return;
          if (data && data.status === 'confirmed' && !data.reservationPending) {
            stopAndShow(true, data.bookingCode || code, data.otasyncId || null);
            return;
          }
          if (data && data.status === 'confirmed' && data.reservationPending) {
            /* Webhook landed but OTASync side flagged pending — show the
               recovery copy instead of the success screen. */
            stopAndShow(false, data.bookingCode || code, null, true);
            return;
          }
          if (pollCount >= MAX_POLLS) {
            console.warn('[booking-status] polling timed out without confirmation');
            stopAndShow(false, code, null, true);
            return;
          }
          setTimeout(pollOnce, POLL_INTERVAL_MS);
        })
        .catch(err => {
          console.error('[booking-status] poll error:', err);
          if (pollCount >= MAX_POLLS) {
            stopAndShow(false, code, null, true);
            return;
          }
          setTimeout(pollOnce, POLL_INTERVAL_MS);
        });
    };

    /* Start polling immediately — the webhook is usually faster than the
       cliente-side redirect, so the first poll often returns confirmed. */
    pollOnce();

    /* The setup of the polling loop captured `cancelled` via closure; if a
       follow-up action (manage / back) needs to abort early, future work can
       expose a ref to set cancelled=true. For now the page is a hard reload
       after confirmation, so cancellation is not required. */
    return;

    /* Helper kept inline so the same closure has access to booking, search,
       and lang without re-derivation. */
    function sendConfirmationEmailIfPossible(finalCode, totalAmount, paidAmount) {
      const guestEmail = booking.guest?.email || '';
      const guestName = `${booking.guest?.nombre || ''} ${booking.guest?.apellido || ''}`.trim();
      const nights = dateDiff(search.checkin, search.checkout);
      const roomName = booking.room.name || '';
      if (!guestEmail) return;
      fetch('/api/send-confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guestEmail,
          guestName,
          bookingCode: finalCode,
          roomName,
          checkIn: search.checkin,
          checkOut: search.checkout,
          nights,
          totalAmount,
          paidAmount,
          phone: booking.guest?.tel || ''
        })
      })
      .then(r => r.json())
      .then(emailData => console.log('[send-confirmation] Result:', emailData))
      .catch(emailErr => console.error('[send-confirmation] Error:', emailErr));
    }
  }

  function goToStep(id) {
    const ci = stepOrder.indexOf(currentStep);
    const ti = stepOrder.indexOf(id);
    if (ti <= ci) setCurrentStep(id);
  }

  const extraCount = Object.values(extras).filter(Boolean).length;

  /* ── Creating reservation loading screen ── */
  if (creatingReservation && !bookingCode) {
    return (
      <div className="be-app" data-theme="editorial">
        <div className="be-page-inner" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 340, gap: 24, textAlign: 'center', padding: '48px 24px' }}>
          <div style={{ width: 56, height: 56, border: '3px solid var(--border)', borderTopColor: 'var(--olive)', borderRadius: '50%', animation: 'booking-spin 0.9s linear infinite' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p className="t-h4" style={{ margin: 0 }}>
              {lang === 'es' ? 'Estamos confirmando tu reserva' : 'Confirming your reservation'}
            </p>
            <p className="t-body-sm" style={{ margin: 0, color: 'var(--fg-muted)' }}>
              {lang === 'es' ? 'Tu pago fue aprobado. Esto puede tomar unos segundos…' : 'Your payment was approved. This may take a few seconds…'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  /* ── Confirmation ── */
  if (bookingCode) {
    return (
      <div className="be-app" data-theme="editorial">
        <div className="be-page-inner">
          <Confirmation
            booking={booking} search={search} code={bookingCode} paymentDetails={paymentDetails} lang={lang}
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
        <PaymentReturnNotice status={initialParams.payment} lang={lang} />
        <SearchBar search={search} onSearch={handleSearch} lang={lang} />
        <StepProgress currentStep={currentStep} lang={lang} />
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
                      ? 'No encontramos apartaestudios libres en Kunas PMS para estas fechas. Puedes intentar buscando una semana después o escribirnos directamente por WhatsApp para ver si contamos con alguna alternativa o cancelación de última hora.' 
                      : 'We could not find free apartaestudios in Kunas PMS for these dates. You can try searching for a week later or write to us directly on WhatsApp to see if we have any alternatives or last-minute cancellations.'}
                  </p>
                  
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
                    <button className="be-btn-secondary" onClick={() => {
                      const checkinDate = new Date(search.checkin + 'T00:00:00');
                      const checkoutDate = new Date(search.checkout + 'T00:00:00');
                      const diffDays = Math.max(1, Math.round((checkoutDate - checkinDate)/86400000));
                      checkinDate.setDate(checkinDate.getDate() + 7);
                      checkoutDate.setDate(checkoutDate.getDate() + 7);
                      
                      const fmt = (d) => d.toISOString().split('T')[0];
                      handleSearch({
                        checkin: fmt(checkinDate),
                        checkout: fmt(checkoutDate),
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
                  {/* Available rooms first (preserve API order), sold-out at end */}
                  {[...rooms].sort((a, b) => {
                    const aOk = a.available !== false;
                    const bOk = b.available !== false;
                    if (aOk === bOk) return 0;
                    return aOk ? -1 : 1;
                  }).map(room => (
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
              )}
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
                onConfirm={handleConfirmBooking}
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
