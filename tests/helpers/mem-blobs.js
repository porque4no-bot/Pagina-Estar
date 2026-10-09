/* Store de Netlify Blobs en memoria para pruebas unitarias (Frente Hoy).
 * Implementa lo que usan los módulos: get (texto / json / arrayBuffer),
 * getWithMetadata, set (+metadata), setJSON, list({prefix}) y delete. */

function memStore(initial = {}) {
  const data = { ...initial };
  const meta = {};
  const store = {
    data,
    meta,
    failSet: false,
    failGet: false,
    async get(key, opts = {}) {
      if (store.failGet) throw new Error('blobs down');
      const v = data[key];
      if (v == null) return null;
      if (opts.type === 'json') return typeof v === 'string' ? JSON.parse(v) : v;
      if (opts.type === 'arrayBuffer') {
        if (Buffer.isBuffer(v)) return v;
        return Buffer.from(typeof v === 'string' ? v : JSON.stringify(v));
      }
      if (Buffer.isBuffer(v)) return v.toString('utf8');
      return typeof v === 'string' ? v : JSON.stringify(v);
    },
    async getWithMetadata(key, opts = {}) {
      const d = await store.get(key, opts);
      return d == null ? null : { data: d, metadata: meta[key] || {} };
    },
    async set(key, value, opts = {}) {
      if (store.failSet) throw new Error('blobs down');
      data[key] = value;
      if (opts.metadata) meta[key] = opts.metadata;
      return { modified: true };
    },
    async setJSON(key, value) { data[key] = value; },
    async list(opts = {}) {
      const prefix = opts.prefix || '';
      return { blobs: Object.keys(data).filter(k => k.startsWith(prefix)).map(key => ({ key })) };
    },
    async delete(key) { delete data[key]; }
  };
  return store;
}

/* deps.getStore(name) → un memStore por nombre (se crea al vuelo). */
function memStores(initial = {}) {
  const stores = {};
  for (const [name, content] of Object.entries(initial)) stores[name] = memStore(content);
  return {
    stores,
    getStore: (name) => {
      if (!stores[name]) stores[name] = memStore();
      return stores[name];
    }
  };
}

module.exports = { memStore, memStores };
