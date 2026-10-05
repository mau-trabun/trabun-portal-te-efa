// HTTP entry point. Same JSON API as the Apps Script /exec (CONTRACT.md §4), plus POST /refrescar for Cloud Scheduler.
process.env.TZ = 'America/Santiago'; // serial → Date conversion uses local time; must match the Sheet's time zone
const fs = require('fs');
const http = require('http');
const path = require('path');
const { crearServicio } = require('./app');
const { crearPlanilla } = require('./sheets');

const MAX_CUERPO = 10 * 1024;
// deploy.sh copies gas/Code.js next to this file; locally it is read from the repo
const CODIGO = [path.join(__dirname, 'Code.js'), path.join(__dirname, '..', 'gas', 'Code.js')].find(p => fs.existsSync(p));

function crearServidor(servicio, origenes) {
  return http.createServer((req, res) => {
    const origen = req.headers.origin;
    const cabeceras = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Origin' };
    if (origen && origenes.includes(origen)) cabeceras['Access-Control-Allow-Origin'] = origen;
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...cabeceras, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' });
      return res.end();
    }
    const trozos = [];
    let largo = 0;
    req.on('data', c => {
      largo += c.length;
      if (largo > MAX_CUERPO) { res.writeHead(413, cabeceras); res.end('{"ok":false}'); req.destroy(); } else trozos.push(c);
    });
    req.on('end', async () => {
      if (res.writableEnded) return;
      const ruta = (req.url || '/').split('?')[0];
      try {
        const r = await servicio.manejar(req.method, ruta, Buffer.concat(trozos).toString('utf8'));
        res.writeHead(r.status, cabeceras);
        res.end(r.cuerpo);
      } catch (e) {
        console.error('servidor: ' + (e && e.message));
        res.writeHead(500, cabeceras);
        res.end('{"ok":false,"error":"servidor"}');
      }
    });
  });
}

if (require.main === module) {
  const id = process.env.SHEET_ID;
  if (!id) { console.error('Falta SHEET_ID'); process.exit(1); }
  const origenes = (process.env.ORIGENES || 'https://mau-trabun.github.io,https://portal.fundaciontrabun.cl').split(',').map(s => s.trim());
  const servicio = crearServicio({ src: fs.readFileSync(CODIGO, 'utf8'), planilla: crearPlanilla(id) });
  crearServidor(servicio, origenes).listen(Number(process.env.PORT) || 8080, () => console.log('portal-api listo'));
}

module.exports = { crearServidor };
