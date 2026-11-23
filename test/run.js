// Local test harness for gas/Code.js: mocks Apps Script services, fictional schools and people only.
// Run from the repo root: node test/run.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.js'), 'utf8');

const G = ['NT1','NT2','1º','2º','3º','4º','5º','6º','7º','8º','I','II','III','IV'];
const sfHeaders = ['ID RBD','Nombre para formulario','Account Name','Implementación: Record Type','Año inicio ASE','Año inicio Religión',
  'Implementación: Nombre de la Implementación','Subdirección','Modelo','Jefe de Proyecto','Coordinador','EDI','Alumnos implementación',
  ...G.map(g=>'Alumnos '+g),'Cursos total',...G.map(g=>'CxN '+g)];
function sfRow(rbd, nombre, tipo, modelo, edi, anioAse, anioRel, grades) { // grades: {idx:[alumnos,cxn]}
  const al = G.map((_,i)=> grades[i] ? grades[i][0] : ''), cx = G.map((_,i)=> grades[i] ? grades[i][1] : '');
  return [rbd, nombre, 'x', tipo, anioAse, anioRel, 'x', 'x', modelo, 'x', '', edi, 0, ...al, 0, ...cx];
}
const range = (a,b,v) => { const o={}; for (let i=a;i<=b;i++) o[i]=v; return o; };
const sheets = {
  'SF': [sfHeaders,
    sfRow(11111, 'Villa Ficticia - Colegio Los Aromos - 11111', 'ASE', 'Semi-Intensivo', false, 2024, '', range(2,9,[60,2])),
    sfRow(11111, 'Villa Ficticia - Colegio Los Aromos - 11111', 'Religión', 'Consolidado', false, '', 2023, range(6,11,[30,1])),
    sfRow(22222, 'Puerto Inventado - Escuela El Faro - 22222', 'ASE', 'Intensivo', true, 2025, '', range(5,13,[40,1])),
    sfRow(33333, 'Cerro Falso - Liceo Control - 33333', 'ASE', 'Control', false, 2026, '', range(5,9,[40,1])),
    ['', '', '', '', '', '', '', '', '', '', '', '', ''],
  ],
  'Contraseñas': [['rbd','clave'], [11111,'aaa111'], [22222,'bbb222'], [33333,'ccc333'], [44444,'ddd444']],
  'Config': [['clave','valor','nota'],
    ['test_abre', new Date(2026,9,1), ''], ['test_cierra', new Date(2026,10,20), ''],
    ['efa_abre', '02-11-2026', ''], ['efa_cierra', '13-11-2026', ''],
    ['student_id', '', ''], ['contacto_general','evaluacion@fundaciontrabun.cl',''], ['contacto_edi','consultas_edi@fundaciontrabun.cl','']],
  'Formularios': [['Encuesta','Form','Programa','EDI','Año inicio','Modelo','Desde','Hasta','Link'],
    ['test','ASE_4-5','ASE','NO','','','4° básico','5° básico','https://f.example/ase45'],
    ['test','ASE_6-IV','ASE','NO','','','6° básico','IV° medio','https://f.example/ase6iv'],
    ['test','ASE_EDI_4','ASE','SÍ',2025,'','4° básico','4° básico','https://f.example/edi4'],
    ['test','ASE_EDI_I-IV','ASE','SÍ',2025,'','I° medio','IV° medio',''],
    ['test','ASE_EDI_8-IV','ASE','SÍ',2026,'','8° básico','IV° medio','https://f.example/edi8'],
    ['test','REL_5-8','REL','','','','5° básico','8° básico','https://f.example/rel58'],
    ['test','REL_I-IV','REL','','','','I° medio','IV° medio','https://f.example/reliv'],
    ['efa','ASE Semi-intensivo','ASE','NO','','Semi-intensivo','','','https://s.example/efa-ase-si'],
    ['efa','EFA_EDI','ASE','SÍ','','','','','https://s.example/efa-edi?rbd={rbd}&colegio={colegio}&comuna={comuna}&k={rbd}'],
    ['efa','REL Consolidado','REL','','','Consolidado','','','https://s.example/efa-rel-c?rbd={RBD}&colegio={colegio}&comuna={comuna}'],
    ['', '', '', '', '', '', '', '', ''],
  ],
  'Métricas': [['timestamp','rbd','programas','testOk','efaOk','evento']],
};
const C = n => { const a = Array(16).fill(''); a[n % 16] = arguments; return a; };
function test(form, nombres, apellidos, num, nivel, letra, colegio, region) {
  const cols = Array(16).fill(''); cols[region] = colegio;
  return [form, '', nombres, apellidos, num, nivel, letra, ...cols];
}
const AROMOS = 'Villa Ficticia - Colegio Los Aromos - 11111';
sheets['Respuestas Test'] = [['Form','Marca temporal','Nombres','Apellidos','Número de lista','Nivel','Letra',...Array(16).fill('Colegio')],
  test('ASE_4-5','Martina','Rojas Díaz',3,'4° básico','A',AROMOS,4),
  test('ASE_4-5','agustín','bravo',12,'4° Básico','A',AROMOS,4),       // casing variant
  test('ASE_4-5','Sofía','Álvarez',12,'4° básico','B',AROMOS,4),       // accent sort
  test('ASE_4-5','','',35,'4° básico','C',AROMOS,4),                   // unregistered letter, sin identificar
  test('ASE_6-IV','Vicente','Muñoz','x','6º básico','b',AROMOS,4),      // ordinal sign, lowercase letter, bad number
  test('ASE_6-IV','Isidora','Pérez',7,'IV° medio','A',AROMOS,4),       // grade outside registered
  test('ASE_6-IV','Tomás','Silva',8,'Cuarto','A',AROMOS,4),            // invalid grade → skipped
  test('ASE_6-IV','Emilia','Lagos',2,'6° básico','',AROMOS,4),         // no letter
  test('REL_5-8','Lucas','Vera',5,'5° básico','A',AROMOS,4),           // REL but 5° not implemented in REL → outside
  test('REL_5-8','Josefa','Mella',6,'6° básico','A',AROMOS,4),
  test('REL_I-IV','Diego','Castro',4,'III° medio','A',AROMOS,4),       // REL implemented only to II° → outside
  test('ASE_EDI_8-IV','Otro','Colegio',1,'8° básico','A','Puerto Inventado - Escuela El Faro - 22222',9),
];
sheets['Respuestas EFA'] = [['Form','Fecha','Nombre','Apellido','Correo','Colegio','Rol','Niveles'],
  ['ASE Semi-intensivo','2026-11-03T10:00:00','María José','Fuentes','mj@ejemplo.cl',AROMOS,'Director/a del establecimiento','-'],
  ['ASE Semi-intensivo','2026-11-04T10:00:00','María José','Fuentes Soto','MJ@ejemplo.cl ',AROMOS,'Director/a del establecimiento','-'], // dup → newer wins
  ['ASE Semi-intensivo','2026-11-03T11:00:00','Paula','Ríos','pr@ejemplo.cl',AROMOS,'Docente que implementa el Programa ASE-Orientación de Trabün','5° básico, 6° básico'],
  ['ASE Semi-intensivo','2026-11-03T12:00:00','Paula','Ríos','pr@ejemplo.cl',AROMOS,'Mentor/a, es decir, acompaño y retroalimento a docentes que implementan el Programa','-'], // 2nd role
  ['ASE Semi-intensivo','2026-11-03T13:00:00','Ricardo','Fuenzalida','rf@ejemplo.cl',AROMOS,'Docente que implementa el Programa ASE-Orientación de Trabün','I° medio'], // outside
  ['ASE Semi-intensivo','2026-11-03T14:00:00','Sin','Nivel','sn@ejemplo.cl',AROMOS,'Docente que implementa el Programa ASE-Orientación de Trabün','-'],
  ['REL Consolidado','2026-11-03T15:00:00','Francisca','Mella','fm@ejemplo.cl',AROMOS,'Docente que implementa el Programa de Religión de Trabün','6° básico'],
];

const sheetObj = name => ({
  getDataRange: () => ({ getValues: () => sheets[name].map(r => r.slice()) }),
  appendRow: row => sheets[name].push(row),
  getRange: (r, c) => ({ getValue: () => (sheets[name][r-1] || [])[c-1] ?? '', setValue(v) { sheets[name][r-1][c-1] = v; return this; }, setFontWeight() { return this; } }),
});
const cacheStore = {};
const fmt = (d, tz, f) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(d).map(x=>[x.type,x.value]));
  const ymd = `${p.year}-${p.month}-${p.day}`;
  return f === 'yyyy-MM-dd' ? ymd : `${ymd}T${p.hour}:${p.minute}:${p.second}-03:00`;
};
const logs = [];
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: n => sheets[n] ? sheetObj(n) : null }) },
  CacheService: { getScriptCache: () => ({ get: k => cacheStore[k] ?? null, put: (k,v) => { cacheStore[k] = v; }, remove: k => { delete cacheStore[k]; } }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ s, setMimeType() { return this; } }) },
  Utilities: { formatDate: fmt },
  console: { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push('ERROR ' + a.join(' ')) },
  Date, Map, Set, JSON, Math, Number, String, Object, Array, isFinite, isNaN,
};
vm.createContext(ctx); vm.runInContext(src, ctx);
const post = body => JSON.parse(ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).s);
const check = (label, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) process.exitCode = 1; };

check('GET health', JSON.parse(ctx.doGet().s).ok === true);
check('malformed body → credenciales', post('not json').error === 'credenciales');
check('wrong clave → credenciales', post({rbd:'11111', clave:'zzz'}).error === 'credenciales');
check('unknown rbd → credenciales', post({rbd:'99999', clave:'zzz'}).error === 'credenciales');
const eighth = [...Array(8)].map(() => post({rbd:'22222', clave:'nope'}).error);
check('8 wrong attempts → credenciales, 9th blocked even with right clave', eighth.every(e => e === 'credenciales') && post({rbd:'22222', clave:'bbb222'}).error === 'bloqueado');
check('clave is case-sensitive', post({rbd:'11111', clave:'AAA111'}).error === 'credenciales');
delete cacheStore['intentos_11111'];

const r = post({rbd:' 11111.0 ', clave:'aaa111 '});
check('login ok with normalized rbd/clave', r.ok === true && r.colegio.nombre === 'Colegio Los Aromos' && r.colegio.comuna === 'Villa Ficticia');
check('contacto general', r.contacto === 'evaluacion@fundaciontrabun.cl');
{
  const d = ctx.cargarDatos_();
  const conAviso = ctx.panel_('11111', Object.assign({}, d, { cfg: Object.assign({}, d.cfg, { aviso_portal: '  Aviso de prueba.\nSegunda línea.  ' }) }), ctx.reloj_());
  check('aviso_portal: blank by default, trimmed text when set', r.aviso === '' && conAviso.aviso === 'Aviso de prueba.\nSegunda línea.');
}
check('phases computed (Config dates as Date and dd-mm-yyyy)', r.encuestas.test.abre === '2026-10-01' && r.encuestas.efa.abre === '2026-11-02' && r.encuestas.efa.fase !== null);
check('extra week: open until cierra, then "extra" with days to the extension, then closed; cierra unchanged', (() => {
  const v = hoy => ctx.ventana_('02-11-2026', '13-11-2026', hoy, new Date(2026, 10, 20));
  const a = v('2026-11-13'), b = v('2026-11-16'), c = v('2026-11-20'), e = v('2026-11-21');
  return a.fase === 'open' && a.diasRestantes === 0 && a.extension === '2026-11-20'
    && b.fase === 'extra' && b.diasRestantes === 4 && b.cierra === '2026-11-13'
    && c.fase === 'extra' && c.diasRestantes === 0 && e.fase === 'closed' && e.diasRestantes === null; })());
check('extra week ignored when blank or not after cierra (no extension key)', (() => {
  const a = ctx.ventana_('02-11-2026', '13-11-2026', '2026-11-16', ''), b = ctx.ventana_('02-11-2026', '13-11-2026', '2026-11-16', '13-11-2026');
  return a.fase === 'closed' && !('extension' in a) && b.fase === 'closed' && !('extension' in b) && !('extension' in r.encuestas.efa); })());
check('efa_extension in Config reaches the panel', (() => {
  const d = ctx.cargarDatos_();
  const p = ctx.panel_('11111', Object.assign({}, d, { cfg: Object.assign({}, d.cfg, { efa_extension: new Date(2026, 10, 20) }) }), ctx.reloj_());
  return p.encuestas.efa.extension === '2026-11-20' && !('extension' in p.encuestas.test); })());
const ase = r.programas.find(p=>p.programa==='ase'), rel = r.programas.find(p=>p.programa==='rel');
check('ASE test grades from Formularios ∩ implemented', JSON.stringify(ase.test.nivelesTest) === JSON.stringify(['4° básico','5° básico','6° básico','7° básico','8° básico','I° medio','II° medio','III° medio','IV° medio']));
check('ASE test links (2, non-EDI)', ase.test.links.map(l=>l.form).join() === 'ASE_4-5,ASE_6-IV');
check('Test links carry the school (SurveyMonkey custom variables, as in the links file)', ase.test.links[0].link === 'https://f.example/ase45?RBD=11111&colegio=Colegio%20Los%20Aromos%2C%20Villa%20Ficticia');
const nMetCorto = sheets['Métricas'].length;
const corto = c => post({ corto: c });
check('short link → the same full link the panel shares (no clave needed)', corto('11111-ASE_4-5').link === ase.test.links[0].link && corto(' 11111-rel_5-8 ').link === rel.test.links.find(l => l.form === 'REL_5-8').link);
check('short link: separators and case ignored (ASE-4-5, ASE_4-5, ASE4-5, ase45)', ['11111-ASE-4-5', '11111-ASE_4-5', '11111-ASE4-5', '11111-ase45', '11111-ASE 4 5']
  .every(c => corto(c).link === ase.test.links[0].link) && corto('11111-REL-I-IV').link === rel.test.links.find(l => l.form === 'REL_I-IV').link);
check('short link rejected: unknown RBD, form of another program, EDI form for a non-EDI school, EFA or unknown form, garbage',
  ['99999-ASE_4-5', '33333-REL_5-8', '11111-ASE_EDI_4', '11111-ASE Semi-intensivo', '11111-XYZ', 'ASE_4-5', '', null].every(c => corto(c).error === 'link'));
const cortoEfa = c => post({ corto: c, encuesta: 'efa' });
check('EFA short link (/e/): same full link the panel shares, separators and case ignored, link without gaps as written',
  cortoEfa('11111-REL-Consolidado').link === rel.efa.links[0].link && cortoEfa('11111-rel consolidado').link === rel.efa.links[0].link
  && cortoEfa('11111-ASE-Semi-intensivo').link === 'https://s.example/efa-ase-si' && /rbd=22222&colegio=Escuela%20El%20Faro/.test(cortoEfa('22222-EFA-EDI').link));
check('EFA short link rejected: Test form on /e/, EDI form for a non-EDI school, unknown RBD; /t/ still only Test',
  ['11111-ASE_4-5', '11111-EFA_EDI', '99999-REL-Consolidado'].every(c => cortoEfa(c).error === 'link') && corto('11111-REL-Consolidado').error === 'link');
check('Control program: an EFA response sent by mistake is not shown (no tab: no link, total 0)', (() => {
  sheets['Respuestas EFA'].push(['ASE Semi-intensivo','2026-11-03T10:00:00','Error','Control','ec@ejemplo.cl','Cerro Falso - Liceo Control - 33333','Docente que implementa el Programa ASE-Orientación de Trabün','5° básico']);
  const e = ctx.panel_('33333', ctx.cargarDatos_(), ctx.reloj_()).programas[0].efa;
  sheets['Respuestas EFA'].pop();
  return e.links.length === 0 && e.total === 0 && e.secciones.every(x => x.r === 0); })());
check('EFA never for a Control program (EDI controls included), Test rows unaffected', (() => {
  const ctl = { programa: 'ase', edi: true, modelo: 'Control', anioInicio: 2025 }, forms = ctx.cargarDatos_().formularios;
  return ctx.formulariosDe_(forms, 'efa', ctl).length === 0 && ctx.formulariosDe_(forms, 'efa', Object.assign({}, ctl, { modelo: 'Intensivo' })).length === 1
    && ctx.formulariosDe_(forms, 'test', ctl).length > 0; })());
check('short link: no Métricas row, no throttle', sheets['Métricas'].length === nMetCorto && !Object.keys(cacheStore).some(k => k.startsWith('intentos_1')));
check('EFA link without gaps shown as written (no RBD added)', ase.efa.links[0].link === 'https://s.example/efa-ase-si');
check('EFA link gaps filled per school ({RBD} case-insensitive, name and comuna apart, as in the EFA links file)',
  rel.efa.links[0].link === 'https://s.example/efa-rel-c?rbd=11111&colegio=Colegio%20Los%20Aromos&comuna=Villa%20Ficticia');
check('gaps: spaces collapsed, quotes and parentheses escaped like the links file; missing SF name → no link',
  ctx.linkPlantilla_('https://x/?rbd={rbd}&colegio={colegio}&comuna={comuna}', '2787', { nombre: "Colegio  Nuestra Señora (Ex ST) D'Agostini", comuna: 'Curicó' })
    === 'https://x/?rbd=2787&colegio=Colegio%20Nuestra%20Se%C3%B1ora%20%28Ex%20ST%29%20D%27Agostini&comuna=Curic%C3%B3'
  && ctx.linkPlantilla_('https://x/?rbd={rbd}&colegio={colegio}', '5', { nombre: null, comuna: null }) === ''
  && ctx.linkPlantilla_('https://x/?rbd={rbd}', '5', null) === 'https://x/?rbd=5');
check('link that already has RBD or a query: kept / appended with &', ctx.linkColegio_('https://x.example/r/A?RBD=5', '11111', null) === 'https://x.example/r/A?RBD=5'
  && ctx.linkColegio_('https://x.example/r/A?lang=es', '11111', { nombre: 'Escuela  Uno', comuna: 'Ñuble' }) === 'https://x.example/r/A?lang=es&RBD=11111&colegio=Escuela%20Uno%2C%20%C3%91uble');
const lv = n => ase.test.niveles.find(x=>x.nivel===n);
check('registered grades = 4°..8° then outside IV° medio last', ase.test.niveles.map(n=>n.nivel+(n.registrado?'':'*')).join('|') === '4° básico|5° básico|6° básico|7° básico|8° básico|IV° medio*');
check('4° básico r=4, est=60, letters A,B + C unregistered', lv('4° básico').r === 4 && lv('4° básico').est === 60 && lv('4° básico').cursos.map(c=>c.letra+(c.registrado?'':'*')).join() === 'A,B,C*');
check('sort by apellido, accent-insensitive', lv('4° básico').cursos[0].respuestas.map(x=>x.apellidos).join() === 'bravo,Rojas Díaz');
check('class est = round(Alumnos ÷ CxN) for SF letters only (4°: 60 ÷ 2 = 30; unregistered C and no-letter bucket null)',
  lv('4° básico').cursos.map(c => c.est).join() === '30,30,' && lv('6° básico').cursos.map(c => c.est).join() === '30,30,'
  && lv('IV° medio').cursos.every(c => c.est === null));
const N = vm.runInContext('NIVELES', ctx), nv = v => N[ctx.nivelIdx_(v)] || null;
check('grade sign optional (° / º / none, any case, extra spaces), still exact', nv('7° Básico') === '7° básico' && nv('6º básico') === '6° básico'
  && nv('5 Básico') === '5° básico' && nv('5 ° basico') === '5° básico' && nv('I Medio') === 'I° medio' && nv('II medio') === 'II° medio'
  && nv('IV  MEDIO') === 'IV° medio' && nv('NT1') === 'NT1' && nv('I° medio A') === null && nv('Cuarto') === null && nv('1') === null);
check('Sin identificar → nulls', lv('4° básico').cursos[2].respuestas[0].nombres === null);
check('6º ordinal + lowercase letter b matched; no-letter bucket last', lv('6° básico').cursos.map(c=>`${c.letra}:${c.r}`).join() === 'A:0,B:1,null:1');
check('invalid grade row skipped; resumen', JSON.stringify(ase.test.resumen) === JSON.stringify({r:7, rConEst:6, est:300}));
check('IV° medio outside: no est', lv('IV° medio').est === null && lv('IV° medio').registrado === false);
check('REL: 5°–II° registered, III° medio outside', rel.test.niveles.map(n=>n.nivel+(n.registrado?'':'*')+':'+n.r).join('|') === '5° básico:1|6° básico:1|7° básico:0|8° básico:0|I° medio:0|II° medio:0|III° medio*:1');
check('EFA link by modelo, case-insensitive', ase.efa.links.map(l=>l.form).join() === 'ASE Semi-intensivo' && rel.efa.links.length === 1);
const sec = id => ase.efa.secciones.find(s=>s.id===id);
check('EFA dedup: director newest wins', sec('direccion').r === 1 && sec('direccion').personas[0].nombre === 'María José Fuentes Soto');
check('EFA two roles same person: mentor in líderes', sec('lideres').r === 1 && sec('lideres').personas[0].rol === 'Mentor/a');
check('EFA docentes r=3 (Paula, Ricardo, Sin Nivel)', sec('docentes').r === 3);
const dn = sec('docentes').niveles.map(g=>`${g.nivel}${g.registrado?'':'*'}:${g.r}`).join('|');
check('ASE docentes grouped: implemented ∪ declared, null group last', dn === '1° básico:0|2° básico:0|3° básico:0|4° básico:0|5° básico:1|6° básico:1|7° básico:0|8° básico:0|I° medio*:1|null*:1');
check('EFA total = responses after dedup, 2 roles = 2 (5)', ase.efa.total === 5 && ase.efa.total === ase.efa.secciones.reduce((a, s) => a + s.r, 0));
check('ASE docentes grades carry SF CxN as cursos (2; null outside/no grade)', sec('docentes').niveles.every(g => g.registrado ? g.cursos === 2 : g.cursos === null));
check('REL docentes carry declared grades', JSON.stringify(rel.efa.secciones[2].personas.map(x => x.niveles)) === JSON.stringify([['6° básico']]) && sec('direccion').personas.every(x => !('niveles' in x)));
check('declared grades: regular "NT1, 5° básico" and EDI "NT1: A, B | 1° básico: A, B" (classes ignored, no repeats)',
  JSON.stringify(ctx.nivelesDeTexto_('NT1, 5° básico')) === '[0,6]' && JSON.stringify(ctx.nivelesDeTexto_('NT1: A, B | NT2: A, B | 1° básico: A, B | 2° básico: A')) === '[0,1,2,3]'
  && ctx.nivelesDeTexto_('-').length === 0 && ctx.nivelesDeTexto_('').length === 0 && JSON.stringify(ctx.nivelesDeTexto_('I° medio: A | I° medio: B')) === '[10]');
check('declared grades: EDI matrix rows answered "-" are not declared',
  JSON.stringify(ctx.nivelesDeTexto_('NT1: A | NT2: - | 1° básico: - | 2° básico: - | 3° básico: - | 4° básico: - | 5° básico: - | 6° básico: - | 7° básico: - | 8° básico: - | I° medio: - | II° medio: - | III° medio: - | IV° medio: -')) === '[0]'
  && JSON.stringify(ctx.nivelesDeTexto_('NT1: - | NT2: A | 3° básico: A, C')) === '[1,4]'
  && ctx.nivelesDeTexto_('NT1: - | NT2: -  | 1° básico:').length === 0);
check('REL docentes flat list', Array.isArray(rel.efa.secciones[2].personas) && !rel.efa.secciones[2].niveles);
check('2026 EFA role options → section + short label (REL, ASE, EDI wordings; leading "Soy" ignored; unknown → Líderes)', [
  ['Director/a del establecimiento', 'direccion', 'Director/a'],
  ['Encargado/a del Programa, es decir, estoy a cargo de la relación del establecimiento con la Fundación', 'lideres', 'Encargado/a'],
  ['Mentor/a, es decir, acompaño y retroalimento a docentes que implementan el Programa', 'lideres', 'Mentor/a'],
  ['Cumplo ambos roles, es decir, soy Encargado/a y Mentor/a del Programa', 'lideres', 'Encargado/a y Mentor/a'],
  ['Docente que implementa el Programa de Religión de Trabün', 'docentes', 'Docente'],
  ['Docente que implementa el Programa ASE-Orientación de Trabün', 'docentes', 'Docente'],
  ['Cumplo todos los roles: Encargado/a, Mentor/a y Docente', 'lideres+docentes', 'Encargado/a, Mentor/a y Docente'],
  ['Otro/a líder del establecimiento (UTP, coordinador/a u otros)', 'lideres', 'Otro/a líder'],
  ['Soy Docente e implemento el Programa de ASE-Orientación Trabün en sala de clases', 'docentes', 'Docente'],
  ['Soy Mentor/a del programa, es decir, acompaño y retroalimento a docentes que implementan el programa.', 'lideres', 'Mentor/a'],
  ['Soy Encargado del programa, es decir, estoy a cargo de la relación del establecimiento con Trabün.', 'lideres', 'Encargado/a'],
  ['Equipo Directivo / Convivencia Escolar.', 'direccion', 'Equipo Directivo / Convivencia Escolar'],
  ['Algo nuevo, con coma', 'lideres', 'Algo nuevo'],
].every(([t, sec, corto]) => { const r = ctx.rolEfa_(t); return r.secciones.join('+') === sec && r.corto === corto; }));
check('EFA order inside a section: by role (org chart), then by surname; docentes before "todos los roles" in Docentes', (() => {
  const mk = (nombres, apellidos, rol, i) => Object.assign({ fila: i, correo: 'p' + i + '@x.cl', fecha: i, nombre: nombres + ' ' + apellidos, nombres, apellidos, rol, niveles: [] }, (r => ({ rolCorto: r.corto, secciones: r.secciones }))(ctx.rolEfa_(rol)));
  const b = ctx.bloqueEfa_({ programa: 'rel', implementados: [], cxn: [] }, [
    mk('Ana', 'Zúñiga', 'Otro/a líder del establecimiento (UTP, coordinador/a u otros)', 1),
    mk('Beatriz', 'Soto', 'Mentor/a, es decir, acompaño', 2),
    mk('Carlos', 'Álvarez', 'Cumplo todos los roles: Encargado/a, Mentor/a y Docente', 3),
    mk('Diego', 'Pérez', 'Encargado/a del Programa, es decir…', 4),
    mk('Elena', 'Muñoz', 'Mentor/a, es decir, acompaño', 5),
    mk('Felipe', 'Bravo', 'Docente que implementa el Programa de Religión de Trabün', 6),
    mk('Gloria', 'Castro', 'Cumplo ambos roles, es decir, soy Encargado/a y Mentor/a del Programa', 7),
    mk('Hugo', 'Zamora', 'Docente que implementa el Programa de Religión de Trabün', 8)]);
  const nombres = id => b.secciones.find(x => x.id === id).personas.map(x => x.nombre.split(' ')[1]).join(',');
  return nombres('lideres') === 'Pérez,Muñoz,Soto,Castro,Álvarez,Zúñiga' && nombres('docentes') === 'Bravo,Zamora,Álvarez';
})());
sheets['Respuestas EFA'].push(['REL Consolidado','2026-11-03T16:00:00','Tomás','Vega','tv@ejemplo.cl',AROMOS,'Cumplo todos los roles: Encargado/a, Mentor/a y Docente','-']);  // the survey asks them no grades
const relTodos = ctx.panel_('11111', ctx.cargarDatos_(), ctx.reloj_()).programas.find(p => p.programa === 'rel').efa;
check('"Cumplo todos los roles": listed in Líderes and in Docentes (no grades: not asked), counted once in the total',
  relTodos.total === 2 && relTodos.secciones[1].personas.map(x => x.nombre).join() === 'Tomás Vega' && relTodos.secciones[2].personas.map(x => x.nombre).join() === 'Francisca Mella,Tomás Vega'
  && relTodos.secciones[2].personas[1].niveles.length === 0 && relTodos.secciones[1].r + relTodos.secciones[2].r === 3);
sheets['Respuestas EFA'].pop();
check('no emails anywhere in payload', !JSON.stringify(r).includes('@ejemplo.cl'));

sheets['Config'][5][1] = 'numero';
const rn = post({rbd:'11111', clave:'aaa111'});
const c4 = rn.programas[0].test.niveles[0].cursos;
check('numero mode: no names, numbers sorted, tope = max(highest, round(60/2)=30)', !JSON.stringify(rn).includes('Martina') && JSON.stringify(c4[0]) === JSON.stringify({letra:'A',registrado:true,r:2,est:30,tope:30,numeros:[3,12],sinNumero:0}));
check('numero mode: unregistered class tope = highest answered', c4[2].tope === 35);
check('numero mode: bad number → sinNumero', rn.programas[0].test.niveles.find(n=>n.nivel==='6° básico').cursos[1].sinNumero === 1);
sheets['Config'][5][1] = '';

const re = post({rbd:'22222', clave:'bbb222'});
check('blocked RBD still blocked', re.error === 'bloqueado');
delete cacheStore['intentos_22222'];
const re2 = post({rbd:'22222', clave:'bbb222'});
check('EDI cohort 2025: contacto EDI, test grades 4° + I°–IV°, link only where filled', re2.contacto === 'consultas_edi@fundaciontrabun.cl' && re2.programas[0].test.nivelesTest.join() === '4° básico,I° medio,II° medio,III° medio,IV° medio' && re2.programas[0].test.links.map(l=>l.form).join() === 'ASE_EDI_4');
check('EDI: only EFA_EDI form', re2.programas[0].efa.links.map(l=>l.form).join() === 'EFA_EDI');
check('EDI EFA link carries k = RBD (ASE surveys)', re2.programas[0].efa.links[0].link === 'https://s.example/efa-edi?rbd=22222&colegio=Escuela%20El%20Faro&comuna=Puerto%20Inventado&k=22222');
check('EDI cohort sent for the EFA message (null for non-EDI programs)', re2.programas[0].cohorte === 2025 && ase.cohorte === null && rel.cohorte === null);
check('EDI cohort 2025: paper grades 5°–8° (implemented, not online); non-EDI none', re2.programas[0].test.nivelesPapel.join() === '5° básico,6° básico,7° básico,8° básico' && ase.test.nivelesPapel.length === 0 && rel.test.nivelesPapel.length === 0);
check('EDI: 8° response from cohort-2 form shows as outside', re2.programas[0].test.niveles.find(n=>n.nivel==='8° básico').registrado === false);

const rx = post({rbd:'44444', clave:'ddd444'});
check('in Contraseñas, not in SF → programas []', rx.ok && rx.programas.length === 0 && rx.colegio.nombre === null);

const saved = sheets['Respuestas Test']; delete sheets['Respuestas Test'];
const rd = post({rbd:'11111', clave:'aaa111'});
check('Respuestas Test missing → test.ok false, login still ok, links kept', rd.ok && rd.programas[0].test.ok === false && rd.programas[0].test.links.length === 2 && !rd.programas[0].test.niveles && rd.programas[0].efa.ok);
sheets['Respuestas Test'] = saved;
const savedSF = sheets['SF']; delete sheets['SF'];
check('SF missing → servidor', post({rbd:'11111', clave:'aaa111'}).error === 'servidor');
sheets['SF'] = savedSF;

check('program carries modelo / jefe / coordinador (null when blank)', ase.modelo === 'Semi-Intensivo' && ase.jefeProyecto === 'x' && ase.coordinador === null);
const nMet = sheets['Métricas'].length;
const rf = post({rbd:'11111', clave:'aaa111', refresco:true});
check('refresh returns the panel but is not logged in Métricas', rf.ok && sheets['Métricas'].length === nMet);
const met = sheets['Métricas'];
check('Métricas: only successful logins appended (5)', met.length - 1 === 5);
check('Métricas row shape (6 values, evento login, no timing)', JSON.stringify(met[1].slice(1)) === JSON.stringify(['11111','ASE,REL',true,true,'login']) && met.find(r=>r[1]==='11111' && r[3]===false));

// Usage events: same clave check and throttle as a login, one Métricas row, no panel
const nEv = met.length;
const ev1 = post({rbd:'11111', clave:'aaa111', evento:'test_whatsapp', programa:'ase'});
check('evento: ok, no panel, one row', ev1.ok === true && !ev1.programas && met.length === nEv + 1 && JSON.stringify(met[nEv].slice(1)) === JSON.stringify(['11111','ASE','','','test_whatsapp']));
const ev2 = post({rbd:'11111', clave:'aaa111', evento:'ver_efa'});
check('evento without programa: blank programa', ev2.ok && met[nEv + 1][2] === '' && met[nEv + 1][5] === 'ver_efa');
check('evento not in the list / bad programa / empty: rejected, no row', post({rbd:'11111', clave:'aaa111', evento:'=HYPERLINK("x")'}).error === 'evento'
  && post({rbd:'11111', clave:'aaa111', evento:'test_qr', programa:'xyz'}).error === 'evento'
  && post({rbd:'11111', clave:'aaa111', evento:''}).error === 'evento' && met.length === nEv + 2);
check('evento with wrong clave: credenciales, counts as an attempt, no row', post({rbd:'33333', clave:'nope', evento:'ver_efa'}).error === 'credenciales' && cacheStore['intentos_33333'] && met.length === nEv + 2);
check('evento blocked like a login', (() => { [...Array(8)].forEach(() => post({rbd:'33333', clave:'nope'})); return post({rbd:'33333', clave:'ccc333', evento:'ver_efa'}).error === 'bloqueado'; })());
delete cacheStore['intentos_33333'];
check('evento + refresco: still only the event row', post({rbd:'11111', clave:'aaa111', evento:'efa_qr', programa:'rel', refresco:true}).ok && met.length === nEv + 3);
check('response carries no timing', !('ms' in r));
// Internal team view: "<RBD>trabun" + the school's clave
const nInt = met.length;
const ri = post({rbd:' 11111 Trabun ', clave:'aaa111'});
check('internal view: "<RBD>trabun" (case/spaces/"-" ignored) opens the school panel, marked interno; normal login unmarked',
  ri.ok && ri.interno === true && ri.colegio.rbd === '11111' && post({rbd:'11111-TRABUN', clave:'aaa111', refresco:true}).interno === true && !('interno' in r));
check('internal view: Métricas row "login_interno", events "<evento>_interno", refresh no row', met.length === nInt + 1 && met[nInt][5] === 'login_interno'
  && post({rbd:'11111trabun', clave:'aaa111', evento:'efa_copiar_link', programa:'rel'}).ok && met[nInt + 1][5] === 'efa_copiar_link_interno' && met.length === nInt + 2);
check('internal view: own attempt counter, a teammate\'s typos never lock the school out', (() => {
  [...Array(8)].forEach(() => post({rbd:'11111trabun', clave:'nope'}));
  const bloqueadoInterno = post({rbd:'11111trabun', clave:'aaa111'}).error === 'bloqueado';
  const ok = bloqueadoInterno && post({rbd:'11111', clave:'aaa111'}).ok === true && !cacheStore['intentos_11111'];
  delete cacheStore['intentos_11111_interno']; return ok; })());
check('mistyped suffix ("11111tra", "11111 trabu") refused instead of counting as the school; check digit still accepted', (() => {
  const n = met.length;
  return post({rbd:'11111tra', clave:'aaa111'}).error === 'credenciales' && post({rbd:'11111 trabu', clave:'aaa111'}).error === 'credenciales'
    && met.length === n && post({rbd:'11111-K', clave:'aaa111', refresco:true}).ok === true && post({rbd:'11111-6', clave:'aaa111', refresco:true}).ok === true; })());
check('internal view needs the right clave; other suffixes are not internal', post({rbd:'11111trabun', clave:'zzz'}).error === 'credenciales' && !post({rbd:'11111equipo', clave:'aaa111'}).interno);
delete cacheStore['intentos_11111_interno'];
// EDI «Faltan por responder» (Mau 17-11-2026): SF Contactos EFA-EDI (leaders) + SDC (EDI-grade teachers) − who answered
{
  const FARO = 'Puerto Inventado - Escuela El Faro - 22222';
  const cont = (nombre, apellido, rol, email, rut, vigente = true) => [FARO, 'x', 'ASE', 'Intensivo', true, 2025, 'x', nombre, apellido, rol, email, vigente, '[]', rut];
  sheets['Contactos EFA-EDI'] = [['Nombre para formulario', 'Account Name', 'Implementación: Record Type', 'Implementación: Modelo', 'Implementación: EDI',
    'Año inicio ASE', 'Implementación: Nombre de la Implementación', 'First Name', 'Last Name', 'Rol en la Implementacióon', 'Email', 'Vigente 2026', 'Rol en el colegio', 'RUT'],
    cont('Ana María', 'Pérez Soto', 'Director/a', 'ana@ejemplo.cl', '12.345.678-5'),
    cont('Juan', 'Gallegos', 'Mentor/a', '', ''),
    cont('Rosa', 'Castillo Vera', 'Mentor/a y Encargado/a', 'rosa@ejemplo.cl', '11111111-1'),
    cont('Rosa', 'Castillo Vera', 'Mentor/a y Encargado/a', 'rosa@ejemplo.cl', ''),       // repeated SF row: one person
    cont('Felipe', 'Araya', 'Otro', 'felipe@ejemplo.cl', ''),
    cont('Luis', 'Herrera', 'Docente', 'luis@ejemplo.cl', ''),
    cont('Marta', 'Lagos', 'Docente', 'marta@ejemplo.cl', ''),                          // not in an EDI grade: not expected
    cont('Pedro', 'Soto', 'Docente', 'pedro@ejemplo.cl', ''),                           // SDC only outside EDI grades
    cont('Sin', 'Rol', '', 'sinrol@ejemplo.cl', ''),                                    // no SF role: not expected
    cont('Ex', 'Directora', 'Director/a', 'ex@ejemplo.cl', '', false),                  // not vigente
    ['Villa Ficticia - Colegio Los Aromos - 11111', 'x', 'ASE', 'Semi-Intensivo', true, 2025, 'x', 'Otra', 'Escuela', 'Director/a', 'o@ejemplo.cl', true, '[]', ''],
  ];
  sheets['SDC'] = [['RBD', 'Nombre', 'Apellido', 'Correo', 'Nivel', 'Letra', 'Nivel EDI', 'Cohorte'],
    [22222, 'Luis', 'Herrera', 'luis@ejemplo.cl', '5° básico', 'A', true, 1],
    [22222, 'Luis', 'Herrera', 'luis@ejemplo.cl', '6° básico', 'B', true, 1],             // two EDI grades: listed in both, counted once
    [22222, 'Rosa', 'Castillo', 'rosa@ejemplo.cl', '5° básico', 'B', true, 1],            // a leader who teaches stays a leader
    [22222, 'Ana', 'Rojas', 'arojas@ejemplo.cl', '7° básico', 'B', true, 1],              // not in SF; answered without consent
    [22222, 'Carla', 'Núñez', 'carla@ejemplo.cl', '7° básico', 'C', true, 1],             // not in SF, no answer
    [22222, 'Tomás', 'Díaz', 'tomas@ejemplo.cl', '8° básico', 'A', true, 1],              // answered (email)
    [22222, 'Pedro', 'Soto', 'pedro@ejemplo.cl', '3° básico', 'A', false, 1],
  ];
  const n0 = sheets['Respuestas EFA'].length;
  const resp = (nombre, apellido, correo, rol, run) => ['EFA_EDI', '2026-11-05T10:00:00', nombre, apellido, correo, FARO, rol, '-', run];
  sheets['Respuestas EFA'][0] = sheets['Respuestas EFA'][0].concat(['RUN']);
  sheets['Respuestas EFA'].push(
    resp('Ana', 'Pérez Soto', 'otra@ejemplo.cl', 'Director/a del establecimiento', '12345678-0'),     // RUT with another check digit
    resp('Juan', 'Galleogs Martínez', 'jg@otro.cl', 'Soy Mentor/a del programa', ''),               // surname typo, extra surname
    resp('Tomás', 'Díaz Lagos', 'tomas@ejemplo.cl', 'Soy Docente e implemento el Programa', '22222222-2'),
    resp('Ana', 'Rojas', 'ar@otro.cl', '-', '33333333-3'),                                          // no consent: still answered
    resp('Rosa', 'Castillo', 'rc@otro.cl', 'Soy Mentor/a del programa', '99999999-9'));             // same name, RUT says otherwise
  const reloj = { hoy: '2026-11-05', generado: 'x' };
  const d = ctx.cargarDatos_();
  const e = ctx.panel_('22222', d, reloj).programas[0].efa;
  const p = e.pendientes || {};
  check('EDI pendientes: leaders from SF (repeated rows once, role label, org-chart order), RUT/name typos and no-consent count as answered',
    p.total === 4 && JSON.stringify(p.lideres) === JSON.stringify([{ nombre: 'Rosa Castillo Vera', rol: 'Encargado/a y Mentor/a' }, { nombre: 'Felipe Araya', rol: 'Otro/a líder' }]));
  check('EDI pendientes: teachers only in EDI grades (SDC), by grade with their letters, one teacher in two grades counted once',
    JSON.stringify(p.docentes) === JSON.stringify([
      { nivel: '5° básico', personas: [{ nombre: 'Luis Herrera', letras: ['A'] }] },
      { nivel: '6° básico', personas: [{ nombre: 'Luis Herrera', letras: ['B'] }] },
      { nivel: '7° básico', personas: [{ nombre: 'Carla Núñez', letras: ['C'] }] }]));
  check('EDI pendientes: who answered is unchanged (5 responses listed)', e.total === 5);
  check('no role ("-") → own section «sinrol» before Docentes, no label; Líderes no longer holds it; Σ sections = total', (() => {
    const ids = e.secciones.map(s => s.id), sr = e.secciones[2], li = e.secciones[1];
    return ids.join() === 'direccion,lideres,sinrol,docentes' && sr.r === 1
      && JSON.stringify(sr.personas) === JSON.stringify([{ nombre: 'Ana Rojas', rol: null }])
      && li.personas.every(x => x.nombre !== 'Ana Rojas') && e.secciones.reduce((a, s) => a + s.r, 0) === e.total; })());
  check('no «sinrol» section when everyone declared a role', ctx.panel_('11111', d, reloj).programas.every(x => x.efa.secciones.every(s => s.id !== 'sinrol')));
  check('EDI pendientes: no emails or RUTs in the payload', !/@ejemplo|@otro|12345678|11111111/.test(JSON.stringify(e.pendientes)));
  check('EDI pendientes: only while open or extra week; never for non-EDI programs; no block without Contactos EFA-EDI', (() => {
    const cerrado = ctx.panel_('22222', d, { hoy: '2026-11-25', generado: 'x' }).programas[0].efa;
    const extra = ctx.panel_('22222', Object.assign({}, d, { cfg: Object.assign({}, d.cfg, { efa_extension: '20-11-2026' }) }), { hoy: '2026-11-17', generado: 'x' }).programas[0].efa;
    const aromos = ctx.panel_('11111', d, reloj).programas;
    const sinTab = ctx.panel_('22222', Object.assign({}, d, { contactosEdi: null }), reloj).programas[0].efa;
    return !('pendientes' in cerrado) && extra.pendientes.total === 4 && aromos.every(x => !('pendientes' in x.efa)) && !('pendientes' in sinTab); })());
  check('efa_edi_extension «abierta»: treated EDI gets its own EFA window (extra, no end) with pendientes; everyone else as before', (() => {
    const cfg = Object.assign({}, d.cfg, { efa_edi_extension: 'Abierta ' });
    const r22 = ctx.panel_('22222', Object.assign({}, d, { cfg }), { hoy: '2026-11-25', generado: 'x' });
    const r11 = ctx.panel_('11111', Object.assign({}, d, { cfg }), { hoy: '2026-11-25', generado: 'x' });
    const e = r22.programas[0].efa, v = e.ventana;
    return r22.encuestas.efa.fase === 'closed' && v.fase === 'extra' && v.sinCierre === true && v.diasRestantes === null && !('extension' in v)
      && e.pendientes.total === 4 && e.secciones.some(s => (s.personas || []).length) && r22.encuestas.test.fase === 'closed'
      && r11.programas.every(x => !('ventana' in x.efa) && !('pendientes' in x.efa)); })());
  check('efa_edi_extension as a date: EDI extra until then, then closed; blank = like everyone; before cierra it is just open', (() => {
    const cfg = Object.assign({}, d.cfg, { efa_edi_extension: '30-11-2026' });
    const en = ctx.panel_('22222', Object.assign({}, d, { cfg }), { hoy: '2026-11-25', generado: 'x' }).programas[0].efa.ventana;
    const tras = ctx.panel_('22222', Object.assign({}, d, { cfg }), { hoy: '2026-12-01', generado: 'x' }).programas[0].efa;
    const vacio = ctx.panel_('22222', Object.assign({}, d, { cfg: Object.assign({}, d.cfg, { efa_edi_extension: '  ' }) }), reloj).programas[0].efa;
    const antes = ctx.ventana_('02-11-2026', '13-11-2026', '2026-11-05', 'abierta');
    return en.fase === 'extra' && en.extension === '2026-11-30' && en.diasRestantes === 5 && tras.ventana.fase === 'closed'
      && !('pendientes' in tras) && !('ventana' in vacio) && antes.fase === 'open' && antes.diasRestantes === 8; })());
  check('EDI pendientes: everyone answered → total 0 (the portal thanks them)', (() => {
    const todos = ctx.pendientesEdi_('22222', { programa: 'ase' }, { contactosEdi: d.contactosEdi.filter(x => x.roles.indexOf('director') >= 0), sdc: [] },
      d.efa.filter(x => x.rbd === '22222'));
    return todos.total === 0 && todos.lideres.length === 0 && todos.docentes.length === 0; })());
  check('RUT matching: same, another check digit, one digit more or less; different people not', ctx.rutParecido_('123456785', '123456780')
    && ctx.rutParecido_('17445659K', '174456590K') && ctx.rutParecido_('161221244', '1612212444') && !ctx.rutParecido_('123456785', '123456795')
    && !ctx.rutParecido_('', '') && ctx.rutNorm_('12.345.678-k') === '12345678K' && ctx.rutNorm_('-') === '');
  check('name words: one typo or swap in long words only', ctx.palabraParecida_('gallegos', 'galleogs') && ctx.palabraParecida_('munoz', 'munos')
    && !ctx.palabraParecida_('ana', 'ani') && !ctx.palabraParecida_('perez', 'gomez') && !ctx.palabraParecida_('soto', 'sota'));
  sheets['Respuestas EFA'].length = n0;
  sheets['Respuestas EFA'][0] = sheets['Respuestas EFA'][0].slice(0, -1);
  delete sheets['Contactos EFA-EDI']; delete sheets['SDC'];
}

const pp = ctx.probarPanel(); console.log('--- probarPanel() ---\n' + pp);
check('probarPanel logs counts, no names or emails', !/Martina|Rojas|@ejemplo/.test(pp) && /RBD 11111/.test(pp));
check('no clave in logs', !logs.join('\n').match(/aaa111|bbb222|ddd444/));

console.log('\n--- revisarFormularios() ---\n' + ctx.revisarFormularios());
console.log('\n--- logs ---\n' + logs.filter(l=>!l.startsWith('Revisión')).join('\n'));
console.log('\npayload size (11111, nombre mode):', JSON.stringify(r).length, 'bytes');
