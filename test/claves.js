// Tests generarClavesNuevas() on top of the run.js mocks (fictional claves). Run from the repo root: node test/claves.js
const base = require('fs').readFileSync(require('path').join(__dirname, 'run.js'), 'utf8').split("const post =")[0];
eval(base + `
const check = (label, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) process.exitCode = 1; };
ctx.Utilities.getUuid = () => require('crypto').randomUUID();
const formatos = {};
const mkSheet = name => ({
  getLastRow: () => (sheets[name] || []).length,
  getDataRange: () => ({ getValues: () => sheets[name].map(r => r.slice()) }),
  getRange: (r, c, nr, nc) => ({
    setNumberFormat: f => { formatos[name] = f; },
    setValues: vals => { vals.forEach((row, i) => { if (row.length !== nc) throw new Error('width'); sheets[name][r - 1 + i] = row; }); },
  }),
});
ctx.SpreadsheetApp.getActiveSpreadsheet = () => ({
  getSheetByName: n => sheets[n] ? mkSheet(n) : null,
  insertSheet: n => { sheets[n] = []; return mkSheet(n); },
  getNumSheets: () => Object.keys(sheets).length,
});
sheets['Contraseñas'].push(['55555.0', 'zzz999'], [11111, 'dup000']); // normalized RBD; repeated RBD listed once
const antes = JSON.stringify(sheets['Contraseñas']);
logs.length = 0;
const informe = ctx.generarClavesNuevas();
const filas = sheets['Claves 2026'];
const claves = filas.slice(1).map(r => r[1]);
check('header + one row per distinct RBD (5)', filas[0].join() === 'rbd,clave' && filas.length === 6 && filas.slice(1).map(r => r[0]).join() === '11111,22222,33333,44444,55555');
check('6 chars from the alphabet (no 0/o/1/l/e), at least one letter and one digit', claves.every(c => /^[abcdfghijkmnpqrstuvwxyz23456789]{6}$/.test(c) && /[a-z]/.test(c) && /[0-9]/.test(c)));
check('all distinct and none equal to a current clave', new Set(claves).size === claves.length && claves.every(c => !antes.includes('"' + c + '"')));
check('written as plain text', formatos['Claves 2026'] === '@');
check('Contraseñas untouched', JSON.stringify(sheets['Contraseñas']) === antes);
check('no clave in logs or in the returned report', !claves.some(c => logs.join('\\n').includes(c) || informe.includes(c)));
let error = '';
try { ctx.generarClavesNuevas(); } catch (e) { error = e.message; }
check('refuses to run twice', /ya tiene filas/.test(error) && sheets['Claves 2026'].length === 6);
const muestra = Array.from({ length: 3000 }, () => ctx.claveAleatoria_()).join('');
const cuenta = {}; for (const ch of muestra) cuenta[ch] = (cuenta[ch] || 0) + 1;
// "≥1 letter and ≥1 digit" makes digits more frequent than letters by design, so check each group on its own
const parejo = chars => { const v = chars.split('').map(ch => cuenta[ch] || 0), m = v.reduce((a, x) => a + x, 0) / v.length; return v.every(x => Math.abs(x - m) < m * 0.25); };
check('every character used; letters even among letters, digits among digits (3.000 claves)', Object.keys(cuenta).length === 31 && parejo('abcdfghijkmnpqrstuvwxyz') && parejo('23456789'));
`);
