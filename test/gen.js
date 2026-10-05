// Tests generarDatosPrueba() on top of the run.js mocks. Run from the repo root: node test/gen.js
const base = require('fs').readFileSync(require('path').join(__dirname, 'run.js'), 'utf8').split("const post =")[0];
eval(base + `
// more fictional schools to cover every generator case
sheets['SF'].splice(5, 0,
  sfRow(55555, 'Llano Ficticio - Colegio Santa Inventada - 55555', 'Religión', 'Intensivo', false, '', 2022, range(10,13,[35,1])),
  sfRow(66666, 'Bahía Falsa - Escuela Nueva Era - 66666', 'ASE', 'Semi-Intensivo', true, 2026, '', range(9,13,[45,2])),
  sfRow(77777, 'Valle Imaginario - Jardín Las Nubes - 77777', 'ASE', 'Semi-Intensivo', false, 2025, '', range(0,1,[30,1])),
  sfRow(88888, 'Monte Ficticio - Colegio Del Sol - 88888', 'ASE', 'Intensivo', false, 2024, '', range(5,9,[50,2])));
sheets['Contraseñas'].push([55555,'eee555'],[66666,'fff666'],[77777,'ggg777'],[88888,'hhh888']);
sheets['Respuestas Test'] = [sheets['Respuestas Test'][0]];
sheets['Respuestas EFA'] = [sheets['Respuestas EFA'][0]];
const fmtOld = ctx.Utilities.formatDate;
ctx.Utilities.formatDate = (d, tz, f) => f.indexOf("'T'HH:mm:ss") > 0 && f.indexOf('XXX') < 0 ? fmtOld(d, tz, 'x').slice(0, 19) : fmtOld(d, tz, f);
const mkSheet = name => ({
  getName: () => name,
  getLastRow: () => sheets[name].length,
  getDataRange: () => ({ getValues: () => sheets[name].map(r => r.slice()) }),
  getRange: (r, c, nr, nc) => ({ setValues: vals => { vals.forEach((row, i) => { if (row.length !== nc) throw new Error('width ' + row.length + ' != ' + nc); sheets[name][r - 1 + i] = row; }); } }),
  appendRow: row => sheets[name].push(row),
});
ctx.SpreadsheetApp.getActiveSpreadsheet = () => ({ getSheetByName: n => sheets[n] ? mkSheet(n) : null });
const post = body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).s);
const check = (label, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) process.exitCode = 1; };

const informe = ctx.generarDatosPrueba();
console.log(informe);
const t = sheets['Respuestas Test'], e = sheets['Respuestas EFA'];
check('every case found a school', !informe.includes('sin colegio'));
check('Control school never chosen', !informe.includes('33333'));
check('test rows: one Colegio per row, full width', t.slice(1).every(r => r.length === 23 && r.slice(7).filter(Boolean).length === 1));
check('EFA emails all @ejemplo.invalid', e.slice(1).every(r => /@ejemplo\\.invalid$/.test(r[4])));
let err = ''; try { ctx.generarDatosPrueba(); } catch (x) { err = x.message; }
check('second run refused', /ya tiene filas/.test(err));
const claves = {11111:'aaa111',22222:'bbb222',55555:'eee555',66666:'fff666',77777:'ggg777',88888:'hhh888'};
Object.keys(claves).forEach(rbd => {
  if (!informe.includes('RBD ' + rbd)) return;
  const r = post({ rbd, clave: claves[rbd] });
  const s = r.programas.map(p => p.programa + ': test r=' + p.test.resumen.r + ' (' + p.test.niveles.map(n => n.nivel + (n.registrado ? '' : '*') + '=' + n.r).join(', ') + ') · efa total=' + p.efa.total + ' [' + p.efa.secciones.map(x => x.id + '=' + x.r).join(' ') + ']').join('\\n    ');
  console.log('  ' + rbd + ' ok=' + r.ok + '\\n    ' + s);
  check(rbd + ' login ok and has responses', r.ok && r.programas.every(p => p.test.resumen.r > 0 && p.efa.total > 0));
});
console.log(ctx.revisarFormularios());
`);
