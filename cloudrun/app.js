// Portal API on Cloud Run: runs gas/Code.js unchanged. The few Apps Script services the login path uses
// (SpreadsheetApp read + appendRow, CacheService, Utilities.formatDate, ContentService) are replaced by
// small shims backed by an in-memory snapshot of the Sheet, refreshed in the background.
// Never log request bodies, claves, emails or names.
const vm = require('vm');

const MIN_ENTRE_REFRESCOS_MS = 30 * 1000; // /refrescar can't hammer the Sheets API

// Apps Script's Utilities.formatDate for the patterns Code.js uses (yyyy MM dd HH mm ss XXX, 'literals')
function formatDate(d, tz, patron) {
  const p = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset',
  }).formatToParts(d).forEach(x => { p[x.type] = x.value; });
  const off = p.timeZoneName === 'GMT' ? '+00:00' : p.timeZoneName.replace('GMT', '');
  const t = { yyyy: p.year, MM: p.month, dd: p.day, HH: p.hour, mm: p.minute, ss: p.second, XXX: off };
  return patron.replace(/'([^']*)'|yyyy|MM|dd|HH|mm|ss|XXX/g, (m, lit) => (lit !== undefined ? lit : t[m]));
}

// Sheets serial (days since 1899-12-30, in the Sheet's time zone) → Date. Needs process TZ = Sheet TZ.
function serialAFecha(s) {
  const dias = Math.floor(s);
  const seg = Math.round((s - dias) * 86400);
  const b = new Date(Date.UTC(1899, 11, 30) + dias * 86400000);
  return new Date(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate(), Math.floor(seg / 3600), Math.floor((seg % 3600) / 60), seg % 60);
}

// Like getDataRange().getValues(): rectangular, '' for blanks, Date for date cells.
// A cell is a date when the SERIAL_NUMBER read gives a number and the FORMATTED_STRING read gives a string.
function comoGetValues(seriales, formateados) {
  const ancho = seriales.reduce((m, r) => Math.max(m, r.length), 0);
  return seriales.map((r, i) => {
    const f = formateados && formateados[i];
    const fila = [];
    for (let j = 0; j < ancho; j++) {
      const v = r[j] === undefined ? '' : r[j];
      fila.push(typeof v === 'number' && f && typeof f[j] === 'string' ? serialAFecha(v) : v);
    }
    return fila;
  });
}

function cargarCodigo(src, { tabla, agregarFila, log }) {
  const cache = new Map(); // throttle; single instance (max-instances 1), so memory is enough
  const ctx = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: n => {
          const v = tabla(n);
          return v ? { getDataRange: () => ({ getValues: () => v.map(r => r.slice()) }), appendRow: row => agregarFila(n, row) } : null;
        },
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: k => { const e = cache.get(k); if (!e) return null; if (e.exp < Date.now()) { cache.delete(k); return null; } return e.v; },
        put: (k, v, s) => { cache.set(k, { v: String(v), exp: Date.now() + (s || 600) * 1000 }); },
        remove: k => { cache.delete(k); },
      }),
    },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: s => ({ getContent: () => s, setMimeType() { return this; } }) },
    Utilities: { formatDate },
    console: log,
    // Host built-ins, so `instanceof Date` in Code.js matches the Dates built here
    Date, Map, Set, JSON, Math, Number, String, Object, Array, Boolean, RegExp, Error, Intl, isFinite, isNaN, parseInt, parseFloat,
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'Code.js' });
  return ctx;
}

// planilla: { leer(tabs, sinFechas) → { titulos, seriales: {tab: rows}, formateados: {tab: rows} }, agregar(tab, fila) }
function crearServicio({ src, planilla, ttlMs = 3 * 60 * 1000, maxEdadMs = 10 * 60 * 1000, log = console }) {
  let snap = null;      // { titulos: Set, tablas: {tab: values}, leido }
  let datos = null;     // cargarDatos_() result for the current snapshot (or its error)
  let cargando = null;
  let ultimoIntento = 0;
  const pendientes = []; // Métricas rows waiting to be written
  let vaciando = false;

  const ctx = cargarCodigo(src, {
    tabla: n => (snap && snap.titulos.has(n) ? snap.tablas[n] || [] : null),
    agregarFila: (n, row) => pendientes.push({ n, row }),
    log,
  });
  const TABS = vm.runInContext('TABS', ctx);
  const TZ = vm.runInContext('TZ', ctx);
  const lectura = Object.keys(TABS).filter(k => k !== 'metricas').map(k => TABS[k]);
  const sinFechas = [TABS.respTest]; // the big tab: no date column is read from it
  const cargarDatosOriginal = ctx.cargarDatos_;
  // Built once per snapshot instead of per login (Code.js keeps it a pure function of the Sheet)
  ctx.cargarDatos_ = () => { if (datos.error) throw datos.error; return datos.valor; };

  function refrescar() {
    if (cargando) return cargando;
    ultimoIntento = Date.now();
    cargando = (async () => {
      const t0 = Date.now();
      const raw = await planilla.leer(lectura, sinFechas);
      const tablas = {};
      Object.keys(raw.seriales).forEach(t => { tablas[t] = comoGetValues(raw.seriales[t], raw.formateados[t]); });
      snap = { titulos: new Set(raw.titulos), tablas, leido: Date.now() };
      try { datos = { valor: cargarDatosOriginal() }; } catch (error) { datos = { error }; }
      log.log(`snapshot ${Date.now() - t0} ms`); // timing only
    })().finally(() => { cargando = null; });
    return cargando;
  }

  async function asegurarFresco() {
    const edad = snap ? Date.now() - snap.leido : Infinity;
    try {
      if (edad > maxEdadMs) await refrescar(); // cold start or the scheduler stopped: wait for fresh data
      else if (edad > ttlMs) refrescar().catch(e => log.error('refresco: ' + e.message)); // serve now, refresh behind
    } catch (e) {
      log.error('refresco: ' + e.message); // keep serving the old snapshot if there is one
    }
  }

  async function vaciarMetricas() {
    if (vaciando) return;
    vaciando = true;
    try {
      while (pendientes.length) {
        const { n, row } = pendientes[0];
        await planilla.agregar(n, row.map(v => (v instanceof Date ? formatDate(v, TZ, 'yyyy-MM-dd HH:mm:ss') : v)));
        pendientes.shift();
      }
    } catch (e) {
      log.error('Métricas: ' + e.message); // retried on the next login or refresh
    } finally {
      vaciando = false;
    }
  }

  return {
    async manejar(metodo, ruta, cuerpo) {
      if (metodo === 'GET' && ruta === '/') return { status: 200, cuerpo: ctx.doGet().getContent() };
      if (metodo === 'POST' && ruta === '/') {
        await asegurarFresco();
        const out = ctx.doPost({ postData: { contents: cuerpo } }).getContent();
        setImmediate(() => { vaciarMetricas(); }); // after the reply: the login never waits for the write
        return { status: 200, cuerpo: out };
      }
      if (metodo === 'POST' && ruta === '/refrescar') { // Cloud Scheduler, every 2 min: keeps data fresh and the instance warm
        if (Date.now() - ultimoIntento >= MIN_ENTRE_REFRESCOS_MS) await refrescar().catch(e => log.error('refresco: ' + e.message));
        await vaciarMetricas();
        return { status: 204, cuerpo: '' };
      }
      return { status: 404, cuerpo: '{"ok":false}' };
    },
    _estado: () => ({ snap, pendientes }), // tests only
  };
}

module.exports = { crearServicio, formatDate, serialAFecha, comoGetValues };
