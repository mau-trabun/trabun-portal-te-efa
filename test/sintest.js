// Tests listarSinTest() and the Habilitar flag on top of the run.js mocks (fictional schools). Run from the repo root: node test/sintest.js
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
  getRange: (r, c, nr, nc) => {
    const rg = {
      setValues: vals => { vals.forEach((row, i) => { if (row.length !== nc) throw new Error('width'); const fila = sheets[name][r - 1 + i] || (sheets[name][r - 1 + i] = []); row.forEach((v, j) => { fila[c - 1 + j] = v; }); }); return rg; },
      clearContent: () => { for (let i = 0; i < nr; i++) { const fila = sheets[name][r - 1 + i]; if (fila) for (let j = 0; j < nc; j++) fila[c - 1 + j] = ''; } return rg; },
      clearDataValidations: () => { for (let i = 0; i < nr; i++) delete checks[name + (r + i)]; return rg; },
      insertCheckboxes: () => { for (let i = 0; i < nr; i++) { checks[name + (r + i)] = true; const fila = sheets[name][r - 1 + i] || (sheets[name][r - 1 + i] = []); fila[c - 1] = false; } return rg; },
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

// Two fictional schools with no online Test grade: REL only NT1–3° básico; ASE EDI 2026 only 4°–7° básico (paper grades)
sheets['SF'].splice(sheets['SF'].length - 1, 0,
  sfRow(55555, 'Valle Inventado - Escuela Las Nalcas - 55555', 'Religión', 'Intensivo', false, '', 2024, range(0,4,[20,1])),
  sfRow(66666, 'Bahía Ficticia - Colegio  El Muelle - 66666', 'ASE', 'Intensivo', true, 2026, '', range(5,8,[30,1])));

check('no Sin Test tab: login data loads, nobody habilitado', JSON.stringify(ctx.cargarDatos_().habilitados) === '{}' && !logs.some(l => l.startsWith('ERROR Sin Test')));

const informe = ctx.listarSinTest();
const t = sheets['Sin Test'];
check('tab created with the contract header', t[0].join('|') === 'RBD|Colegio|Comuna|Programa|Modelo|EDI|Año inicio|Jefe/a de Proyecto|Niveles del colegio|Test en papel|Habilitar');
check('only the 2 school-programs with no online Test grade (others have one)', lastRow('Sin Test') === 3 && t.slice(1, 3).map(r => r[0] + r[3]).join() === '66666ASE,55555REL' && /2 colegio-programa/.test(informe));
check('ASE EDI row: grades as ranges, paper grades, EDI SÍ, año inicio', JSON.stringify(t[1].slice(1, 11)) === JSON.stringify(['Colegio  El Muelle', 'Bahía Ficticia', 'ASE', 'Intensivo', 'SÍ', 2026, 'x', '4° básico a 7° básico', '4° básico a 7° básico', false]));
check('REL row: NT1 a 3° básico, no paper grades', t[2][8] === 'NT1 a 3° básico' && t[2][9] === '' && t[2][5] === 'NO');
check('Habilitar is a checkbox, unticked', checks['Sin Test2'] && checks['Sin Test3'] && t[1][10] === false && t[2][10] === false);

// Mau ticks one and adds his own column; SF changes and the list is rebuilt
t[1][10] = true; t[0][11] = 'Correo enviado'; t[1][11] = '08-10'; t[2][11] = '';
let d = ctx.cargarDatos_();
check('ticked row read as habilitado', d.habilitados['66666|ase'] === true && !d.habilitados['55555|rel']);
const p66 = ctx.panel_('66666', d, ctx.reloj_()).programas[0];
const p55 = ctx.panel_('55555', d, ctx.reloj_()).programas[0];
check('payload: test.habilitado only for the ticked school-program', p66.test.habilitado === true && p55.test.habilitado === false && ctx.panel_('11111', d, ctx.reloj_()).programas.every(p => p.test.habilitado === false));
sheets['SF'] = sheets['SF'].filter(r => r[0] !== 55555); // 55555 leaves SF
ctx.listarSinTest();
check('rebuild keeps Habilitar and extra columns per RBD + Programa, drops rows gone from SF, clears the rest', lastRow('Sin Test') === 2
  && sheets['Sin Test'][0][11] === 'Correo enviado' && sheets['Sin Test'][1][0] === '66666' && sheets['Sin Test'][1][10] === true && sheets['Sin Test'][1][11] === '08-10'
  && (sheets['Sin Test'][2] || []).every(v => v === '' || v == null) && !checks['Sin Test3']);
check('Habilitar typed as text also counts (SÍ / TRUE)', (() => { sheets['Sin Test'][1][10] = 'SÍ'; return ctx.cargarDatos_().habilitados['66666|ase'] === true; })());
check('tramos_: consecutive runs and singles', ctx.tramos_([13, 0, 1, 2, 7]) === 'NT1 a 1° básico, 6° básico, IV° medio' && ctx.tramos_([]) === '');
`);
