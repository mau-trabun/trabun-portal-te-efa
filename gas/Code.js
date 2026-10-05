/**
 * Portal de Seguimiento 2026 · Fundación Trabün
 * Backend bound to the 2026 Sheet. Data contract: CONTRACT.md in the repo.
 *
 * Never log the request body, e.parameter or the clave.
 */

const TABS = {
  sf: 'SF',
  claves: 'Contraseñas',
  config: 'Config',
  formularios: 'Formularios',
  metricas: 'Métricas',
  respTest: 'Respuestas Test',
  respEfa: 'Respuestas EFA',
};

const TZ = 'America/Santiago';
const API_VERSION = 1;
const MAX_INTENTOS = 8;
const VENTANA_BLOQUEO_S = 900;
const CONTACTO_DEFECTO = 'evaluacion@fundaciontrabun.cl';

const NIVELES = ['NT1', 'NT2', '1° básico', '2° básico', '3° básico', '4° básico', '5° básico', '6° básico',
  '7° básico', '8° básico', 'I° medio', 'II° medio', 'III° medio', 'IV° medio'];
const SF_SUFIJOS = ['NT1', 'NT2', '1º', '2º', '3º', '4º', '5º', '6º', '7º', '8º', 'I', 'II', 'III', 'IV'];
const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const SECCIONES = ['direccion', 'lideres', 'docentes'];
// EDI (RCT): these grades take the Test on paper, run by Agencia Focus, by cohort (Año inicio ASE). Fixed by design.
// Shown as fixed rows in Estudiantes (no data); intersected with the grades the school implements.
const PAPEL_EDI = {
  2025: ['5° básico', '6° básico', '7° básico', '8° básico'],
  2026: ['4° básico', '5° básico', '6° básico', '7° básico'],
};

// ── HTTP ────────────────────────────────────────────────────

function doGet() {
  return json_({ ok: true, v: API_VERSION });
}

function doPost(e) {
  let res;
  try {
    res = login_(e);
  } catch (err) {
    console.error('doPost: ' + (err && err.message));
    res = { ok: false, error: 'servidor' };
  }
  return json_(res);
}

function login_(e) {
  const t0 = Date.now();
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (_) { /* malformed → credenciales */ }
  const rbd = normRbd_(body.rbd);
  const clave = String(body.clave == null ? '' : body.clave).trim();
  if (!rbd || !clave) return { ok: false, error: 'credenciales' };

  // Throttle counts attempts for any RBD, existing or not, so it can't be used to enumerate.
  const cache = CacheService.getScriptCache();
  const kIntentos = 'intentos_' + rbd;
  const intentos = Number(cache.get(kIntentos)) || 0;
  if (intentos >= MAX_INTENTOS) return { ok: false, error: 'bloqueado' };

  const guardada = claveDe_(rbd);
  if (guardada === null || guardada !== clave) {
    cache.put(kIntentos, String(intentos + 1), VENTANA_BLOQUEO_S);
    return { ok: false, error: 'credenciales' };
  }
  cache.remove(kIntentos);

  const datos = cargarDatos_();
  const tDatos = Date.now() - t0;
  const res = panel_(rbd, datos, reloj_());
  res.ms = Date.now() - t0; // server time only; the browser also waits for Google's startup and redirect
  console.log(`login ok · datos ${tDatos} ms · total ${res.ms} ms`); // no RBD, clave or names in logs
  if (body.refresco !== true) registrarMetrica_(res); // auto/manual refreshes are not new logins
  return res;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function reloj_() {
  const now = new Date();
  return {
    hoy: Utilities.formatDate(now, TZ, 'yyyy-MM-dd'),
    generado: Utilities.formatDate(now, TZ, "yyyy-MM-dd'T'HH:mm:ssXXX"),
  };
}

// ── Data loading ────────────────────────────────────────────
// Login depends only on Contraseñas + SF. Every other source degrades on failure.

function cargarDatos_() {
  const formularios = intentar_(TABS.formularios, leerFormularios_, []);
  return {
    sf: leerSF_(),
    cfg: intentar_(TABS.config, leerConfig_, {}),
    formularios,
    test: intentar_(TABS.respTest, () => leerRespuestasTest_(formularios), null),
    efa: intentar_(TABS.respEfa, () => leerRespuestasEfa_(formularios), null),
  };
}

function intentar_(nombre, fn, porDefecto) {
  try {
    return fn();
  } catch (err) {
    console.error(nombre + ': ' + (err && err.message));
    return porDefecto;
  }
}

function leerTabla_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('falta la pestaña');
  const values = sh.getDataRange().getValues();
  const headers = (values.shift() || []).map(h => String(h).trim());
  return { headers, rows: values };
}

function colExacta_(t, name) {
  const i = t.headers.indexOf(name);
  if (i < 0) throw new Error('falta el encabezado ' + name);
  return i;
}

function colsPrefijo_(t, prefix, requerida) {
  const p = normTexto_(prefix);
  const cols = t.headers.map((h, i) => (normTexto_(h).startsWith(p) ? i : -1)).filter(i => i >= 0);
  if (requerida && !cols.length) throw new Error('falta el encabezado ' + prefix);
  return cols;
}

// First non-empty value among columns sharing a prefix (e.g. one Colegio column per region).
function primero_(row, cols) {
  for (const c of cols) {
    const v = row[c];
    if (v !== '' && v != null) return v;
  }
  return '';
}

function claveDe_(rbd) {
  const t = leerTabla_(TABS.claves);
  const cRbd = colExacta_(t, 'rbd');
  const cClave = colExacta_(t, 'clave');
  for (const row of t.rows) {
    if (normRbd_(row[cRbd]) === rbd) return String(row[cClave]).trim();
  }
  return null;
}

function leerSF_() {
  const t = leerTabla_(TABS.sf);
  const c = {
    rbd: colExacta_(t, 'ID RBD'),
    nombre: colExacta_(t, 'Nombre para formulario'),
    tipo: colExacta_(t, 'Implementación: Record Type'),
    modelo: colExacta_(t, 'Modelo'),
    edi: colExacta_(t, 'EDI'),
    anioAse: colExacta_(t, 'Año inicio ASE'),
    anioRel: colExacta_(t, 'Año inicio Religión'),
    jefe: t.headers.indexOf('Jefe de Proyecto'),   // optional: pills only
    coord: t.headers.indexOf('Coordinador'),
    alumnos: SF_SUFIJOS.map(s => colExacta_(t, 'Alumnos ' + s)),
    cxn: SF_SUFIJOS.map(s => colExacta_(t, 'CxN ' + s)),
  };
  const colegios = {};
  t.rows.forEach(row => {
    const rbd = normRbd_(row[c.rbd]);
    if (!rbd) return;
    const partes = String(row[c.nombre]).split(' - ');
    const col = colegios[rbd] || (colegios[rbd] = {
      rbd,
      nombre: partes.length >= 3 ? partes.slice(1, -1).join(' - ').trim() : null,
      comuna: partes.length >= 3 ? partes[0].trim() : null,
      programas: {},
    });
    const programa = programa_(row[c.tipo]);
    if ((programa !== 'ase' && programa !== 'rel') || col.programas[programa]) return; // first row wins
    const alumnos = c.alumnos.map(i => entero_(row[i]));
    const cxn = c.cxn.map(i => entero_(row[i]));
    col.programas[programa] = {
      programa,
      modelo: String(row[c.modelo] || '').trim(),
      jefeProyecto: c.jefe >= 0 ? limpio_(row[c.jefe]) : null,
      coordinador: c.coord >= 0 ? limpio_(row[c.coord]) : null,
      edi: esVerdadero_(row[c.edi]),
      anioInicio: entero_(row[programa === 'ase' ? c.anioAse : c.anioRel]) || null,
      alumnos,
      cxn,
      implementados: NIVELES.map((_, i) => i).filter(i => alumnos[i] > 0 || cxn[i] > 0),
    };
  });
  return colegios;
}

function leerConfig_() {
  const t = leerTabla_(TABS.config);
  const cK = colExacta_(t, 'clave');
  const cV = colExacta_(t, 'valor');
  const cfg = {};
  t.rows.forEach(r => {
    const k = String(r[cK]).trim();
    if (k) cfg[k] = r[cV];
  });
  return cfg;
}

function leerFormularios_() {
  const t = leerTabla_(TABS.formularios);
  const c = {};
  ['Encuesta', 'Form', 'Programa', 'EDI', 'Año inicio', 'Modelo', 'Desde', 'Hasta', 'Link']
    .forEach(h => { c[h] = colExacta_(t, h); });
  return t.rows
    .map((r, i) => ({
      fila: i + 2,
      encuesta: normTexto_(r[c.Encuesta]),
      form: String(r[c.Form]).trim(),
      programa: programa_(r[c.Programa]),
      edi: normTexto_(r[c.EDI]),
      anio: entero_(r[c['Año inicio']]) || null,
      modelo: normTexto_(r[c.Modelo]),
      desde: String(r[c.Desde]).trim(),
      hasta: String(r[c.Hasta]).trim(),
      link: String(r[c.Link]).trim(),
    }))
    .filter(f => f.encuesta);
}

function leerRespuestasTest_(formularios) {
  const programaDe = programaPorForm_(formularios);
  const t = leerTabla_(TABS.respTest);
  const c = {
    form: colsPrefijo_(t, 'Form', true),
    nombres: colsPrefijo_(t, 'Nombres'),
    apellidos: colsPrefijo_(t, 'Apellidos'),
    numero: colsPrefijo_(t, 'Número de lista'),
    nivel: colsPrefijo_(t, 'Nivel', true),
    letra: colsPrefijo_(t, 'Letra'),
    colegio: colsPrefijo_(t, 'Colegio', true),
  };
  return t.rows
    .map(r => ({
      rbd: rbdDeColegio_(primero_(r, c.colegio)),
      programa: programaDe(primero_(r, c.form)),
      nivel: nivelIdx_(primero_(r, c.nivel)),
      letra: letra_(primero_(r, c.letra)),
      nombres: limpio_(primero_(r, c.nombres)),
      apellidos: limpio_(primero_(r, c.apellidos)),
      numero: numero_(primero_(r, c.numero)),
    }))
    .filter(x => x.rbd && x.nivel >= 0); // grade is mandatory; an unmatched grade can't be placed
}

function leerRespuestasEfa_(formularios) {
  const programaDe = programaPorForm_(formularios);
  const t = leerTabla_(TABS.respEfa);
  const c = {
    form: colsPrefijo_(t, 'Form', true),
    fecha: colsPrefijo_(t, 'Fecha'),
    nombre: colsPrefijo_(t, 'Nombre'),
    apellido: colsPrefijo_(t, 'Apellido'),
    correo: colsPrefijo_(t, 'Correo'),
    colegio: colsPrefijo_(t, 'Colegio', true),
    rol: colsPrefijo_(t, 'Rol', true),
    niveles: colsPrefijo_(t, 'Niveles'),
  };
  return t.rows
    .map((r, i) => {
      const rol = limpio_(primero_(r, c.rol));
      return {
        fila: i + 2,
        rbd: rbdDeColegio_(primero_(r, c.colegio)),
        programa: programaDe(primero_(r, c.form)),
        fecha: ms_(primero_(r, c.fecha)),
        correo: String(primero_(r, c.correo)).trim().toLowerCase(),
        nombre: limpio_([primero_(r, c.nombre), primero_(r, c.apellido)].join(' ')),
        rol,
        rolCorto: rol ? rol.split(',')[0].trim() : null,
        seccion: seccionDeRol_(rol),
        niveles: String(primero_(r, c.niveles)).split(',').map(nivelIdx_).filter(n => n >= 0),
      };
    })
    .filter(x => x.rbd);
}

// Response Form label → program, via its Formularios row (so labels like "EFA_EDI" work);
// falls back to the label's first 3 letters (ASE/REL) when the label has no row.
function programaPorForm_(formularios) {
  const mapa = {};
  formularios.forEach(f => {
    if (f.form && (f.programa === 'ase' || f.programa === 'rel')) mapa[normTexto_(f.form)] = f.programa;
  });
  return v => mapa[normTexto_(v)] || programa_(v);
}

// ── Panel (pure: rbd + loaded data → payload) ──────────────

function panel_(rbd, d, reloj) {
  const col = d.sf[rbd] || { rbd, nombre: null, comuna: null, programas: {} };
  const cfg = d.cfg || {};
  const ase = col.programas.ase;
  const studentId = normTexto_(cfg.student_id) === 'numero' ? 'numero' : 'nombre';
  return {
    ok: true,
    v: API_VERSION,
    generado: reloj.generado,
    colegio: { rbd, nombre: col.nombre, comuna: col.comuna },
    contacto: String((ase && ase.edi ? cfg.contacto_edi : cfg.contacto_general) || CONTACTO_DEFECTO).trim(),
    studentId,
    encuestas: {
      test: ventana_(cfg.test_abre, cfg.test_cierra, reloj.hoy),
      efa: ventana_(cfg.efa_abre, cfg.efa_cierra, reloj.hoy),
    },
    programas: ['ase', 'rel'].filter(p => col.programas[p])
      .map(p => panelPrograma_(rbd, col.programas[p], d, studentId)),
  };
}

function panelPrograma_(rbd, p, d, studentId) {
  const formsTest = formulariosDe_(d.formularios, 'test', p);
  const testIdx = [];
  formsTest.forEach(f => rango_(f).forEach(i => { if (testIdx.indexOf(i) < 0) testIdx.push(i); }));
  testIdx.sort((a, b) => a - b);

  const papelIdx = p.programa === 'ase' && p.edi ? (PAPEL_EDI[p.anioInicio] || []).map(nivelIdx_)
    .filter(i => p.implementados.indexOf(i) >= 0 && testIdx.indexOf(i) < 0) : [];
  const test = { ok: !!d.test, nivelesTest: testIdx.map(i => NIVELES[i]), nivelesPapel: papelIdx.map(i => NIVELES[i]), links: links_(formsTest) };
  if (d.test) {
    Object.assign(test, bloqueTest_(p, testIdx,
      d.test.filter(x => x.rbd === rbd && x.programa === p.programa), studentId));
  }
  const efa = { ok: !!d.efa, links: links_(formulariosDe_(d.formularios, 'efa', p)) };
  if (d.efa) {
    Object.assign(efa, bloqueEfa_(p, d.efa.filter(x => x.rbd === rbd && x.programa === p.programa)));
  }
  return {
    programa: p.programa,
    modelo: p.modelo || null,
    jefeProyecto: p.jefeProyecto,
    coordinador: p.coordinador,
    edi: p.edi,
    nivelesImplementados: p.implementados.map(i => NIVELES[i]),
    test,
    efa,
  };
}

function formulariosDe_(formularios, encuesta, p) {
  return formularios.filter(f => f.encuesta === encuesta && aplica_(f, p));
}

// Blank cell = any. Text compared ignoring case and accents.
function aplica_(f, p) {
  return (!f.programa || f.programa === p.programa)
    && (!f.edi || (f.edi === 'si') === p.edi)
    && (!f.anio || f.anio === p.anioInicio)
    && (!f.modelo || f.modelo === normTexto_(p.modelo));
}

function rango_(f) {
  const d = f.desde ? nivelIdx_(f.desde) : 0;
  const h = f.hasta ? nivelIdx_(f.hasta) : NIVELES.length - 1;
  if (d < 0 || h < 0) return [];
  const out = [];
  for (let i = d; i <= h; i++) out.push(i);
  return out;
}

function links_(forms) {
  return forms.filter(f => f.link)
    .map(f => ({ form: f.form, desde: f.desde || null, hasta: f.hasta || null, link: f.link }));
}

function bloqueTest_(p, testIdx, resps, studentId) {
  const porNivel = agrupar_(resps, x => x.nivel);
  const registrados = p.implementados.filter(i => testIdx.indexOf(i) >= 0);
  const vistos = Object.keys(porNivel).map(Number)
    .filter(i => registrados.indexOf(i) < 0).sort((a, b) => a - b);
  const niveles = registrados.concat(vistos).map(i => {
    const reg = registrados.indexOf(i) >= 0;
    const lista = porNivel[i] || [];
    return {
      nivel: NIVELES[i],
      registrado: reg,
      est: reg && p.alumnos[i] > 0 ? p.alumnos[i] : null,
      r: lista.length,
      cursos: cursos_(p, i, lista, studentId),
    };
  });
  const resumen = { r: 0, rConEst: 0, est: 0 };
  niveles.forEach(n => {
    resumen.r += n.r;
    if (n.est) { resumen.rConEst += n.r; resumen.est += n.est; }
  });
  return { resumen, niveles };
}

function cursos_(p, i, resps, studentId) {
  const registradas = LETRAS.slice(0, Math.min(p.cxn[i], LETRAS.length));
  const porLetra = agrupar_(resps, x => x.letra || '');
  const extra = Object.keys(porLetra).filter(l => l && registradas.indexOf(l) < 0).sort();
  const letras = registradas.concat(extra);
  if (porLetra['']) letras.push('');
  const porCurso = p.cxn[i] > 0 && p.alumnos[i] > 0 ? Math.round(p.alumnos[i] / p.cxn[i]) : 0;

  return letras.map(l => {
    const lista = porLetra[l] || [];
    const reg = registradas.indexOf(l) >= 0;
    const curso = { letra: l || null, registrado: reg, r: lista.length };
    if (studentId === 'numero') {
      const numeros = lista.map(x => x.numero).filter(n => n != null).sort((a, b) => a - b);
      curso.tope = Math.max(numeros.length ? numeros[numeros.length - 1] : 0, reg ? porCurso : 0);
      curso.numeros = numeros;
      curso.sinNumero = lista.length - numeros.length;
    } else {
      curso.respuestas = lista.slice().sort(porApellido_)
        .map(x => ({ nombres: x.nombres, apellidos: x.apellidos }));
    }
    return curso;
  });
}

function bloqueEfa_(p, resps) {
  const vigentes = dedupEfa_(resps);
  const porSeccion = agrupar_(vigentes, x => x.seccion);
  const persona = x => ({ nombre: x.nombre, rol: x.rolCorto });
  const ordenadas = id => (porSeccion[id] || []).slice().sort(porNombre_);

  const secciones = SECCIONES.map(id => {
    const s = { id, r: (porSeccion[id] || []).length };
    if (id === 'docentes' && p.programa === 'ase') s.niveles = nivelesDocentes_(p, ordenadas(id), persona);
    // REL docentes: flat list, so each person carries the grades they declared (canonical order)
    else if (id === 'docentes') s.personas = ordenadas(id).map(x => Object.assign(persona(x),
      { niveles: x.niveles.slice().sort((a, b) => a - b).map(i => NIVELES[i]) }));
    else s.personas = ordenadas(id).map(persona);
    return s;
  });
  // Each role is its own response (a docente who is also mentor answered twice): total = Σ sections.
  // A docente with several grades is still one response (listed under each grade).
  return { total: vigentes.length, secciones };
}

// Key = email + role: any combination of roles is legitimate, a person appears once per role.
// Same key → most recent Fecha wins; if a Fecha is missing, the later row wins.
function dedupEfa_(resps) {
  const m = new Map();
  resps.forEach(x => {
    const k = x.correo ? x.correo + '|' + normTexto_(x.rol) : '#' + x.fila;
    const prev = m.get(k);
    if (!prev || x.fecha == null || prev.fecha == null || x.fecha >= prev.fecha) m.set(k, x);
  });
  return Array.from(m.values());
}

function nivelesDocentes_(p, docentes, persona) {
  const declarados = [];
  docentes.forEach(x => x.niveles.forEach(i => { if (declarados.indexOf(i) < 0) declarados.push(i); }));
  const vistos = declarados.filter(i => p.implementados.indexOf(i) < 0).sort((a, b) => a - b);
  const grupos = p.implementados.concat(vistos).map(i => {
    const lista = docentes.filter(x => x.niveles.indexOf(i) >= 0);
    // cursos = SF CxN, shown only when the grade is open: context, not a denominator (one teacher may cover every class)
    return { nivel: NIVELES[i], registrado: p.implementados.indexOf(i) >= 0, cursos: p.cxn[i] > 0 ? p.cxn[i] : null, r: lista.length, personas: lista.map(persona) };
  });
  const sinNivel = docentes.filter(x => !x.niveles.length);
  if (sinNivel.length) grupos.push({ nivel: null, registrado: false, cursos: null, r: sinNivel.length, personas: sinNivel.map(persona) });
  return grupos;
}

// PENDING: new EFA role list. Interim rule based on the EFS role texts.
function seccionDeRol_(rol) {
  const n = normTexto_(rol);
  if (n.startsWith('director')) return 'direccion';
  if (n.startsWith('docente') || n.startsWith('profesor')) return 'docentes';
  return 'lideres';
}

function ventana_(abreRaw, cierraRaw, hoy) {
  const abre = fechaIso_(abreRaw);
  const cierra = fechaIso_(cierraRaw);
  if (!abre || !cierra) return { abre, cierra, fase: null, diasRestantes: null };
  const fase = hoy < abre ? 'pre' : hoy > cierra ? 'closed' : 'open';
  return { abre, cierra, fase, diasRestantes: fase === 'open' ? diasEntre_(hoy, cierra) : null };
}

function registrarMetrica_(res) {
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.metricas);
    if (!sh) return;
    sh.appendRow([
      new Date(),
      res.colegio.rbd,
      res.programas.map(p => p.programa.toUpperCase()).join(','),
      res.programas.every(p => p.test.ok),
      res.programas.every(p => p.efa.ok),
      res.ms,
    ]);
  } catch (err) {
    console.error('Métricas: ' + (err && err.message));
  }
}

// ── Normalization ───────────────────────────────────────────

const NIVEL_IDX = {};
NIVELES.forEach((n, i) => { NIVEL_IDX[claveNivel_(n)] = i; });

function normTexto_(v) {
  return String(v == null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function claveNivel_(v) {
  return normTexto_(String(v == null ? '' : v).replace(/º/g, '°'));
}

// Exact match against the 14 canonical grades after normalization. Never substring.
function nivelIdx_(v) {
  const k = claveNivel_(v);
  return Object.prototype.hasOwnProperty.call(NIVEL_IDX, k) ? NIVEL_IDX[k] : -1;
}

function normRbd_(v) {
  if (typeof v === 'number') return isFinite(v) && v > 0 ? String(Math.trunc(v)) : '';
  const m = String(v == null ? '' : v).trim().match(/^\d+/);
  return m && Number(m[0]) > 0 ? String(Number(m[0])) : '';
}

// "Comuna - Nombre - RBD" → RBD
function rbdDeColegio_(v) {
  return normRbd_(String(v == null ? '' : v).split(' - ').pop());
}

// SF record type ("ASE" / "Religión") or Form label ("ASE_4-5", "REL Intensivo") → 'ase' | 'rel'
function programa_(v) {
  const n = normTexto_(v);
  if (!n) return '';
  if (n.startsWith('ase')) return 'ase';
  if (n.startsWith('rel')) return 'rel';
  return '?';
}

function letra_(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  return /^[A-Z]$/.test(s) ? s : null;
}

function numero_(v) {
  const n = typeof v === 'number' ? v : (/^\d+$/.test(String(v).trim()) ? Number(String(v).trim()) : NaN);
  return Number.isInteger(n) && n >= 1 && n <= 99 ? n : null;
}

function limpio_(v) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return s || null;
}

function entero_(v) {
  if (v === '' || v == null) return 0;
  const n = Number(v);
  return isFinite(n) ? Math.trunc(n) : 0;
}

function esVerdadero_(v) {
  return v === true || /^(true|verdadero|si|1)$/.test(normTexto_(v));
}

function ms_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
  const t = Date.parse(String(v == null ? '' : v).trim());
  return isNaN(t) ? null : t;
}

function fechaIso_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  const s = String(v == null ? '' : v).trim();
  let m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^\d{4}-\d{2}-\d{2}$/);
  return m ? s : null;
}

function diasEntre_(a, b) {
  const utc = s => { const [y, mo, d] = s.split('-').map(Number); return Date.UTC(y, mo - 1, d); };
  return Math.round((utc(b) - utc(a)) / 86400000);
}

function agrupar_(lista, fn) {
  const out = {};
  lista.forEach(x => { const k = fn(x); (out[k] = out[k] || []).push(x); });
  return out;
}

// Missing names sort last ("Sin identificar").
function compararTexto_(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const x = normTexto_(a), y = normTexto_(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

function porApellido_(a, b) {
  return compararTexto_(a.apellidos, b.apellidos) || compararTexto_(a.nombres, b.nombres);
}

function porNombre_(a, b) {
  return compararTexto_(a.nombre, b.nombre);
}

// ── Manual checks (run from the editor) ─────────────────────

/**
 * Builds the panel for every school that has rows in the response tabs and logs counts only
 * (never names), plus how long reading the Sheet and building each panel took.
 */
function probarPanel() {
  const t0 = Date.now();
  const d = cargarDatos_();
  const tDatos = Date.now() - t0;
  const rbds = Array.from(new Set([].concat(d.test || [], d.efa || []).map(x => x.rbd))).sort();
  const out = [`Lectura del Sheet: ${tDatos} ms · colegios con respuestas: ${rbds.length}`,
    `Test ok: ${!!d.test} · EFA ok: ${!!d.efa} · Formularios: ${d.formularios.length} filas`];
  rbds.forEach(rbd => {
    const t1 = Date.now();
    const p = panel_(rbd, d, reloj_());
    out.push(`RBD ${rbd} (${Date.now() - t1} ms) · Test ${p.encuestas.test.fase} · EFA ${p.encuestas.efa.fase}` +
      (d.sf[rbd] ? '' : ' · NO está en SF'));
    p.programas.forEach(pr => {
      const t = pr.test, e = pr.efa;
      const fuera = t.niveles ? t.niveles.filter(n => !n.registrado).length : 0;
      out.push(`  ${pr.programa.toUpperCase()}: Test r=${t.resumen ? t.resumen.r : '-'} est=${t.resumen ? t.resumen.est : '-'} ` +
        `niveles=${t.niveles ? t.niveles.length : '-'} (fuera ${fuera}) links=${t.links.length} · ` +
        `EFA total=${e.total != null ? e.total : '-'} [${(e.secciones || []).map(s => s.id + '=' + s.r).join(' ')}] links=${e.links.length}`);
    });
  });
  const texto = out.join('\n');
  console.log(texto);
  return texto;
}

/**
 * Applies the portal's own Formularios matching to every non-Control school in SF
 * and reports coverage gaps, invalid rows and Form labels that don't tie to the imports.
 */
function revisarFormularios() {
  const sf = leerSF_();
  const forms = leerFormularios_();
  const out = ['Revisión de Formularios'];

  const filas = [];
  forms.forEach(f => {
    const p = [];
    if (f.encuesta !== 'test' && f.encuesta !== 'efa') p.push(`Encuesta "${f.encuesta}" no es test ni efa`);
    if (!f.form) p.push('Form vacío');
    if (f.programa === '?') p.push('Programa no es ASE ni REL');
    if (f.edi && f.edi !== 'si' && f.edi !== 'no') p.push('EDI no es SÍ, NO ni vacío');
    if (f.desde && nivelIdx_(f.desde) < 0) p.push(`Desde "${f.desde}" no es un nivel válido`);
    if (f.hasta && nivelIdx_(f.hasta) < 0) p.push(`Hasta "${f.hasta}" no es un nivel válido`);
    if (f.encuesta === 'test' && (!f.desde || !f.hasta)) p.push('Test sin Desde/Hasta');
    if (!f.link) p.push('Link vacío');
    if (p.length) filas.push(`  fila ${f.fila} (${f.form || 'sin Form'}): ${p.join('; ')}`);
  });
  out.push(filas.length ? 'Filas con observaciones:\n' + filas.join('\n') : 'Filas: sin observaciones');

  const grupos = { sinTest: [], sinEfa: [], variasEfa: [], sinNivelesTest: [] };
  let revisadas = 0;
  Object.keys(sf).forEach(rbd => Object.keys(sf[rbd].programas).forEach(k => {
    const p = sf[rbd].programas[k];
    if (normTexto_(p.modelo) === 'control') return;
    revisadas++;
    const etiqueta = `${rbd} ${p.programa.toUpperCase()}·${p.modelo}${p.edi ? '·EDI' : ''}`;
    const test = formulariosDe_(forms, 'test', p);
    const efa = formulariosDe_(forms, 'efa', p);
    if (!test.length) grupos.sinTest.push(etiqueta);
    else {
      const idx = [].concat.apply([], test.map(rango_));
      if (!p.implementados.some(i => idx.indexOf(i) >= 0)) grupos.sinNivelesTest.push(etiqueta);
    }
    if (!efa.length) grupos.sinEfa.push(etiqueta);
    if (efa.length > 1) grupos.variasEfa.push(`${etiqueta} (${efa.map(f => f.form).join(', ')})`);
  }));
  out.push(`Colegio-programa revisados (sin Control): ${revisadas}`);
  const lista = (titulo, l) => out.push(`${titulo}: ${l.length}` + (l.length ? '\n  ' + l.join('\n  ') : ''));
  lista('Sin formulario de Test', grupos.sinTest);
  lista('Sin formulario EFA', grupos.sinEfa);
  lista('Con más de un formulario EFA', grupos.variasEfa);
  lista('Info · ningún nivel implementado tiene Test (la pestaña se muestra igual)', grupos.sinNivelesTest);

  const etiquetas = new Set(forms.map(f => normTexto_(f.form)));
  [TABS.respTest, TABS.respEfa].forEach(tab => {
    const t = intentar_(tab, () => leerTabla_(tab), null);
    if (!t) return;
    const cols = colsPrefijo_(t, 'Form');
    const sueltas = new Set();
    t.rows.forEach(r => {
      const v = String(primero_(r, cols)).trim();
      if (v && !etiquetas.has(normTexto_(v))) sueltas.add(v);
    });
    out.push(`${tab} · Form sin fila en Formularios: ` + (sueltas.size ? Array.from(sueltas).join(', ') : 'ninguno'));
  });

  const texto = out.join('\n');
  console.log(texto);
  return texto;
}

// ── Fake test data (staging only; cleared by hand at launch) ─

const FAKE_NOMBRES = ['Agustín', 'Martina', 'Benjamín', 'Sofía', 'Vicente', 'Isidora', 'Matías', 'Florencia', 'Lucas',
  'Antonia', 'Joaquín', 'Emilia', 'Tomás', 'Josefa', 'Maximiliano', 'Trinidad', 'Gaspar', 'Amanda', 'Clemente',
  'Rafaela', 'Diego', 'Catalina', 'Felipe', 'Javiera', 'Ignacio', 'Valentina', 'Bastián', 'Fernanda', 'Simón', 'Julieta'];
const FAKE_APELLIDOS = ['Bravo', 'Castro', 'Díaz', 'Espinoza', 'Fuentes', 'González', 'Hidalgo', 'Ibáñez', 'Jara', 'Klein',
  'López', 'Muñoz', 'Navarro', 'Olivares', 'Pérez', 'Quiroz', 'Rojas', 'Silva', 'Torres', 'Urrutia', 'Vargas', 'Yáñez',
  'Zamora', 'Araya', 'Bustos', 'Cárdenas', 'Donoso', 'Escobar', 'Morales', 'Núñez'];
const ROLES_EFS = {
  director: 'Director/a del establecimiento',
  encargado: 'Encargado/a del Programa, es decir, estoy a cargo de la relación del establecimiento con la Fundación',
  mentor: 'Mentor/a, es decir, acompaño y retroalimento a docentes que implementan el Programa',
  otros: 'Otros líderes del establecimiento',
  ase: 'Docente que implementa el Programa ASE-Orientación de Trabün',
  rel: 'Docente que implementa el Programa de Religión de Trabün',
};

/**
 * Fills Respuestas Test and Respuestas EFA with fictional people for a few real schools,
 * one per case below, chosen from SF at run time (no RBD is written in the code).
 * Refuses to run if either tab already has rows under the header.
 */
function generarDatosPrueba() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shTest = ss.getSheetByName(TABS.respTest);
  const shEfa = ss.getSheetByName(TABS.respEfa);
  [[shTest, TABS.respTest], [shEfa, TABS.respEfa]].forEach(([sh, name]) => {
    if (!sh) throw new Error(`Falta la pestaña ${name}. Corre configurarHojas() primero.`);
    if (sh.getLastRow() > 1) throw new Error(`${name} ya tiene filas bajo el encabezado. Bórralas antes de generar datos de prueba.`);
  });

  const sf = leerSF_();
  const forms = leerFormularios_();
  const tClaves = leerTabla_(TABS.claves);
  const cRbd = colExacta_(tClaves, 'rbd');
  const conClave = new Set(tClaves.rows.map(r => normRbd_(r[cRbd])));
  const rnd = azar_(20261013);

  const activos = col => ['ase', 'rel'].map(k => col.programas[k])
    .filter(p => p && normTexto_(p.modelo) !== 'control');
  const testIdxDe = p => {
    const idx = [];
    formulariosDe_(forms, 'test', p).forEach(f => rango_(f).forEach(i => { if (idx.indexOf(i) < 0) idx.push(i); }));
    return idx;
  };
  const conTest = p => p.implementados.some(i => testIdxDe(p).indexOf(i) >= 0);
  const casos = [ // most specific first, so a rare case isn't used up by a broad one
    ['ASE EDI cohorte 2025', ps => ps.some(p => p.programa === 'ase' && p.edi && p.anioInicio === 2025)],
    ['ASE EDI cohorte 2026', ps => ps.some(p => p.programa === 'ase' && p.edi && p.anioInicio === 2026)],
    ['Sin niveles con Test (uso diagnóstico)', ps => ps.some(p => !conTest(p))],
    ['ASE + Religión', ps => ps.length === 2 && ps.every(conTest)],
    ['Religión sola', ps => ps.length === 1 && ps[0].programa === 'rel' && conTest(ps[0])],
    ['ASE sin EDI', ps => ps.length === 1 && ps[0].programa === 'ase' && !ps[0].edi && conTest(ps[0])],
  ];

  const elegidos = [];
  casos.forEach(([caso, pred]) => {
    const cands = Object.keys(sf).sort()
      .filter(rbd => conClave.has(rbd) && !elegidos.some(e => e.rbd === rbd))
      .filter(rbd => { const ps = activos(sf[rbd]); return ps.length && pred(ps); });
    if (cands.length) elegidos.push({ caso, rbd: cands[Math.floor(rnd() * cands.length)] });
  });

  const hTest = leerTabla_(TABS.respTest).headers;
  const hEfa = leerTabla_(TABS.respEfa).headers;
  const filasTest = [];
  const filasEfa = [];
  elegidos.forEach((e, n) => {
    activos(sf[e.rbd]).forEach(p => {
      const colegioTxt = `${sf[e.rbd].comuna} - ${sf[e.rbd].nombre} - ${e.rbd}`;
      fakeTest_(p, colegioTxt, forms, testIdxDe(p), rnd, n === 0).forEach(o => filasTest.push(filaPorEncabezado_(hTest, o, rnd)));
      fakeEfa_(p, colegioTxt, forms, rnd, n === 0).forEach(o => filasEfa.push(filaPorEncabezado_(hEfa, o, rnd)));
    });
  });
  if (filasTest.length) shTest.getRange(2, 1, filasTest.length, hTest.length).setValues(filasTest);
  if (filasEfa.length) shEfa.getRange(2, 1, filasEfa.length, hEfa.length).setValues(filasEfa);

  const texto = ['Datos de prueba generados (personas ficticias; borrar antes del lanzamiento):']
    .concat(elegidos.map(e => `  ${e.caso}: RBD ${e.rbd} (${activos(sf[e.rbd]).map(p => p.programa.toUpperCase() + '·' + p.modelo + (p.edi ? '·EDI ' + p.anioInicio : '')).join(', ')})`))
    .concat(casos.filter(([c]) => !elegidos.some(e => e.caso === c)).map(([c]) => `  ${c}: sin colegio que cumpla`))
    .concat([`${TABS.respTest}: ${filasTest.length} filas`, `${TABS.respEfa}: ${filasEfa.length} filas`]).join('\n');
  console.log(texto);
  return texto;
}

function fakeTest_(p, colegioTxt, forms, testIdx, rnd, conBordes) {
  const formsTest = formulariosDe_(forms, 'test', p);
  const formDe = i => (formsTest.find(f => rango_(f).indexOf(i) >= 0) || formsTest[0] || {}).form;
  let niveles = p.implementados.filter(i => testIdx.indexOf(i) >= 0);
  if (!niveles.length && testIdx.length) niveles = [testIdx[0]]; // diagnostic use: a grade the school doesn't implement
  const out = [];
  niveles.forEach(i => {
    const nCursos = Math.max(1, p.cxn[i]);
    const tam = p.cxn[i] > 0 && p.alumnos[i] > 0 ? Math.round(p.alumnos[i] / p.cxn[i]) : 25;
    for (let k = 0; k < nCursos; k++) {
      const numeros = barajar_(Array.from({ length: tam }, (_, j) => j + 1), rnd)
        .slice(0, Math.round(tam * (0.3 + 0.6 * rnd())));
      numeros.forEach(num => out.push(fakeAlumno_(formDe(i), colegioTxt, NIVELES[i], LETRAS[k], num, rnd)));
    }
  });
  if (conBordes && niveles.length) {
    const i = niveles[0];
    const dup = out.find(o => o.Nivel === NIVELES[i]);
    if (dup) out.push(Object.assign({}, dup));                                                  // duplicate submission
    out.push(Object.assign(fakeAlumno_(formDe(i), colegioTxt, NIVELES[i], 'A', '', rnd), { Nombres: '', Apellidos: '' })); // blank name
    out.push(fakeAlumno_(formDe(i), colegioTxt, NIVELES[i], LETRAS[Math.max(1, p.cxn[i])], 7, rnd)); // unregistered letter
    out.push(fakeAlumno_(formDe(i), colegioTxt, NIVELES[i].replace('básico', 'Básico'), 'A', 9, rnd)); // casing variant
    const fuera = testIdx.find(j => p.implementados.indexOf(j) < 0);
    if (fuera != null) out.push(fakeAlumno_(formDe(fuera), colegioTxt, NIVELES[fuera], 'A', 4, rnd)); // outside registered
  }
  return out;
}

function fakeAlumno_(form, colegioTxt, nivel, letra, numero, rnd) {
  const ap = elegir_(FAKE_APELLIDOS, rnd) + (rnd() < 0.7 ? ' ' + elegir_(FAKE_APELLIDOS, rnd) : '');
  return {
    Form: form, 'Marca temporal': fechaFake_(rnd), Nombres: elegir_(FAKE_NOMBRES, rnd), Apellidos: ap,
    'Número de lista': numero, Nivel: nivel, Letra: letra, Colegio: colegioTxt,
  };
}

function fakeEfa_(p, colegioTxt, forms, rnd, conBordes) {
  const f = formulariosDe_(forms, 'efa', p)[0];
  const form = f ? f.form : (p.edi ? 'EFA_EDI' : `${p.programa.toUpperCase()} ${p.modelo}`);
  const persona = (rol, niveles) => {
    const nombre = elegir_(FAKE_NOMBRES, rnd);
    const apellido = elegir_(FAKE_APELLIDOS, rnd);
    const correo = `${normTexto_(nombre)}.${normTexto_(apellido)}.${Math.floor(rnd() * 1e4)}@ejemplo.invalid`
      .replace(/[^a-z0-9.@]/g, '');
    return { Form: form, Fecha: Utilities.formatDate(fechaFake_(rnd), TZ, "yyyy-MM-dd'T'HH:mm:ss"),
      Nombre: nombre, Apellido: apellido, Correo: correo, Colegio: colegioTxt, Rol: rol, Niveles: niveles || '-' };
  };
  const out = [persona(ROLES_EFS.director), persona(ROLES_EFS.encargado), persona(ROLES_EFS.mentor)];
  if (rnd() < 0.5) out.push(persona(ROLES_EFS.otros));
  if (p.programa === 'ase') {
    p.implementados.forEach(i => {
      if (rnd() < 0.75) out.push(persona(ROLES_EFS.ase, NIVELES[i]));
    });
    if (p.implementados.length > 1) {
      out.push(persona(ROLES_EFS.ase, p.implementados.slice(0, 2).map(i => NIVELES[i]).join(', '))); // several grades
    }
  } else {
    const n = 2 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) out.push(persona(ROLES_EFS.rel, rnd() < 0.5 ? NIVELES[elegir_(p.implementados, rnd)] : '-'));
  }
  if (conBordes) {
    const doc = out[out.length - 1];
    out.push(Object.assign({}, doc, { Rol: ROLES_EFS.mentor, Niveles: '-' }));                          // same person, second role
    out.push(Object.assign({}, out[0], { Apellido: out[0].Apellido + ' ' + elegir_(FAKE_APELLIDOS, rnd),  // resubmission
      Fecha: Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss") }));
  }
  return out;
}

// Header-driven row: each Colegio value lands in one random region column.
function filaPorEncabezado_(headers, obj, rnd) {
  const colegios = headers.map((h, i) => (h === 'Colegio' ? i : -1)).filter(i => i >= 0);
  const destino = colegios[Math.floor(rnd() * colegios.length)];
  return headers.map((h, i) => (h === 'Colegio' ? (i === destino ? obj.Colegio : '') : (obj[h] == null ? '' : obj[h])));
}

function fechaFake_(rnd) {
  return new Date(Date.now() - Math.floor(rnd() * 14 * 86400000));
}

function azar_(seed) { // mulberry32, deterministic
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function elegir_(lista, rnd) {
  return lista[Math.floor(rnd() * lista.length)];
}

function barajar_(lista, rnd) {
  for (let i = lista.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [lista[i], lista[j]] = [lista[j], lista[i]];
  }
  return lista;
}

// ── One-time setup ──────────────────────────────────────────

const MAX_COLEGIO_COLS = 16; // one school dropdown per Chilean region

const HEADERS = {
  [TABS.config]: ['clave', 'valor', 'nota'],
  [TABS.formularios]: ['Encuesta', 'Form', 'Programa', 'EDI', 'Año inicio', 'Modelo', 'Desde', 'Hasta', 'Link'],
  [TABS.metricas]: ['timestamp', 'rbd', 'programas', 'testOk', 'efaOk', 'ms'],
  [TABS.respTest]: ['Form', 'Marca temporal', 'Nombres', 'Apellidos', 'Número de lista', 'Nivel', 'Letra']
    .concat(Array(MAX_COLEGIO_COLS).fill('Colegio')),
  [TABS.respEfa]: ['Form', 'Fecha', 'Nombre', 'Apellido', 'Correo', 'Colegio', 'Rol', 'Niveles'],
};

// Initial rows, written only when a tab is created. Afterwards the Sheet is the source of truth.
function seedRows_() {
  return {
    [TABS.config]: [
      ['test_abre', new Date(2026, 9, 13), 'Apertura del Test de Estudiantes'],
      ['test_cierra', new Date(2026, 10, 20), 'Cierre del Test de Estudiantes (abierta todo ese día)'],
      ['efa_abre', new Date(2026, 10, 2), 'Apertura de la EFA'],
      ['efa_cierra', new Date(2026, 10, 13), 'Cierre de la EFA (abierta todo ese día; probable extensión al 20-11)'],
      ['student_id', '', 'nombre | numero (pendiente)'],
      ['contacto_general', 'evaluacion@fundaciontrabun.cl', 'Contacto en el pie de página'],
      ['contacto_edi', 'consultas_edi@fundaciontrabun.cl', 'Contacto para colegios EDI'],
    ],
    [TABS.formularios]: [
      ['test', 'ASE_4-5', 'ASE', 'NO', '', '', '4° básico', '5° básico', ''],
      ['test', 'ASE_6-IV', 'ASE', 'NO', '', '', '6° básico', 'IV° medio', ''],
      ['test', 'ASE_EDI_4', 'ASE', 'SÍ', 2025, '', '4° básico', '4° básico', ''],
      ['test', 'ASE_EDI_I-IV', 'ASE', 'SÍ', 2025, '', 'I° medio', 'IV° medio', ''],
      ['test', 'ASE_EDI_8-IV', 'ASE', 'SÍ', 2026, '', '8° básico', 'IV° medio', ''],
      ['test', 'REL_5-8', 'REL', '', '', '', '5° básico', '8° básico', ''],
      ['test', 'REL_I-IV', 'REL', '', '', '', 'I° medio', 'IV° medio', ''],
    ],
  };
}

/**
 * One-time setup, run by hand from the editor. Creates missing tabs with their
 * headers (and seed rows). Never overwrites: an existing tab with content is
 * only compared against the contract and reported.
 */
function configurarHojas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const seeds = seedRows_();
  const informe = [`Hoja: ${ss.getName()} (${ss.getId()})`];
  Object.keys(HEADERS).forEach(name => {
    informe.push(prepararPestana_(ss, name, HEADERS[name], seeds[name] || []));
  });
  const texto = informe.join('\n');
  console.log(texto);
  return texto;
}

function prepararPestana_(ss, name, headers, rows) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name, ss.getNumSheets());
    escribirPestana_(sh, headers, rows);
    return `${name}: creada`;
  }
  if (sh.getLastRow() === 0) {
    escribirPestana_(sh, headers, rows);
    return `${name}: existía vacía, encabezados escritos`;
  }
  const found = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(v => v.trim());
  while (found.length && found[found.length - 1] === '') found.pop();
  if (found.join('|') === headers.join('|')) return `${name}: existe, encabezados OK (sin cambios)`;
  return `${name}: existe con contenido, NO modificada. Encabezados distintos al contrato:\n` +
    `  esperado:   ${headers.join(' | ')}\n` +
    `  encontrado: ${found.join(' | ')}`;
}

function escribirPestana_(sh, headers, rows) {
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(1);
  if (!rows.length) return;
  sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  rows.forEach((row, i) => row.forEach((v, j) => {
    if (v instanceof Date) sh.getRange(i + 2, j + 1).setNumberFormat('dd-mm-yyyy');
  }));
}
