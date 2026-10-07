// Tests the Test announcement emails (prepararCorreosTest, enviarCorreoPrueba, enviarCorreosTest) on top of the
// run.js mocks. Fictional schools and people only. Run from the repo root: node test/correos.js
const base = require('fs').readFileSync(require('path').join(__dirname, 'run.js'), 'utf8').split("const post =")[0];
eval(base + `
const check = (label, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) process.exitCode = 1; };
const checks = {};
const lastRow = n => { const s = sheets[n] || []; let i = s.length; while (i > 0 && !(s[i - 1] || []).some(v => v !== '' && v != null)) i--; return i; };
const lastCol = n => (sheets[n] || []).reduce((m, r) => Math.max(m, r.length), 0);
const mkSheet = name => ({
  getLastRow: () => lastRow(name),
  getLastColumn: () => lastCol(name),
  getDataRange: () => ({ getValues: () => sheets[name].slice(0, lastRow(name)).map(r => Array.from({ length: lastCol(name) }, (_, j) => (r[j] == null ? '' : r[j]))) }),
  getRange: (r, c, nr = 1, nc = 1) => {
    const fila = i => sheets[name][r - 1 + i] || (sheets[name][r - 1 + i] = []);
    const rg = {
      setValue: v => { fila(0)[c - 1] = v; return rg; },
      setValues: vals => { vals.forEach((row, i) => { if (row.length !== nc) throw new Error('width'); row.forEach((v, j) => { fila(i)[c - 1 + j] = v; }); }); return rg; },
      clearContent: () => { for (let i = 0; i < nr; i++) { const f = sheets[name][r - 1 + i]; if (f) for (let j = 0; j < nc; j++) f[c - 1 + j] = ''; } return rg; },
      clearDataValidations: () => { for (let i = 0; i < nr; i++) delete checks[name + (r + i)]; return rg; },
      insertCheckboxes: () => { for (let i = 0; i < nr; i++) { checks[name + (r + i)] = true; fila(i)[c - 1] = false; } return rg; },
      setFontWeight: () => rg,
    };
    return rg;
  },
});
ctx.SpreadsheetApp.getActiveSpreadsheet = () => ({
  getSheetByName: n => sheets[n] ? mkSheet(n) : null,
  insertSheet: n => { sheets[n] = []; return mkSheet(n); },
  getNumSheets: () => Object.keys(sheets).length,
});
let enviados = [], cuota = 1500;
ctx.MailApp = { sendEmail: o => enviados.push(o), getRemainingDailyQuota: () => cuota };
ctx.Session = { getActiveUser: () => ({ getEmail: () => 'yo@ejemplo.invalid' }) };

const FARO = 'Puerto Inventado - Escuela El Faro - 22222';
sheets['Encargados'] = [['Nombre para formulario', 'ID RBD', 'Programa que participa', 'Account Name', 'First Name', 'Last Name', 'Email'],
  [AROMOS, 11111, 'ASE', 'x', 'MARÍA JOSÉ', 'x', 'mj@ejemplo.invalid'],
  [AROMOS, 11111, 'Religión', 'x', 'pedro', 'x', 'Pedro@Ejemplo.invalid '],
  [AROMOS, 11111, 'ASE', 'x', 'María José', 'x', 'MJ@ejemplo.invalid'],      // same person again → once
  [AROMOS, 11111, 'Ambos', 'x', 'sin', 'x', ''],                           // no email → ignored
  [FARO, '', 'Religión', 'x', "ana o'neill", 'x', 'ana@ejemplo.invalid'],  // RBD from the name; SF has no REL here
  ['Cerro Falso - Liceo Control - 33333', 33333, 'ASE', 'x', 'luis', 'x', 'luis@ejemplo.invalid']]; // Control: left out

sheets['SF'].find(r => r[0] === 11111 && r[3] === 'Religión')[10] = 'Coordinadora Uno'; // no email in correos_jdp
sheets['correos_jdp'] = [['jdp/ci', 'correo'], ['X', 'JDP.X@ejemplo.invalid']]; // fixture JDP is named 'x'
logs.length = 0;
const informe = ctx.prepararCorreosTest();
const fila = rbd => { const t = sheets['Correos Test']; const h = t[0]; const r = t.find(x => x[0] === rbd); return r && Object.fromEntries(h.map((k, i) => [k, r[i]])); };
const a = fila('11111'), f = fila('22222'), c = fila('33333'), x = fila('44444');
check('one row per school with a clave, contract header', sheets['Correos Test'][0].join('|') === 'RBD|Colegio|Programas|Jefe/a de Proyecto|Para|CC|Nombres|Contacto|Asunto|Mensaje|Observaciones|Enviar|Enviado' && lastRow('Correos Test') === 5 && /4 colegios · 2 por enviar · 4 con observaciones/.test(informe));
check('two programs, two encargados together (deduped, lower-case, blank email ignored)', a.Programas === 'ASE + REL' && a.Para === 'mj@ejemplo.invalid, pedro@ejemplo.invalid' && a.Nombres === 'María José, Pedro' && a.Enviar === true);
check('CC: JDP and coordinator of the announced programs from correos_jdp (name match ignores case), missing ones flagged', a.CC === 'jdp.x@ejemplo.invalid' && f.CC === 'jdp.x@ejemplo.invalid' && a.Observaciones === 'Sin correo en correos_jdp para: Coordinadora Uno' && c.CC === '');
check('plural text: names, both programs, real dates with weekday, RBD + clave, contacto general', /^Hola, María José y Pedro:/.test(a.Mensaje) && a.Mensaje.includes('Les escribimos') && a.Mensaje.includes('de los programas de Aprendizaje Socioemocional y Religión Católica estará disponible desde el jueves 1 de octubre hasta el viernes 20 de noviembre.') && a.Mensaje.includes('RBD: 11111\\nClave: aaa111') && a.Mensaje.includes('Entren en portal.fundaciontrabun.cl') && a.Mensaje.includes('por favor no lo respondan') && a.Mensaje.includes('escríbannos a evaluacion@fundaciontrabun.cl') && a.Asunto === 'Test de Estudiantes 2026 · Colegio Los Aromos');
check('singular text, EDI contact and paper grades; RBD taken from the school name', f.Para === 'ana@ejemplo.invalid' && /^Hola, Ana O'Neill:/.test(f.Mensaje) && f.Mensaje.includes('Te escribimos') && f.Mensaje.includes('del programa de Aprendizaje Socioemocional estará') && f.Mensaje.includes('Entra en') && f.Mensaje.includes('En 5° básico a 8° básico el test es en papel y lo aplica la Agencia Focus.') && f.Contacto === 'consultas_edi@fundaciontrabun.cl' && f.Mensaje.includes('escríbenos a consultas_edi@fundaciontrabun.cl') && f.Enviar === true);
check('encargado program not in SF is flagged, but the row still goes', f.Observaciones === 'En Encargados figura REL, que no está en SF');
check('Control left out; school not in SF / without encargado flagged, not ticked', c.Programas === '' && c.Enviar === false && /Control/.test(c.Observaciones) && x.Enviar === false && x.Observaciones === 'No está en SF · Sin encargado en la pestaña Encargados');
check('rows needing attention first', sheets['Correos Test'][1][11] === false && sheets['Correos Test'][2][11] === false && sheets['Correos Test'][4][11] === true);

ctx.enviarCorreoPrueba();
check('prueba: only to whoever runs it, [PRUEBA] subject, one singular + one plural sample', enviados.length === 2 && enviados.every(e => e.to === 'yo@ejemplo.invalid' && /^\\[PRUEBA\\] /.test(e.subject)) && new Set(enviados.map(e => e.subject)).size === 2 && !sheets['Correos Test'].slice(1).some(r => r[12])
  && enviados.every(e => !e.cc && e.htmlBody.includes('Correo de prueba.') && e.body.startsWith('[Prueba · Para: ')) && enviados.some(e => e.htmlBody.includes('CC: jdp.x@ejemplo.invalid')));
enviados = [];
sheets['Config'].push(['correos_prueba', 'uno@ejemplo.invalid, dos@ejemplo.invalid; malo', '']);
ctx.enviarCorreoPrueba();
check('prueba: Config correos_prueba overrides the runner (invalid entries dropped)', enviados.length === 2 && enviados.every(e => e.to === 'uno@ejemplo.invalid,dos@ejemplo.invalid'));
sheets['Config'].pop(); enviados = [];

cuota = 2; // the plural row needs 3 (2 encargados + 1 CC)
let r = ctx.enviarCorreosTest();
check('quota: stops before a row it cannot fully send, says how many are left', enviados.length === 1 && enviados[0].to === 'ana@ejemplo.invalid' && /Quedan 1/.test(r));
cuota = 1500; enviados = [];
r = ctx.enviarCorreosTest();
const env = enviados[0];
check('send: all encargados in one email, name Fundación Trabün, reply-to the school contact, html with clave and portal link', enviados.length === 1 && env.to === 'mj@ejemplo.invalid,pedro@ejemplo.invalid' && env.name === 'Fundación Trabün' && env.replyTo === 'evaluacion@fundaciontrabun.cl' && env.cc === 'jdp.x@ejemplo.invalid' && env.htmlBody.includes('>aaa111</td>') && env.htmlBody.includes('href="https://portal.fundaciontrabun.cl"') && env.htmlBody.includes('Entrar al portal') && env.htmlBody.includes('https://portal.fundaciontrabun.cl/correo/logo-trabun.png') && env.htmlBody.includes('Programas de Aprendizaje Socioemocional y Religión Católica · disponible hasta el viernes 20 de noviembre') && !env.htmlBody.includes('<!--prueba-->') && !env.htmlBody.includes('Correo de prueba'));
check('Enviado stamped on both rows; re-run sends nothing', fila('11111').Enviado instanceof Date && fila('22222').Enviado instanceof Date && (() => { enviados = []; ctx.enviarCorreosTest(); return enviados.length === 0; })());

sheets['Correos Test'].find(x => x[0] === '22222')[11] = false; // Mau unticks one
ctx.prepararCorreosTest();
check('rebuild keeps Enviado and Mau\\'s unticked box', fila('11111').Enviado instanceof Date && fila('22222').Enviar === false && fila('22222').Enviado instanceof Date);
check('html escapes names; no emails or claves in logs', (() => { sheets['Encargados'][5][4] = '<b>x</b>'; ctx.prepararCorreosTest(); const t = ctx.correoTest_(ctx.panel_('22222', ctx.cargarDatos_(), ctx.reloj_()), ctx.panel_('22222', ctx.cargarDatos_(), ctx.reloj_()).programas, [{ email: 'a@b.cl', nombre: '<b>x</b>' }], 'k'); return !t.html.includes('<b>x</b>') && t.html.includes('&lt;b&gt;'); })() && !/@ejemplo\\.invalid|aaa111|bbb222/.test(logs.join('\\n')));
`);
