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
    ['efa','EFA_EDI','ASE','SÍ','','','','','https://s.example/efa-edi'],
    ['efa','REL Consolidado','REL','','','Consolidado','','','https://s.example/efa-rel-c'],
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
check('phases computed (Config dates as Date and dd-mm-yyyy)', r.encuestas.test.abre === '2026-10-01' && r.encuestas.efa.abre === '2026-11-02' && r.encuestas.efa.fase !== null);
const ase = r.programas.find(p=>p.programa==='ase'), rel = r.programas.find(p=>p.programa==='rel');
check('ASE test grades from Formularios ∩ implemented', JSON.stringify(ase.test.nivelesTest) === JSON.stringify(['4° básico','5° básico','6° básico','7° básico','8° básico','I° medio','II° medio','III° medio','IV° medio']));
check('ASE test links (2, non-EDI)', ase.test.links.map(l=>l.form).join() === 'ASE_4-5,ASE_6-IV');
check('Test links carry the school (SurveyMonkey custom variables, as in the links file)', ase.test.links[0].link === 'https://f.example/ase45?RBD=11111&colegio=Colegio%20Los%20Aromos%2C%20Villa%20Ficticia');
check('EFA links unchanged (no RBD added)', ase.efa.links[0].link === 'https://s.example/efa-ase-si');
check('link that already has RBD or a query: kept / appended with &', ctx.linkColegio_('https://x.example/r/A?RBD=5', '11111', null) === 'https://x.example/r/A?RBD=5'
  && ctx.linkColegio_('https://x.example/r/A?lang=es', '11111', { nombre: 'Escuela  Uno', comuna: 'Ñuble' }) === 'https://x.example/r/A?lang=es&RBD=11111&colegio=Escuela%20Uno%2C%20%C3%91uble');
const lv = n => ase.test.niveles.find(x=>x.nivel===n);
check('registered grades = 4°..8° then outside IV° medio last', ase.test.niveles.map(n=>n.nivel+(n.registrado?'':'*')).join('|') === '4° básico|5° básico|6° básico|7° básico|8° básico|IV° medio*');
check('4° básico r=4, est=60, letters A,B + C unregistered', lv('4° básico').r === 4 && lv('4° básico').est === 60 && lv('4° básico').cursos.map(c=>c.letra+(c.registrado?'':'*')).join() === 'A,B,C*');
check('sort by apellido, accent-insensitive', lv('4° básico').cursos[0].respuestas.map(x=>x.apellidos).join() === 'bravo,Rojas Díaz');
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
check('REL docentes flat list', Array.isArray(rel.efa.secciones[2].personas) && !rel.efa.secciones[2].niveles);
check('no emails anywhere in payload', !JSON.stringify(r).includes('@ejemplo.cl'));

sheets['Config'][5][1] = 'numero';
const rn = post({rbd:'11111', clave:'aaa111'});
const c4 = rn.programas[0].test.niveles[0].cursos;
check('numero mode: no names, numbers sorted, tope = max(highest, round(60/2)=30)', !JSON.stringify(rn).includes('Martina') && JSON.stringify(c4[0]) === JSON.stringify({letra:'A',registrado:true,r:2,tope:30,numeros:[3,12],sinNumero:0}));
check('numero mode: unregistered class tope = highest answered', c4[2].tope === 35);
check('numero mode: bad number → sinNumero', rn.programas[0].test.niveles.find(n=>n.nivel==='6° básico').cursos[1].sinNumero === 1);
sheets['Config'][5][1] = '';

const re = post({rbd:'22222', clave:'bbb222'});
check('blocked RBD still blocked', re.error === 'bloqueado');
delete cacheStore['intentos_22222'];
const re2 = post({rbd:'22222', clave:'bbb222'});
check('EDI cohort 2025: contacto EDI, test grades 4° + I°–IV°, link only where filled', re2.contacto === 'consultas_edi@fundaciontrabun.cl' && re2.programas[0].test.nivelesTest.join() === '4° básico,I° medio,II° medio,III° medio,IV° medio' && re2.programas[0].test.links.map(l=>l.form).join() === 'ASE_EDI_4');
check('EDI: only EFA_EDI form', re2.programas[0].efa.links.map(l=>l.form).join() === 'EFA_EDI');
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
const pp = ctx.probarPanel(); console.log('--- probarPanel() ---\n' + pp);
check('probarPanel logs counts, no names or emails', !/Martina|Rojas|@ejemplo/.test(pp) && /RBD 11111/.test(pp));
check('no clave in logs', !logs.join('\n').match(/aaa111|bbb222|ddd444/));

console.log('\n--- revisarFormularios() ---\n' + ctx.revisarFormularios());
console.log('\n--- logs ---\n' + logs.filter(l=>!l.startsWith('Revisión')).join('\n'));
console.log('\npayload size (11111, nombre mode):', JSON.stringify(r).length, 'bytes');
