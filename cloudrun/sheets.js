// Google Sheets API v4 over fetch, authenticated as the Cloud Run service account via the metadata server
// (no key files). The Sheet must be shared with that service account.
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token?scopes=' + encodeURIComponent(SCOPE);

let token = null;
async function tokenAcceso() {
  if (token && token.exp > Date.now() + 60000) return token.valor;
  const r = await fetch(TOKEN_URL, { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('token ' + r.status);
  const j = await r.json();
  token = { valor: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return token.valor;
}

async function api(url, opciones = {}) {
  const r = await fetch(url, {
    ...opciones,
    headers: { ...(opciones.headers || {}), Authorization: 'Bearer ' + (await tokenAcceso()) },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error('Sheets ' + r.status); // status only: bodies may echo cell data
  return r.json();
}

function crearPlanilla(id) {
  const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(id);
  const rango = t => "'" + t.replace(/'/g, "''") + "'";
  const batchGet = (tabs, modoFecha) => (tabs.length
    ? api(base + '/values:batchGet?' + new URLSearchParams([
      ...tabs.map(t => ['ranges', rango(t)]),
      ['valueRenderOption', 'UNFORMATTED_VALUE'], ['dateTimeRenderOption', modoFecha], ['majorDimension', 'ROWS'],
    ])).then(j => j.valueRanges.map(v => v.values || []))
    : Promise.resolve([]));

  return {
    // Missing tabs are left out, so Code.js degrades exactly as in Apps Script (getSheetByName → null)
    async leer(tabs, sinFechas) {
      const meta = await api(base + '?fields=sheets.properties.title');
      const titulos = meta.sheets.map(s => s.properties.title);
      const presentes = tabs.filter(t => titulos.includes(t));
      const conFechas = presentes.filter(t => !sinFechas.includes(t));
      const [s, f] = await Promise.all([batchGet(presentes, 'SERIAL_NUMBER'), batchGet(conFechas, 'FORMATTED_STRING')]);
      const seriales = {}, formateados = {};
      presentes.forEach((t, i) => { seriales[t] = s[i]; });
      conFechas.forEach((t, i) => { formateados[t] = f[i]; });
      return { titulos, seriales, formateados };
    },
    agregar(tab, fila) {
      return api(base + '/values/' + encodeURIComponent(rango(tab) + '!A1') + ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [fila] }),
      });
    },
  };
}

module.exports = { crearPlanilla };
