require('./_env');
const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

/*
 * _ops-queue.js — cola de tareas operativas (Staff App v2, Sprint 2 / Mesa Redonda).
 *
 * Objetivo: dejar de depender de la BANDEJA DE CORREO como mecanismo operativo.
 * Toda alerta (`_alert.reportAlert`) y todo evento accionable (folio fallido,
 * cancelación pendiente, handoff del bot) se registra aquí como una TAREA que el
 * equipo ve y resuelve desde el panel "Hoy", en vez de un correo que se pierde.
 *
 * Persistencia en Netlify Blobs (store `ops-queue`), una clave por tarea
 * (`ops/<id>`). Idempotente por dedupeKey: una tarea ABIERTA con la misma clave no
 * se duplica; una clave RESUELTA se RE-ABRE (un fallo recurrente debe reaparecer).
 * Best-effort: nunca lanza (no debe tumbar el flujo que la invoca).
 */

const MAX_LIST = 200;

function hash(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
}

function opsStore(deps = {}) {
  if (deps.getStore) return deps.getStore();
  try { return getStore({ name: 'ops-queue', consistency: 'strong' }); } catch (e) { return null; }
}

async function enqueue({ kind, severity = 'error', title, context = {}, dedupeKey } = {}, deps = {}) {
  const s = opsStore(deps);
  if (!s) return { queued: false, reason: 'no-store' };
  const id = String(dedupeKey || `${kind}:${hash((title || '') + JSON.stringify(context || {}))}`);
  const key = `ops/${id}`;
  const now = (deps.now || Date.now)();
  try {
    const existingRaw = await s.get(key);
    if (existingRaw) {
      let prev = null;
      try { prev = JSON.parse(existingRaw); } catch (e) { /* corrupt → overwrite */ }
      if (prev && prev.status === 'open') return { queued: false, reason: 'already-open', id };
      /* resuelta o corrupta → re-abrir */
    }
    const item = {
      id, kind, severity,
      title: String(title || '').slice(0, 300),
      context: context || {},
      status: 'open',
      createdAt: new Date(now).toISOString()
    };
    await s.set(key, JSON.stringify(item));
    return { queued: true, id };
  } catch (e) {
    return { queued: false, reason: 'error' };
  }
}

async function listOpen(deps = {}) {
  const s = opsStore(deps);
  if (!s) return [];
  try {
    const res = await s.list({ prefix: 'ops/' });
    const blobs = (res && res.blobs) || [];
    const items = [];
    for (const b of blobs.slice(0, MAX_LIST)) {
      try {
        const raw = await s.get(b.key);
        if (!raw) continue;
        const it = JSON.parse(raw);
        if (it && it.status === 'open') items.push(it);
      } catch (e) { /* skip corrupt */ }
    }
    items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return items;
  } catch (e) {
    return [];
  }
}

async function getItem(id, deps = {}) {
  const s = opsStore(deps);
  if (!s) return null;
  try {
    const raw = await s.get(`ops/${String(id)}`);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

async function resolve(id, by, deps = {}) {
  const s = opsStore(deps);
  if (!s) return { ok: false, reason: 'no-store' };
  const key = `ops/${String(id)}`;
  try {
    const raw = await s.get(key);
    if (!raw) return { ok: false, reason: 'not-found' };
    const it = JSON.parse(raw);
    it.status = 'resolved';
    it.resolvedAt = new Date((deps.now || Date.now)()).toISOString();
    it.resolvedBy = by || 'staff';
    await s.set(key, JSON.stringify(it));
    return { ok: true, item: it };
  } catch (e) {
    return { ok: false, reason: 'error' };
  }
}

module.exports = { enqueue, listOpen, resolve, getItem };
