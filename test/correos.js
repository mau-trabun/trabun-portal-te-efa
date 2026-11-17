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
ctx.Utilities.newBlob = (bytes, type, name) => ({ bytes, type, name });
ctx.Utilities.base64Decode = b => Buffer.from(b, 'base64');

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
check('plural text: names, both programs, real dates with weekday, RBD + clave, contacto general', /^Hola, María José y Pedro:/.test(a.Mensaje) && a.Mensaje.includes('Les escribimos') && a.Mensaje.includes('de los programas de Aprendizaje Socioemocional y Religión Católica estará disponible desde el jueves 1 de octubre hasta el viernes 20 de noviembre.') && a.Mensaje.includes('RBD: 11111\\nClave: aaa111') && a.Mensaje.includes('Entren al portal con estos datos:') && !a.Mensaje.includes('Evaluación') && a.Mensaje.includes('Les escribimos de Fundación Trabün') && a.Mensaje.includes('por favor no lo respondan') && a.Mensaje.includes('escríbannos a evaluacion@fundaciontrabun.cl') && a.Asunto === 'Test de Estudiantes 2026 · Colegio Los Aromos');
check('singular text, EDI contact and paper grades; RBD taken from the school name', f.Para === 'ana@ejemplo.invalid' && /^Hola, Ana O'Neill:/.test(f.Mensaje) && f.Mensaje.includes('Te escribimos') && f.Mensaje.includes('del programa de Aprendizaje Socioemocional estará') && f.Mensaje.includes('Entra al portal con estos datos:') && f.Mensaje.includes('En 5° a 8° básico el test es en papel y lo aplica la Agencia Focus.') && f.Contacto === 'consultas_edi@fundaciontrabun.cl' && f.Mensaje.includes('escríbenos a consultas_edi@fundaciontrabun.cl') && f.Enviar === true);
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
check('send: all encargados in one email, name Fundación Trabün, reply-to the school contact, html with clave and portal link', enviados.length === 1 && env.to === 'mj@ejemplo.invalid,pedro@ejemplo.invalid' && env.name === 'Fundación Trabün' && env.replyTo === 'evaluacion@fundaciontrabun.cl' && env.cc === 'jdp.x@ejemplo.invalid' && env.htmlBody.includes('>aaa111</td>') && env.htmlBody.includes('href="https://portal.fundaciontrabun.cl"') && env.htmlBody.includes('Entrar al portal') && env.htmlBody.includes('src="cid:logo"') && env.inlineImages.logo.type === 'image/png' && env.inlineImages.logo.bytes.length > 1000 && env.htmlBody.indexOf('Los links del test') < env.htmlBody.indexOf('Entren al portal con estos datos') && env.htmlBody.includes('>Fundación Trabün</p>') && env.htmlBody.includes('Programas de Aprendizaje Socioemocional y Religión Católica · disponible hasta el viernes 20 de noviembre') && !env.htmlBody.includes('<!--prueba-->') && !env.htmlBody.includes('Correo de prueba'));
check('Enviado stamped on both rows; re-run sends nothing', fila('11111').Enviado instanceof Date && fila('22222').Enviado instanceof Date && (() => { enviados = []; ctx.enviarCorreosTest(); return enviados.length === 0; })());

sheets['Correos Test'].find(x => x[0] === '22222')[11] = false; // Mau unticks one
ctx.prepararCorreosTest();
check('rebuild keeps Enviado and Mau\\'s unticked box', fila('11111').Enviado instanceof Date && fila('22222').Enviar === false && fila('22222').Enviado instanceof Date);
check('html escapes names; no emails or claves in logs', (() => { sheets['Encargados'][5][4] = '<b>x</b>'; ctx.prepararCorreosTest(); const t = ctx.correoTest_(ctx.panel_('22222', ctx.cargarDatos_(), ctx.reloj_()), ctx.panel_('22222', ctx.cargarDatos_(), ctx.reloj_()).programas, [{ email: 'a@b.cl', nombre: '<b>x</b>' }], 'k'); return !t.html.includes('<b>x</b>') && t.html.includes('&lt;b&gt;'); })() && !/@ejemplo\\.invalid|aaa111|bbb222/.test(logs.join('\\n')));

check('"e" before an i sound, "y" otherwise', ctx.conY_(['Caroline', 'Jimena', 'Isabel']) === 'Caroline, Jimena e Isabel' && ctx.conY_(['Ana', 'Hilda']) === 'Ana e Hilda'
  && ctx.conY_(['Ana', 'Hierro']) === 'Ana y Hierro' && ctx.conY_(['Ana', 'Ícaro']) === 'Ana e Ícaro' && ctx.conY_(['Ana', 'Pedro']) === 'Ana y Pedro' && ctx.conY_(['Ana']) === 'Ana');
check('grade ranges written short', ctx.nivelesTexto_([6, 7, 8, 9]) === '5° a 8° básico' && ctx.nivelesTexto_([5, 6]) === '4° y 5° básico' && ctx.nivelesTexto_([9, 10]) === '8° básico y I° medio'
  && ctx.nivelesTexto_([5, 10, 11, 12, 13]) === '4° básico e I° a IV° medio' && ctx.nivelesTexto_([5, 6, 7, 8]) === '4° a 7° básico');

// Bien Público and SIP (SF columns "Proyecto" / "Sostenedor"; absent columns change nothing)
delete sheets['Correos Test'];
sheets['SF'][0].push('Proyecto', 'Sostenedor');
const sfFila = (rbd, tipo) => sheets['SF'].find(r => r[0] === rbd && r[3] === tipo);
sheets['SF'].slice(1).forEach(r => { if (r[0]) r.push('', ''); });
sfFila(11111, 'Religión')[sheets['SF'][0].indexOf('Proyecto')] = 'Bien Público';
sfFila(22222, 'ASE')[sheets['SF'][0].indexOf('Sostenedor')] = 'Sociedad De Instruccion Primaria De Santiago';
ctx.prepararCorreosTest();
let a2 = fila('11111'), f2 = fila('22222');
check('Bien Público program not announced; the rest of the school still goes', a2.Programas === 'ASE' && a2.Enviar === true && a2.Mensaje.includes('del programa de Aprendizaje Socioemocional') && !a2.Mensaje.includes('Religión') && a2.Observaciones.includes('No se menciona REL (Bien Público)'));
check('SIP school unticked by default, email ready if ticked', f2.Enviar === false && /^SIP: /.test(f2.Observaciones) && f2.Mensaje.includes('Te escribimos'));
sfFila(11111, 'ASE')[sheets['SF'][0].indexOf('Proyecto')] = 'Bien Público';
ctx.prepararCorreosTest();
a2 = fila('11111');
check('school with only Bien Público programs: unticked, both programs in the ready email', a2.Enviar === false && a2.Programas === 'ASE + REL' && /Bien Público: no se envía/.test(a2.Observaciones));
sheets['Correos Test'].find(x => x[0] === '11111')[11] = true; sheets['Correos Test'].find(x => x[0] === '22222')[11] = true; // Mau decides to send
ctx.prepararCorreosTest();
check("Mau's tick on a Bien Público / SIP school survives a rebuild", fila('11111').Enviar === true && fila('22222').Enviar === true);
sfFila(22222, 'ASE')[sheets['SF'][0].indexOf('Sostenedor')] = '';
sheets['Correos Test'].find(x => x[0] === '22222')[11] = false;
ctx.prepararCorreosTest();
check('category change resets the default (no longer SIP → ticked again)', fila('22222').Enviar === true && !/SIP/.test(fila('22222').Observaciones));

// ── EFA kickoff: same flow, own tab; clave repeated, "the same we sent on…" only where the Test email went out ──
['Proyecto', 'Sostenedor'].forEach(h => { const i = sheets['SF'][0].indexOf(h); sheets['SF'].slice(1).forEach(r => { if (r[0]) r[i] = ''; }); });
sheets['Correos Test'].find(x => x[0] === '11111')[12] = new Date(2026, 9, 9, 10, 30);
sheets['Correos Test'].find(x => x[0] === '22222')[12] = '';
const testAntes = JSON.stringify(sheets['Correos Test']);
const infEfa = ctx.prepararCorreosEfa();
const filaEfa = rbd => { const t = sheets['Correos EFA']; const h = t[0]; const r = t.find(x => x[0] === rbd); return r && Object.fromEntries(h.map((k, i) => [k, r[i]])); };
const ea = filaEfa('11111'), ef = filaEfa('22222'), ec = filaEfa('33333');
check('EFA: own tab, same header, Correos Test untouched', sheets['Correos EFA'][0].join('|') === sheets['Correos Test'][0].join('|') && JSON.stringify(sheets['Correos Test']) === testAntes && /^Correos EFA: 4 colegios/.test(infEfa));
check('EFA: programs with an EFA link, subject, dates, who answers, encargado asked to share and remind', ea.Programas === 'ASE + REL' && ea.Enviar === true && ea.Asunto === 'Encuesta de Fin de Año 2026 · Colegio Los Aromos'
  && ea.Mensaje.includes('Les escribimos de Fundación Trabün para contarles que la Encuesta de Fin de Año de los programas de Aprendizaje Socioemocional y Religión Católica estará disponible desde el lunes 2 de noviembre hasta el viernes 13 de noviembre. La responden directivos, líderes y docentes que participan en los programas.')
  && ea.Mensaje.includes('Cada persona va a recibir la invitación en su correo') && ea.Mensaje.includes('les pedimos compartir el link con su equipo y recordarles que la respondan.')
  && ea.Mensaje.includes('nunca sus respuestas'));
check('EFA: Test email sent → "the same RBD and clave we sent on 9 de octubre", clave repeated', ea.Mensaje.includes('En el Portal de Seguimiento 2026, el mismo del Test de Estudiantes, van a encontrar:')
  && ea.Mensaje.includes('Entren con el mismo RBD y clave que les enviamos el 9 de octubre:\\nRBD: 11111\\nClave: aaa111'));
check('EFA: no Test email → plain "enter with these details", singular', ef.Mensaje.includes('Te escribimos') && ef.Mensaje.includes('Entra al portal con estos datos:\\nRBD: 22222\\nClave: bbb222')
  && !ef.Mensaje.includes('el mismo del Test') && ef.Mensaje.includes('del programa de Aprendizaje Socioemocional') && ef.Mensaje.includes('participan en el programa.') && ef.Contacto === 'consultas_edi@fundaciontrabun.cl');
check('EFA: clave only for whoever helps with the follow-up, with the reason (singular / plural); Test wording unchanged', ef.Mensaje.includes('La clave es para ti y quienes te ayuden con el seguimiento; te pedimos no compartirla con nadie más, ya que en el portal se ve quién ha respondido.')
  && ea.Mensaje.includes('La clave es para ustedes y quienes les ayuden con el seguimiento; les pedimos no compartirla con nadie más') && !ef.Mensaje.includes('fuera de él') && a.Mensaje.includes('pedimos no compartirla fuera de él'));
check('EFA: Control left out with its own reason', ec.Enviar === false && ec.Programas === '' && ec.Observaciones.includes('Sin programas con link EFA'));
enviados = [];
ctx.enviarCorreoPruebaEfa();
check('EFA prueba: [PRUEBA] samples to the runner only, html says who it would go to', enviados.length === 2 && enviados.every(e => e.to === 'yo@ejemplo.invalid' && /^\\[PRUEBA\\] Encuesta de Fin de Año 2026 · /.test(e.subject) && !e.cc && e.htmlBody.includes('Correo de prueba.')));
enviados = [];
const rEfa = ctx.enviarCorreosEfa();
const envA = enviados.find(e => e.to === 'mj@ejemplo.invalid,pedro@ejemplo.invalid');
check('EFA send: both schools, CC team, html with clave + both portal items, Enviado stamped in Correos EFA only', enviados.length === 2 && envA && envA.cc === 'jdp.x@ejemplo.invalid' && envA.htmlBody.includes('>aaa111</td>')
  && envA.htmlBody.includes('El link de la encuesta') && envA.htmlBody.includes('Quiénes ya respondieron') && envA.htmlBody.includes('La Encuesta de Fin de Año') && !envA.htmlBody.includes('Los links del test')
  && filaEfa('11111').Enviado instanceof Date && filaEfa('22222').Enviado instanceof Date && JSON.stringify(sheets['Correos Test']) === testAntes && /No quedan pendientes/.test(rEfa));
check('EFA: re-run sends nothing; no emails or claves in logs', (() => { enviados = []; ctx.enviarCorreosEfa(); return enviados.length === 0; })() && !/@ejemplo\\.invalid|aaa111|bbb222/.test(logs.join('\\n')));
check('EFA: a program without an EFA link is not announced', (() => { const f = sheets['Formularios'].find(r => r[1] === 'REL Consolidado'); const l = f[8]; f[8] = ''; delete sheets['Correos EFA']; ctx.prepararCorreosEfa(); f[8] = l; return filaEfa('11111').Programas === 'ASE' && !filaEfa('11111').Mensaje.includes('Religión'); })());
check('EFA EDI cohort 2025: impact-study paragraph (singular), right after the intro; regular schools without it',
  ef.Mensaje.includes('participan en el programa.\\n\\nTu colegio forma parte del Estudio de Impacto del programa. Después de dos años de implementación, esta encuesta y el Test de Estudiantes son el último hito del estudio, por eso tu opinión es tan valiosa. Te pedimos, por favor, que la respondas con calma y a conciencia.\\n\\nCada persona')
  && !ea.Mensaje.includes('Estudio de Impacto'));
check('EFA EDI cohort 2026 (plural): first-year wording; unknown cohort: no paragraph', (() => {
  const res = ctx.panel_('22222', ctx.cargarDatos_(), ctx.reloj_()), dos = [{ email: 'a@b.cl', nombre: 'A' }, { email: 'c@d.cl', nombre: 'C' }];
  const t26 = ctx.correoEfa_(res, res.programas, dos, 'k', '', 2026).texto, t24 = ctx.correoEfa_(res, res.programas, dos, 'k', '', 2024).texto;
  return t26.includes('Su colegio forma parte del Estudio de Impacto del programa. En este primer año de implementación, esta encuesta y el Test de Estudiantes son una pieza clave del estudio, por eso su opinión es tan valiosa. Les pedimos, por favor, que la respondan con calma y a conciencia.')
    && !t24.includes('Estudio de Impacto'); })());
check('EFA: Bien Público and SIP announced like the rest (Test rules do not apply)', (() => {
  const iP = sheets['SF'][0].indexOf('Proyecto'), iS = sheets['SF'][0].indexOf('Sostenedor');
  sfFila(11111, 'Religión')[iP] = 'Bien Público'; sfFila(11111, 'ASE')[iP] = 'Bien Público'; sfFila(22222, 'ASE')[iS] = 'Sociedad De Instruccion Primaria De Santiago';
  delete sheets['Correos EFA']; ctx.prepararCorreosEfa();
  const ok = filaEfa('11111').Programas === 'ASE + REL' && filaEfa('11111').Enviar === true && filaEfa('22222').Enviar === true && !/SIP|Bien Público/.test(filaEfa('11111').Observaciones + filaEfa('22222').Observaciones);
  sfFila(11111, 'Religión')[iP] = ''; sfFila(11111, 'ASE')[iP] = ''; sfFila(22222, 'ASE')[iS] = '';
  return ok; })());
check('EFA: "the same we sent you" only if every recipient got the Test email (an encargado changed → plain wording)', (() => {
  const fila11 = sheets['Correos Test'].find(x => x[0] === '11111'), para = fila11[4];
  fila11[4] = 'mj@ejemplo.invalid'; delete sheets['Correos EFA']; ctx.prepararCorreosEfa();
  const cambio = filaEfa('11111').Mensaje;
  fila11[4] = para; delete sheets['Correos EFA']; ctx.prepararCorreosEfa();
  return cambio.includes('Entren al portal con estos datos:') && !cambio.includes('les enviamos el') && !cambio.includes('el mismo del Test')
    && filaEfa('11111').Mensaje.includes('les enviamos el 9 de octubre'); })());


// ── EFA-EDI reminder to each pending person (prepararCorreosFaltan, enviarCorreoPruebaFaltan, enviarCorreosFaltan) ─
{
  const cfg = k => sheets['Config'].find(r => r[0] === k);
  const antes = [cfg('efa_abre')[1], cfg('efa_cierra')[1]];
  cfg('efa_abre')[1] = '01-01-2020'; cfg('efa_cierra')[1] = '31-12-2099'; // open whatever the run date
  const cont = (nombre, apellido, rol, email, rut) => [FARO, 'x', 'ASE', 'Intensivo', true, 2025, 'x', nombre, apellido, rol, email, true, '[]', rut];
  sheets['Contactos EFA-EDI'] = [['Nombre para formulario', 'Account Name', 'Implementación: Record Type', 'Implementación: Modelo', 'Implementación: EDI',
    'Año inicio ASE', 'Implementación: Nombre de la Implementación', 'First Name', 'Last Name', 'Rol en la Implementacióon', 'Email', 'Vigente 2026', 'Rol en el colegio', 'RUT'],
    cont('Ana', 'Pérez', 'Director/a', 'ana@ejemplo.invalid', '12.345.678-5'),
    cont('Ramón', 'Tapia', 'Docente', 'ramon@ejemplo.invalid', '22.222.222-2'),
    cont('Gloria', 'Tapia', 'Docente', 'gloria@ejemplo.invalid', '22.222.222-2'),   // same RUT in SF, another person
    cont('Dora', 'Villal', 'Mentor/a', 'dora.villaal@ejemplo.invalid', ''),        // typo of the SDC address
    cont('Inés', 'Montt', 'Docente', 'ines@ejemplo.invalid', '33.333.333-3'),
    cont('INÉS', 'Montt', 'Docente', 'berta@ejemplo.invalid', ''),             // joined only by name, another address
    cont('Otro', 'Lider', 'Otro', 'otro@ejemplo.invalid', '44.444.444-4'),
    cont('Otro', 'Lider', 'Otro', 'otro2@ejemplo.invalid', '44.444.444-4')];          // same person by RUT, two addresses
  sheets['SDC'] = [['RBD', 'Nombre', 'Apellido', 'Correo', 'Nivel', 'Letra', 'Nivel EDI', 'Cohorte'],
    [22222, 'Gloria', 'Tapia', 'gloria@ejemplo.invalid', '5° básico', 'A', true, 1],
    [22222, 'Dora', 'Villal', 'dora.villal@ejemplo.invalid', '6° básico', 'A', true, 1],
    [22222, 'Inés', 'Montt', 'ines@ejemplo.invalid', '7° básico', 'A', true, 1],
    [22222, 'Carla', 'Núñez', '', '7° básico', 'B', true, 1],                        // no address
    [22222, 'Tomás', 'Díaz', 'tomas@ejemplo.invalid', '8° básico', 'A', true, 1]];   // answered
  const n0 = sheets['Respuestas EFA'].length;
  sheets['Respuestas EFA'].push(['EFA_EDI', '2026-11-05T10:00:00', 'Tomás', 'Díaz', 'tomas@ejemplo.invalid', FARO, 'Soy Docente e implemento el Programa', '8° básico']);
  logs.length = 0; enviados = [];
  const informe = ctx.prepararCorreosFaltan();
  const tab = () => sheets['Correos Faltan'];
  const persona = n => { const t = tab(); const r = t.find(x => x[2] === n); return r && Object.fromEntries(t[0].map((k, i) => [k, r[i]])); };
  check('faltan: one row per pending person, contract header, answered and non-EDI-grade people left out', tab()[0].join('|') === 'RBD|Colegio|Persona|Rol|Para|No se envía a|Asunto|Mensaje|Observaciones|Enviar|Enviado'
    && lastRow('Correos Faltan') === 7 && !persona('Tomás Díaz') && !persona('Ramón Tapia') && /6 personas · 5 por enviar \\(1 colegios\\)/.test(informe));
  check('faltan: one RUT with two first names stays two people (the second one listed on her own)', persona('Gloria Tapia').Para === 'gloria@ejemplo.invalid' && persona('Gloria Tapia').Rol === 'Docente · 5° básico A');
  check('faltan: two addresses together only when sure (RUT, or a near copy); another one joined by name is held back', persona('Otro Lider').Para === 'otro@ejemplo.invalid, otro2@ejemplo.invalid'
    && persona('Dora Villal').Para === 'dora.villaal@ejemplo.invalid, dora.villal@ejemplo.invalid' && persona('Dora Villal').Rol === 'Mentor/a'
    && persona('Inés Montt').Para === 'ines@ejemplo.invalid' && persona('Inés Montt')['No se envía a'] === 'berta@ejemplo.invalid' && /unido solo por nombre/.test(persona('Inés Montt').Observaciones));
  check('faltan: no address → unticked, flagged', persona('Carla Núñez').Enviar === false && persona('Carla Núñez').Observaciones === 'Sin correo' && persona('Ana Pérez').Enviar === true);
  check('faltan: short, warm usted text: first name, deadline from Config, school link, study line by cohort, "si ya la respondió", signed Mauricio; subject «Aún nos falta su respuesta»', (() => {
    const m = persona('Dora Villal').Mensaje;
    return /^Programa de Aprendizaje Socioemocional Trabün · Escuela El Faro\\n\\nHola, Dora:\\n\\nLe escribo porque aún no hemos recibido su respuesta a la Encuesta de Fin de Año del programa de Aprendizaje Socioemocional\\. /.test(m)
      && /La encuesta está abierta hasta el .+ y toma unos 20 minutos:\\nhttps:/.test(m) && m.includes('?rbd=22222')
      && m.includes('Su colegio forma parte del Estudio de Impacto del programa y esta encuesta es el último hito del estudio, por eso su opinión es tan valiosa para nosotros.')
      && m.includes('Si ya la respondió, ¡muchas gracias! Solo respóndame este correo y lo reviso.') && !/\\b(tu|te|ti|respondiste|respóndeme)\\b/i.test(m)
      && /Un abrazo,\\nMauricio\\nFundación Trabün$/.test(m) && persona('Dora Villal').Asunto === 'Aún nos falta su respuesta · Encuesta de Fin de Año 2026'; })());
  ctx.enviarCorreoPruebaFaltan();
  check('faltan prueba: only to whoever runs it, as «Mauricio de Trabün», [PRUEBA], a leader, a teacher and a two-address sample', enviados.length === 3
    && enviados.every(e => e.to === 'yo@ejemplo.invalid' && e.name === 'Mauricio de Trabün' && /^\\[PRUEBA\\] /.test(e.subject) && !e.replyTo && !e.cc)
    && enviados.some(e => e.htmlBody.includes('Correo de prueba') && e.htmlBody.includes('dora.villaal@ejemplo.invalid, dora.villal@ejemplo.invalid')) && !tab().slice(1).some(r => r[10]));
  enviados = [];
  sheets['Respuestas EFA'].push(['EFA_EDI', '2026-11-06T10:00:00', 'Ana', 'Pérez', 'ana@ejemplo.invalid', FARO, 'Director/a', '-']); // answers before the send
  const r = ctx.enviarCorreosFaltan();
  const a = enviados.find(e => e.to === 'dora.villaal@ejemplo.invalid,dora.villal@ejemplo.invalid');
  check('faltan send: one email per person (addresses together), name «Mauricio de Trabün», no reply-to; whoever answered meanwhile skipped', enviados.length === 4
    && a && a.name === 'Mauricio de Trabün' && !a.replyTo && a.htmlBody.includes('>Responder la encuesta</a>') && a.htmlBody.includes('<a href="https://es.') === false && /href="[^"]*\\?rbd=22222[^"]*"[^>]*>Responder la encuesta/.test(a.htmlBody) && a.htmlBody.includes('href="https://portal.fundaciontrabun.cl/e/?22222-EFA-EDI"') && a.htmlBody.includes('>portal.fundaciontrabun.cl/e/?22222-EFA-EDI</a>') && ['banner', 'ola', 'isotipo'].every(k => a.htmlBody.includes('src="cid:' + k + '"') && a.inlineImages[k].type === 'image/png' && a.inlineImages[k].bytes.length > 1000) && !a.htmlBody.includes('<!--prueba-->')
    && !enviados.some(e => /ana@/.test(e.to)) && /Enviados: 4\\. 1 ya respondieron/.test(r) && persona('Ana Pérez').Observaciones === 'Respondió antes del envío: no se envió');
  check('faltan send: Enviado stamped; re-run sends nothing; rebuild keeps who got it and marks who answered', persona('Dora Villal').Enviado instanceof Date
    && (() => { enviados = []; ctx.enviarCorreosFaltan(); return enviados.length === 0; })()
    && (() => { ctx.prepararCorreosFaltan(); return persona('Dora Villal').Enviado instanceof Date && !persona('Ana Pérez') && lastRow('Correos Faltan') === 6; })());
  check('faltan: no emails or names in logs; near-copy rule', !/@ejemplo\\.invalid|Dora|Montt/.test(logs.join('\\n'))
    && ctx.casiIgual_('a.b@x.cl', 'a.b@xc.l') && ctx.casiIgual_('dora.villaal@x.cl', 'dora.villal@x.cl') && !ctx.casiIgual_('ines@x.cl', 'berta@x.cl'));
  sheets['Respuestas EFA'].length = n0; delete sheets['Contactos EFA-EDI']; delete sheets['SDC']; delete sheets['Correos Faltan'];
  cfg('efa_abre')[1] = antes[0]; cfg('efa_cierra')[1] = antes[1];
}

`);
