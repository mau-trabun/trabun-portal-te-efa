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
  sinTest: 'Sin Test',
  letras: 'Letras',
  contactosEdi: 'Contactos EFA-EDI', // EDI «Faltan por responder» (Mau 17-11-2026); optional
  sdc: 'SDC',                        // idem: teachers by grade and class from the seguimiento de clases; optional
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

// Internal team view (Mau 29-10-2026): "<RBD>trabun" + the school's clave opens the school's panel without counting as
// the school's use: Métricas rows get evento "login_interno" / "<evento>_interno" (the tracker and usage counts skip
// them) and a separate attempt counter, so a teammate's typos never lock the school out. Not a secret (public repo):
// it still needs the school's clave, it only keeps the metrics clean.
const RE_INTERNO = /^\s*(\d+)\s*-?\s*trabun\s*$/i;

function login_(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (_) { /* malformed → credenciales */ }
  if (body && body.corto !== undefined) return linkCorto_(body.corto, body.encuesta === 'efa' ? 'efa' : 'test'); // /t/ and /e/ pages: no clave, only what the link carries
  const crudo = String(body.rbd == null ? '' : body.rbd);
  const interno = RE_INTERNO.test(crudo);
  // Letters that aren't the exact suffix ("26466tra", "26466trabu") are refused, so a mistyped internal login fails
  // instead of counting as the school's use. A check digit ("12345-6", "12345-K") still passes as before.
  if (!interno && /[a-z]{2,}/i.test(crudo)) return { ok: false, error: 'credenciales' };
  const rbd = normRbd_(interno ? crudo.match(RE_INTERNO)[1] : body.rbd);
  const clave = String(body.clave == null ? '' : body.clave).trim();
  if (!rbd || !clave) return { ok: false, error: 'credenciales' };

  // Throttle counts attempts for any RBD, existing or not, so it can't be used to enumerate.
  const cache = CacheService.getScriptCache();
  const kIntentos = 'intentos_' + rbd + (interno ? '_interno' : '');
  const intentos = Number(cache.get(kIntentos)) || 0;
  if (intentos >= MAX_INTENTOS) return { ok: false, error: 'bloqueado' };

  const guardada = claveDe_(rbd);
  if (guardada === null || guardada !== clave) {
    cache.put(kIntentos, String(intentos + 1), VENTANA_BLOQUEO_S);
    return { ok: false, error: 'credenciales' };
  }
  cache.remove(kIntentos);

  if (body.evento !== undefined) return registrarEvento_(rbd, body, interno); // usage event: no panel built

  const res = panel_(rbd, cargarDatos_(), reloj_());
  if (interno) res.interno = true; // the portal shows "Vista interna"
  if (body.refresco !== true) registrarMetrica_(res, interno); // auto/manual refreshes are not new logins
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
    habilitados: intentar_(TABS.sinTest, leerHabilitados_, {}),
    letras: intentar_(TABS.letras, leerLetras_, {}),
    contactosEdi: intentar_(TABS.contactosEdi, leerContactosEdi_, null), // null = no «Faltan por responder» block
    sdc: intentar_(TABS.sdc, leerSdc_, null),
  };
}

// "Letras" tab (manual, optional; created by prepararLetras()): a school's real class letters for a grade, when they
// aren't A, B, C… from SF CxN (e.g. A, D). RBD | Nivel | Letras | ASE | REL: a row applies to the programs ticked;
// nothing ticked = not used. Missing tab or a row that can't be read = SF letters.
const LETRAS_ENCABEZADOS = ['RBD', 'Nivel', 'Letras', 'ASE', 'REL'];
function leerLetras_() {
  const out = {};
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.letras)) return out;
  const t = leerTabla_(TABS.letras);
  const cR = colExacta_(t, 'RBD'), cN = colExacta_(t, 'Nivel'), cL = colExacta_(t, 'Letras');
  const cProg = { ase: colExacta_(t, 'ASE'), rel: colExacta_(t, 'REL') };
  t.rows.forEach(r => {
    const rbd = normRbd_(r[cR]), i = nivelIdx_(r[cN]);
    const letras = String(r[cL] == null ? '' : r[cL]).split(/[\s,;/]+/).filter(x => x !== 'y').map(letra_).filter(Boolean)
      .filter((l, k, a) => a.indexOf(l) === k).sort();
    if (!rbd || i < 0 || !letras.length) return;
    ['ase', 'rel'].forEach(p => { if (esVerdadero_(r[cProg[p]])) out[`${rbd}|${i}|${p}`] = letras; });
  });
  return out;
}

// Letters from the Letras tab for this school-program and grade, or null
function letrasDe_(d, rbd, programa, i) {
  return (d.letras || {})[`${rbd}|${i}|${programa}`] || null;
}

// "Sin Test" tab (written by listarSinTest()): school-programs ticked in Habilitar see their group's Test links
// even with no Test grade. Missing tab = nobody ticked.
function leerHabilitados_() {
  const out = {};
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.sinTest)) return out;
  const t = leerTabla_(TABS.sinTest);
  const cR = colExacta_(t, 'RBD'), cP = colExacta_(t, 'Programa'), cH = colExacta_(t, 'Habilitar');
  t.rows.forEach(r => {
    const rbd = normRbd_(r[cR]), p = programa_(r[cP]);
    if (rbd && (p === 'ase' || p === 'rel') && esVerdadero_(r[cH])) out[rbd + '|' + p] = true;
  });
  return out;
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
    proyecto: t.headers.indexOf('Proyecto'),       // optional: announcement emails only ("Bien Público")
    sostenedor: t.headers.indexOf('Sostenedor'),   // optional: announcement emails only (SIP)
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
      sostenedor: '',
      programas: {},
    });
    if (!col.sostenedor && c.sostenedor >= 0) col.sostenedor = String(row[c.sostenedor] || '').trim();
    const programa = programa_(row[c.tipo]);
    if ((programa !== 'ase' && programa !== 'rel') || col.programas[programa]) return; // first row wins
    const alumnos = c.alumnos.map(i => entero_(row[i]));
    const cxn = c.cxn.map(i => entero_(row[i]));
    col.programas[programa] = {
      programa,
      modelo: String(row[c.modelo] || '').trim(),
      sostenedor: c.sostenedor >= 0 ? String(row[c.sostenedor] || '').trim() : '', // Formularios "Sostenedor" filter
      jefeProyecto: c.jefe >= 0 ? limpio_(row[c.jefe]) : null,
      coordinador: c.coord >= 0 ? limpio_(row[c.coord]) : null,
      proyecto: c.proyecto >= 0 ? String(row[c.proyecto] || '').trim() : '',
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
  const cSost = t.headers.indexOf('Sostenedor'); // optional column
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
      sostenedor: cSost >= 0 ? normTexto_(r[cSost]) : '',
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
    run: colsPrefijo_(t, 'RUN'), // EDI surveys only: matches a response to its expected person (never leaves the server)
  };
  return t.rows
    .map((r, i) => {
      const rol = limpio_(primero_(r, c.rol));
      return {
        fila: i + 2,
        run: rutNorm_(primero_(r, c.run)),
        rbd: rbdDeColegio_(primero_(r, c.colegio)),
        programa: programaDe(primero_(r, c.form)),
        fecha: ms_(primero_(r, c.fecha)),
        correo: String(primero_(r, c.correo)).trim().toLowerCase(),
        nombre: limpio_([primero_(r, c.nombre), primero_(r, c.apellido)].join(' ')),
        nombres: limpio_(primero_(r, c.nombre)),     // sort keys only (the payload carries the full name)
        apellidos: limpio_(primero_(r, c.apellido)),
        rol,
        rolCorto: rolEfa_(rol).corto,
        secciones: rolEfa_(rol).secciones,
        niveles: nivelesDeTexto_(primero_(r, c.niveles)),
      };
    })
    .filter(x => x.rbd);
}

// Grades a respondent declared. Regular surveys: "NT1, 5° básico". EDI surveys are a grade × class matrix
// that writes every row: "NT1: A, B | NT2: - | 1° básico: A" → a grade counts only when something other
// than "-" follows its ":" (Mau 13-11-2026: "NT2: -" was read as declared). Letters are not kept.
function nivelesDeTexto_(v) {
  const out = [];
  const agregar = t => { const i = nivelIdx_(t); if (i >= 0 && out.indexOf(i) < 0) out.push(i); };
  String(v == null ? '' : v).split('|').forEach(parte => {
    const k = parte.indexOf(':');
    if (k < 0) { parte.split(',').forEach(agregar); return; }
    if (/[^\s\-–—,;]/.test(parte.slice(k + 1))) agregar(parte.slice(0, k));
  });
  return out;
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
  const encuestas = {
    test: ventana_(cfg.test_abre, cfg.test_cierra, reloj.hoy, cfg.test_extension),
    efa: ventana_(cfg.efa_abre, cfg.efa_cierra, reloj.hoy, cfg.efa_extension),
  };
  return {
    ok: true,
    v: API_VERSION,
    generado: reloj.generado,
    colegio: { rbd, nombre: col.nombre, comuna: col.comuna },
    contacto: String((ase && ase.edi ? cfg.contacto_edi : cfg.contacto_general) || CONTACTO_DEFECTO).trim(),
    aviso: String(cfg.aviso_portal == null ? '' : cfg.aviso_portal).trim(), // Config notice for every school ('' = none)
    studentId,
    encuestas,
    programas: ['ase', 'rel'].filter(p => col.programas[p])
      .map(p => panelPrograma_(rbd, col.programas[p], d, studentId, encuestas.efa.fase)),
  };
}

function panelPrograma_(rbd, p, d, studentId, faseEfa) {
  const formsTest = formulariosDe_(d.formularios, 'test', p);
  const testIdx = [];
  formsTest.forEach(f => rango_(f).forEach(i => { if (testIdx.indexOf(i) < 0) testIdx.push(i); }));
  testIdx.sort((a, b) => a - b);

  const papelIdx = p.programa === 'ase' && p.edi ? (PAPEL_EDI[p.anioInicio] || []).map(nivelIdx_)
    .filter(i => p.implementados.indexOf(i) >= 0 && testIdx.indexOf(i) < 0) : [];
  const linksTest = links_(formsTest, rbd, d.sf[rbd]);
  const test = { ok: !!d.test, nivelesTest: testIdx.map(i => NIVELES[i]), nivelesPapel: papelIdx.map(i => NIVELES[i]), links: linksTest,
    habilitado: !!(d.habilitados && d.habilitados[rbd + '|' + p.programa]) };
  if (d.test) {
    Object.assign(test, bloqueTest_(p, testIdx,
      d.test.filter(x => x.rbd === rbd && x.programa === p.programa), studentId, i => letrasDe_(d, rbd, p.programa, i)));
  }
  const efa = { ok: !!d.efa, links: links_(formulariosDe_(d.formularios, 'efa', p), rbd, d.sf[rbd]) };
  if (d.efa) {
    // Control programs never get EFA (Mau 30-10-2026): a response sent by mistake is not shown either, so the tab never appears
    const control = normTexto_(p.modelo) === 'control';
    const resps = control ? [] : d.efa.filter(x => x.rbd === rbd && x.programa === p.programa);
    Object.assign(efa, bloqueEfa_(p, resps));
    // EDI «Faltan por responder» (Mau 17-11-2026): treated EDI programs, only while the EFA is open or in its extra week
    if (!control && p.edi && p.programa === 'ase' && (faseEfa === 'open' || faseEfa === 'extra')) {
      const pend = pendientesEdi_(rbd, p, d, resps);
      if (pend) efa.pendientes = pend;
    }
  }
  return {
    programa: p.programa,
    modelo: p.modelo || null,
    jefeProyecto: p.jefeProyecto,
    coordinador: p.coordinador,
    edi: p.edi,
    cohorte: p.edi ? p.anioInicio : null, // EDI impact-study cohort (2025 / 2026): EFA share message wording
    nivelesImplementados: p.implementados.map(i => NIVELES[i]),
    test,
    efa,
  };
}

function formulariosDe_(formularios, encuesta, p) {
  if (encuesta === 'efa' && normTexto_(p.modelo) === 'control') return []; // EFA never for Control (Mau 29-10-2026), EDI controls included
  return formularios.filter(f => f.encuesta === encuesta && aplica_(f, p));
}

// Blank cell = any. Text compared ignoring case and accents. Sostenedor (optional column, 30-10-2026): the SF
// sostenedor must contain that text, e.g. "Instrucción Primaria" so REL Cuadernillos reaches only the SIP schools.
function aplica_(f, p) {
  return (!f.programa || f.programa === p.programa)
    && (!f.edi || (f.edi === 'si') === p.edi)
    && (!f.anio || f.anio === p.anioInicio)
    && (!f.modelo || f.modelo === normTexto_(p.modelo))
    && (!f.sostenedor || normTexto_(p.sostenedor).indexOf(f.sostenedor) >= 0);
}

function rango_(f) {
  const d = f.desde ? nivelIdx_(f.desde) : 0;
  const h = f.hasta ? nivelIdx_(f.hasta) : NIVELES.length - 1;
  if (d < 0 || h < 0) return [];
  const out = [];
  for (let i = d; i <= h; i++) out.push(i);
  return out;
}

// SurveyMonkey custom variables: the response carries the school's RBD (Respuestas Test reads it) and the
// survey shows "Nombre, Comuna". Same format as the 2026 per-school links file. A link already carrying RBD is kept.
function linkColegio_(link, rbd, col) {
  if (/[?&]RBD=/i.test(link)) return link;
  const texto = col && col.nombre ? [col.nombre, col.comuna].filter(Boolean).join(', ').replace(/\s+/g, ' ').trim() : '';
  return link + (link.indexOf('?') >= 0 ? '&' : '?') + 'RBD=' + encUrl_(rbd) + (texto ? '&colegio=' + encUrl_(texto) : '');
}

function encUrl_(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase());
}

// A Formularios link may carry gaps filled per school: {rbd}, {colegio} (name only), {comuna}. Each survey names its
// own variables: EFA uses "…?rbd={rbd}&colegio={colegio}&comuna={comuna}" (+ "&k={rbd}" in ASE), as in the 2026 EFA
// links file. A gap with no SF value drops the link ('' → not shown): the survey would show a blank school.
const RE_HUECO = /\{(rbd|colegio|comuna)\}/gi;
function linkPlantilla_(link, rbd, col) {
  const valores = { rbd, colegio: col && col.nombre, comuna: col && col.comuna };
  let falta = false;
  const out = link.replace(RE_HUECO, (m, k) => {
    const v = String(valores[k.toLowerCase()] || '').replace(/\s+/g, ' ').trim();
    if (!v) falta = true;
    return encUrl_(v);
  });
  return falta ? '' : out;
}

// The school's own link for a Formularios row: gaps filled if it has them; otherwise Test adds RBD + colegio
// (linkColegio_) and EFA is shown as written.
function linkDe_(f, rbd, col) {
  if (f.link.search(RE_HUECO) >= 0) return linkPlantilla_(f.link, rbd, col);
  return f.encuesta === 'test' ? linkColegio_(f.link, rbd, col) : f.link;
}

// Short link shown as text in the portal (Test: also the instructivo and the messages): "<RBD>-<Form>" (e.g.
// "12885-REL-5-8" on /t/, "12885-REL-Consolidado" on /e/ for EFA) → the school's full link. Only if one of that
// school's SF programs matches a Formularios row of that survey with that Form, so a typo never opens a survey.
function linkCorto_(codigo, encuesta) {
  const m = String(codigo == null ? '' : codigo).trim().match(/^(\d+)-(.+)$/);
  if (!m) return { ok: false, error: 'link' };
  const rbd = normRbd_(m[1]);
  const d = cargarDatos_();
  const col = d.sf[rbd];
  // Separators ignored: "ASE-6-IV", "ASE_6-IV", "ASE6-IV" (an underlined link hides "_") all name ASE_6-IV
  const clave = s => normTexto_(s).replace(/[^a-z0-9]/g, '');
  const f = col ? [].concat.apply([], Object.keys(col.programas).map(k => formulariosDe_(d.formularios, encuesta || 'test', col.programas[k])))
    .find(x => x.link && clave(x.form) === clave(m[2])) : null;
  const link = f ? linkDe_(f, rbd, col) : '';
  return link ? { ok: true, link } : { ok: false, error: 'link' };
}

function links_(forms, rbd, col) {
  return forms.filter(f => f.link)
    .map(f => ({ form: f.form, desde: f.desde || null, hasta: f.hasta || null, link: linkDe_(f, rbd, col) }))
    .filter(l => l.link);
}

function bloqueTest_(p, testIdx, resps, studentId, letrasDe) {
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
      cursos: cursos_(p, i, lista, studentId, letrasDe ? letrasDe(i) : null),
    };
  });
  const resumen = { r: 0, rConEst: 0, est: 0 };
  niveles.forEach(n => {
    resumen.r += n.r;
    if (n.est) { resumen.rConEst += n.r; resumen.est += n.est; }
  });
  return { resumen, niveles };
}

// propias: the school's letters from the Letras tab (replace A, B, C… from CxN; the estimate is split among them)
function cursos_(p, i, resps, studentId, propias) {
  const registradas = propias || LETRAS.slice(0, Math.min(p.cxn[i], LETRAS.length));
  const nCursos = propias ? propias.length : p.cxn[i];
  const porLetra = agrupar_(resps, x => x.letra || '');
  const extra = Object.keys(porLetra).filter(l => l && registradas.indexOf(l) < 0).sort();
  const letras = registradas.concat(extra);
  if (porLetra['']) letras.push('');
  const porCurso = nCursos > 0 && p.alumnos[i] > 0 ? Math.round(p.alumnos[i] / nCursos) : 0;

  return letras.map(l => {
    const lista = porLetra[l] || [];
    const reg = registradas.indexOf(l) >= 0;
    // est: SF Alumnos ÷ CxN (or ÷ the Letras count) for the grade (an average per class), only for registered letters
    const curso = { letra: l || null, registrado: reg, r: lista.length, est: reg && porCurso ? porCurso : null };
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
  // A person can sit in two sections ("Cumplo todos los roles": Líderes and Docentes): listed in both, counted once
  const porSeccion = {};
  vigentes.forEach(x => x.secciones.forEach(id => (porSeccion[id] || (porSeccion[id] = [])).push(x)));
  const persona = x => ({ nombre: x.nombre, rol: x.rolCorto });
  const ordenadas = id => (porSeccion[id] || []).slice().sort((a, b) => rangoRol_(id, a.rolCorto) - rangoRol_(id, b.rolCorto) || porApellido_(a, b));

  // «Sin rol declarado» between Líderes and Docentes (Mau 17-11-2026), only when someone answered without a role
  const ids = porSeccion.sinrol ? ['direccion', 'lideres', 'sinrol', 'docentes'] : SECCIONES;
  const secciones = ids.map(id => {
    const s = { id, r: (porSeccion[id] || []).length };
    if (id === 'docentes' && p.programa === 'ase') s.niveles = nivelesDocentes_(p, ordenadas(id), persona);
    // REL docentes: flat list, so each person carries the grades they declared (canonical order)
    else if (id === 'docentes') s.personas = ordenadas(id).map(x => Object.assign(persona(x),
      { niveles: x.niveles.slice().sort((a, b) => a - b).map(i => NIVELES[i]) }));
    else s.personas = ordenadas(id).map(persona);
    return s;
  });
  // Each role is its own response (a docente who is also mentor answered twice). A response listed in two sections
  // ("Cumplo todos los roles") or a docente with several grades (listed under each grade) still counts once,
  // so Σ sections can exceed the total.
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

// Role options of the 2026 EFA surveys (Mau 29-10-2026), matched by how the option starts (case, accents and a
// leading "Soy" ignored: the EDI survey writes "Soy Docente e implemento…") → section(s) + short label shown.
// "Cumplo todos los roles" (REL) is a líder and a docente: listed in both sections, counted once. The survey asks
// them no grades (they answer like "Cumplo ambos roles"), so in Docentes they show with their label and no grades.
const ROLES_EFA = [
  ['director', ['direccion'], 'Director/a'],
  ['equipo directivo', ['direccion'], 'Equipo Directivo / Convivencia Escolar'], // EDI
  ['encargado', ['lideres'], 'Encargado/a'],
  ['mentor', ['lideres'], 'Mentor/a'],
  ['cumplo ambos roles', ['lideres'], 'Encargado/a y Mentor/a'],
  ['cumplo todos los roles', ['lideres', 'docentes'], 'Encargado/a, Mentor/a y Docente'],
  ['docente', ['docentes'], 'Docente'],
  ['profesor', ['docentes'], 'Docente'],
  ['otro/a lider', ['lideres'], 'Otro/a líder'],
];
// Order inside a section (Mau 29-10-2026): by role like an org chart, then by surname. In Docentes the plain docentes
// come first; "Encargado/a, Mentor/a y Docente" after them. Unknown roles last.
const ORDEN_ROLES = ['Director/a', 'Equipo Directivo / Convivencia Escolar', 'Encargado/a', 'Mentor/a', 'Encargado/a y Mentor/a',
  'Encargado/a, Mentor/a y Docente', 'Otro/a líder', 'Docente'];
function rangoRol_(seccion, corto) {
  if (seccion === 'docentes') return corto === 'Docente' ? 0 : 1;
  const i = ORDEN_ROLES.indexOf(corto);
  return i < 0 ? ORDEN_ROLES.length : i;
}

function rolEfa_(rol) {
  // No role: SurveyMonkey writes "-" (EFA-EDI without consent ends before the role question) or leaves it blank.
  // Own section «Sin rol declarado», only when it has people; never says why (Mau 01-11-2026)
  if (/^[\s\-–—]*$/.test(rol || '')) return { secciones: ['sinrol'], corto: null };
  const n = normTexto_(rol).replace(/^soy /, '');
  const r = ROLES_EFA.find(x => n.startsWith(x[0]));
  if (r) return { secciones: r[1], corto: r[2] };
  // An option not in the list (a survey edited later): Líderes, its text up to the first comma
  return { secciones: ['lideres'], corto: rol ? rol.split(',')[0].trim() : null };
}

// ── EDI: «Faltan por responder» (Mau 17-11-2026) ────────────
// Treated EDI programs see, above who answered (unchanged), the people expected in the EFA-EDI who don't appear yet:
// leaders from the SF report `Contactos EFA-EDI` (director, encargado, mentor, otro) and teachers of EDI grades from
// the `SDC` tab (seguimiento de clases), with or without an SF contact. SF docentes outside EDI grades, and contacts
// without a role, are not expected. A response (any role, consent or not) counts for a person by RUT (one digit more
// or less, or another check digit, allowed), email, or name: a given name and a surname in common (one typo allowed in
// long words), only when exactly one person fits and their RUTs don't contradict it. Emails and RUTs never leave the
// server; the payload carries names, the leader's role and the teacher's EDI grades and letters.

// What leerContactosEdi_ reads (Cloud Run downloads only these columns of the tab)
const COLS_CONTACTOS_EDI = ['Nombre para formulario', 'Implementación: Record Type', 'First Name', 'Last Name',
  'Rol en la Implementacióon', 'Rol en la Implementación', 'Email', 'RUT', 'Vigente 2026'];
function leerContactosEdi_() {
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.contactosEdi)) return null;
  const t = leerTabla_(TABS.contactosEdi);
  const c = { nombre: colExacta_(t, 'Nombre para formulario'), tipo: colExacta_(t, 'Implementación: Record Type'),
    rol: colsPrefijo_(t, 'Rol en la Implementaci', true), correo: colExacta_(t, 'Email'), rut: colExacta_(t, 'RUT'),
    nombres: colsPrefijo_(t, 'First Name', true), apellidos: colsPrefijo_(t, 'Last Name', true), vigente: t.headers.indexOf('Vigente 2026') };
  return t.rows
    .filter(r => !(c.vigente >= 0 && r[c.vigente] !== '' && r[c.vigente] != null && !esVerdadero_(r[c.vigente])))
    .map(r => ({
      rbd: rbdDeColegio_(r[c.nombre]),
      programa: programa_(r[c.tipo]),
      nombres: limpio_(primero_(r, c.nombres)),
      apellidos: limpio_(primero_(r, c.apellidos)),
      roles: rolesContacto_(primero_(r, c.rol)),
      correo: String(r[c.correo] == null ? '' : r[c.correo]).trim().toLowerCase(),
      rut: rutNorm_(r[c.rut]),
    }))
    .filter(x => x.rbd);
}

// SDC tab = IMPORTRANGE of the SdC "Compilado" (EDI schools, one row per teacher × class). Only EDI-grade rows are kept.
const COLS_SDC = ['RBD', 'Nombre', 'Apellido', 'Correo', 'Nivel', 'Letra', 'Nivel EDI'];
function leerSdc_() {
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.sdc)) return null;
  const t = leerTabla_(TABS.sdc);
  const c = {};
  COLS_SDC.forEach(h => { c[h] = colExacta_(t, h); });
  return t.rows
    .map(r => ({
      rbd: normRbd_(r[c.RBD]),
      nombres: limpio_(r[c.Nombre]),
      apellidos: limpio_(r[c.Apellido]),
      correo: String(r[c.Correo] == null ? '' : r[c.Correo]).trim().toLowerCase(),
      nivel: nivelIdx_(r[c.Nivel]),
      letra: letra_(r[c.Letra]),
      edi: esVerdadero_(r[c['Nivel EDI']]),
    }))
    .filter(x => x.rbd && x.edi && x.nivel >= 0 && (x.nombres || x.apellidos));
}

// "12.345.678-k" / 12345678 / "012345678K" → "12345678K"; '' when too short to be a RUT
function rutNorm_(v) {
  const s = String(v == null ? '' : v).replace(/[^0-9kK]/g, '').toUpperCase().replace(/^0+/, '');
  return s.length >= 7 ? s : '';
}

// Same RUT, allowing one typo seen in the real data: another check digit, or one digit more or less anywhere
function rutParecido_(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length === b.length) return a.length >= 8 && a.slice(0, -1) === b.slice(0, -1);
  const [c, l] = a.length < b.length ? [a, b] : [b, a];
  if (l.length - c.length !== 1 || c.length < 8) return false;
  for (let i = 0; i < l.length; i++) if (l.slice(0, i) + l.slice(i + 1) === c) return true;
  return false;
}

const PARTICULAS_NOMBRE = ['del', 'las', 'los', 'van', 'von'];
function palabrasNombre_(v) {
  return normTexto_(v).replace(/[^a-zñ ]/g, ' ').split(' ').filter(w => w.length >= 3 && PARTICULAS_NOMBRE.indexOf(w) < 0);
}

// Equal, or (both ≥ 5 letters) one letter changed, added, dropped, or two neighbours swapped ("galleogs" / "gallegos")
function palabraParecida_(a, b) {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const dif = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) dif.push(i);
    return dif.length === 1 || (dif.length === 2 && dif[1] === dif[0] + 1 && a[dif[0]] === b[dif[1]] && a[dif[1]] === b[dif[0]]);
  }
  const [c, l] = a.length < b.length ? [a, b] : [b, a];
  for (let i = 0; i < l.length; i++) if (l.slice(0, i) + l.slice(i + 1) === c) return true;
  return false;
}

const comparten_ = (xs, ys) => xs.some(x => ys.some(y => palabraParecida_(x, y)));

// Pure: one school-program → the expected people who don't appear among the responses (with their data, server side
// only), or null when neither list has the school. pendientesEdi_ turns it into the payload; the reminder emails use it too.
function faltanEdi_(rbd, p, d, resps) {
  if (!d.contactosEdi) return null;
  const contactos = d.contactosEdi.filter(x => x.rbd === rbd && x.programa === p.programa);
  const sdc = (d.sdc || []).filter(x => x.rbd === rbd);
  if (!contactos.length && !sdc.length) return null;

  const personas = [];
  const nueva = x => {
    const per = { nombres: x.nombres, apellidos: x.apellidos, dados: palabrasNombre_(x.nombres), apell: palabrasNombre_(x.apellidos),
      ruts: [], correos: [], vias: [], roles: [], clases: [], respondio: false };
    personas.push(per);
    return per;
  };
  const sumar = (per, x) => {
    if (x.rut && per.ruts.indexOf(x.rut) < 0) per.ruts.push(x.rut);
    if (x.correo && per.correos.indexOf(x.correo) < 0) per.correos.push(x.correo);
    (x.roles || []).forEach(r => { if (per.roles.indexOf(r) < 0) per.roles.push(r); });
    if (x.nivel != null && !per.clases.some(k => k.nivel === x.nivel && k.letra === x.letra)) per.clases.push({ nivel: x.nivel, letra: x.letra });
  };
  // A RUT joins only if the given names don't contradict it (Mau 17-11-2026: SF had two teachers with different first
  // names and one RUT; joined, the second one vanished from the list). Email joins as is.
  const otroNombre = (x, per) => { const dx = palabrasNombre_(x.nombres); return dx.length && per.dados.length && !comparten_(dx, per.dados); };
  const porDato = (lista, x) => lista.find(per => (x.rut && per.ruts.some(r => rutParecido_(r, x.rut)) && !otroNombre(x, per))
    || (x.correo && per.correos.indexOf(x.correo) >= 0));
  // Name match: a given name and a surname in common; never against a person whose RUT says otherwise; only if unique
  const porNombre = (lista, x) => {
    const dados = palabrasNombre_(x.nombres), apell = palabrasNombre_(x.apellidos);
    if (!dados.length || !apell.length) return null;
    const c = lista.filter(per => comparten_(dados, per.dados) && comparten_(apell, per.apell)
      && !(x.rut && per.ruts.length && !per.ruts.some(r => rutParecido_(r, x.rut))));
    return c.length === 1 ? c[0] : null;
  };
  // SF contacts first (repeated rows of one person become one), then the SDC teachers (joined to their contact if any)
  // vias: each address with how its record joined the person (own record, RUT/email, or name only)
  const unir = x => {
    let per = porDato(personas, x), via = 'dato';
    if (!per) { per = porNombre(personas, x); via = 'nombre'; }
    if (!per) { per = nueva(x); via = 'propio'; }
    if (x.correo && !per.vias.some(v => v.correo === x.correo)) per.vias.push({ correo: x.correo, via });
    sumar(per, x);
  };
  contactos.forEach(unir);
  sdc.forEach(unir);

  const LIDER = ['director', 'encargado', 'mentor', 'otros'];
  const esLider = per => per.roles.some(r => LIDER.indexOf(r) >= 0);
  const esperadas = personas.filter(per => esLider(per) || per.clases.length);
  resps.forEach(x => {
    const per = porDato(personas, { rut: x.run, correo: x.correo }) || porNombre(personas, { nombres: x.nombres, apellidos: x.apellidos, rut: x.run });
    if (per) per.respondio = true;
  });

  return { faltan: esperadas.filter(per => !per.respondio), esLider };
}

const nombreEdi_ = per => limpio_([per.nombres, per.apellidos].join(' '));
const etiquetaEdi_ = per => (per.roles.indexOf('director') >= 0 ? 'Director/a'
  : per.roles.indexOf('encargado') >= 0 && per.roles.indexOf('mentor') >= 0 ? 'Encargado/a y Mentor/a'
    : per.roles.indexOf('encargado') >= 0 ? 'Encargado/a' : per.roles.indexOf('mentor') >= 0 ? 'Mentor/a' : 'Otro/a líder');

// Payload: { total, lideres: [{nombre, rol}], docentes: [{nivel, personas: [{nombre, letras}]}] }, or null (no block shown)
function pendientesEdi_(rbd, p, d, resps) {
  const f = faltanEdi_(rbd, p, d, resps);
  if (!f) return null;
  const { faltan, esLider } = f;
  const nombre = nombreEdi_, etiqueta = etiquetaEdi_;
  const lideres = faltan.filter(esLider)
    .sort((a, b) => rangoRol_('lideres', etiqueta(a)) - rangoRol_('lideres', etiqueta(b)) || porApellido_(a, b))
    .map(per => ({ nombre: nombre(per), rol: etiqueta(per) }));
  const docentesPer = faltan.filter(per => !esLider(per));
  const niveles = [];
  docentesPer.forEach(per => per.clases.forEach(k => { if (niveles.indexOf(k.nivel) < 0) niveles.push(k.nivel); }));
  const docentes = niveles.sort((a, b) => a - b).map(i => ({
    nivel: NIVELES[i],
    personas: docentesPer.filter(per => per.clases.some(k => k.nivel === i)).sort(porApellido_)
      .map(per => ({ nombre: nombre(per), letras: per.clases.filter(k => k.nivel === i && k.letra).map(k => k.letra).sort() })),
  }));
  return { total: faltan.length, lideres, docentes };
}

// Optional extra week (Config `<encuesta>_extension`, Mau 12-11-2026): the closing date stays what schools were told
// (`cierra`); between the day after it and `extension` the survey is in phase 'extra' (still open, shown as an extra
// week, days left counted to `extension`); after it, closed. An extension not after `cierra` is ignored.
function ventana_(abreRaw, cierraRaw, hoy, extensionRaw) {
  const abre = fechaIso_(abreRaw);
  const cierra = fechaIso_(cierraRaw);
  if (!abre || !cierra) return { abre, cierra, fase: null, diasRestantes: null };
  const ext = fechaIso_(extensionRaw);
  const extension = ext && ext > cierra ? ext : null;
  const fase = hoy < abre ? 'pre' : hoy <= cierra ? 'open' : extension && hoy <= extension ? 'extra' : 'closed';
  const v = { abre, cierra, fase, diasRestantes: fase === 'open' ? diasEntre_(hoy, cierra) : fase === 'extra' ? diasEntre_(hoy, extension) : null };
  if (extension) v.extension = extension;
  return v;
}

function registrarMetrica_(res, interno) {
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.metricas);
    if (!sh) return;
    sh.appendRow([
      new Date(),
      res.colegio.rbd,
      res.programas.map(p => p.programa.toUpperCase()).join(','),
      res.programas.every(p => p.test.ok),
      res.programas.every(p => p.efa.ok),
      interno ? 'login_interno' : 'login',
    ]);
  } catch (err) {
    console.error('Métricas: ' + (err && err.message));
  }
}

// Usage events sent by the portal, once per session each. Fixed list: anything else is ignored.
const EVENTOS = ['ver_efa',
  'test_copiar_link', 'test_copiar_mensaje', 'test_whatsapp', 'test_qr', 'test_instructivo', 'test_copiar_lista', 'test_whatsapp_lista',
  'efa_copiar_link', 'efa_copiar_mensaje', 'efa_whatsapp', 'efa_qr'];

function registrarEvento_(rbd, body, interno) {
  const programa = body.programa == null ? '' : String(body.programa);
  if (EVENTOS.indexOf(body.evento) < 0 || ['', 'ase', 'rel'].indexOf(programa) < 0) return { ok: false, error: 'evento' };
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.metricas);
    if (sh) sh.appendRow([new Date(), rbd, programa.toUpperCase(), '', '', body.evento + (interno ? '_interno' : '')]);
  } catch (err) {
    console.error('Métricas: ' + (err && err.message));
  }
  return { ok: true };
}

// ── Seguimiento interno (team tracker; Cloud Run writes it to a separate Sheet) ─
// Counts only, never names: one row per school-program (Resumen) and one per class (Por curso), built with panel_()
// so every number matches what the school sees. Plus the announcement email date (Correos Test → Enviado) and
// portal use (Métricas). The tracker Sheet holds no claves or emails, so the team can open it.

const SEG_TABS = { resumen: 'Resumen', cursos: 'Por curso' };
// Cloud Run rewrites the tracker after every snapshot (every 2 min) from desde to hasta h (Santiago); otherwise once per hour
const SEG_HORARIO = { desde: 8, hasta: 18 };
const SEG_ACCIONES = { test_copiar_link: 'link', test_copiar_mensaje: 'mensaje', test_whatsapp: 'WhatsApp', test_qr: 'QR',
  test_instructivo: 'instructivo', test_copiar_lista: 'lista por curso', test_whatsapp_lista: 'lista por curso' };
const SEG_RESUMEN = ['RBD', 'Colegio', 'Programa', 'Modelo', 'EDI', 'Jefe/a de Proyecto', 'Coordinador/a', 'Correo enviado',
  'Ingresos al portal', 'Último ingreso', 'Compartió el Test', 'Respuestas', 'Estimado', '%', 'Cursos sin respuestas'];
const SEG_CURSOS = ['RBD', 'Colegio', 'Programa', 'Modelo', 'Jefe/a de Proyecto', 'Coordinador/a', 'Nivel', 'Curso', 'Respuestas', 'Estimado', '%', 'Registrado'];

// Extra sources, each optional (missing tab or header → blank columns). Cloud Run reads only RBD + Enviado of the
// Correos tabs, and only COLS_CONTACTOS_EFA of Contactos EFA (no names).
function datosSeguimiento_() {
  const hay = n => !!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(n);
  const enviados = tab => (hay(tab) ? intentar_(tab, () => {
    const t = leerTabla_(tab);
    const cR = colExacta_(t, 'RBD'), cE = colExacta_(t, 'Enviado');
    const out = {};
    t.rows.forEach(r => { const rbd = normRbd_(r[cR]); if (rbd && r[cE] !== '' && r[cE] != null) out[rbd] = r[cE]; });
    return out;
  }, {}) : {});
  return {
    enviados: enviados(TAB_CORREOS),
    enviadosEfa: enviados(TAB_CORREOS_EFA),
    contactos: hay(TAB_CONTACTOS_EFA) ? intentar_(TAB_CONTACTOS_EFA, leerContactosEfa_, null) : null, // null = no expected counts
    ajustes: hay(TAB_AJUSTES_EFA) ? intentar_(TAB_AJUSTES_EFA, leerAjustesEfa_, {}) : {}, // hand adjustments (Mau 12-11-2026)
    // EFA tracker's Destinatarios tab (Mau 06-11-2026: nothing in the portal Sheet is secret within Trabün)
    encargados: hay(TAB_ENCARGADOS) ? intentar_(TAB_ENCARGADOS, leerEncargados_, null) : null,
    correosJdp: hay(TAB_CORREOS_JDP) ? intentar_(TAB_CORREOS_JDP, leerCorreosJdp_, {}) : {},
    claves: intentar_(TABS.claves, leerClaves_, {}),
    metricas: intentar_(TABS.metricas, () => {
      const t = leerTabla_(TABS.metricas);
      const c = { ts: colExacta_(t, 'timestamp'), rbd: colExacta_(t, 'rbd'), prog: colExacta_(t, 'programas'), ev: colExacta_(t, 'evento') };
      return t.rows.map(r => ({ ms: ms_(r[c.ts]), rbd: normRbd_(r[c.rbd]), programa: programa_(r[c.prog]), evento: String(r[c.ev]).trim() }))
        .filter(x => x.rbd);
    }, []),
  };
}

// Pure: loaded data (cargarDatos_) + datosSeguimiento_() →
//   { tabs: { Resumen: rows, 'Por curso': rows }, notas: { tab: [[row, col, text]] }, formato: { tab: { gris: [cols] } } };
// rows 0–1 = status lines, row 2 = header; notas (0-based cells) explain unexpected cases with the portal's wording;
// gris = columns shaded gray, so each grade's resp. + est. pair reads as one block (alternating gray / white).
// null when responses could not be read (the caller keeps the previous tracker instead of writing zeros).
function seguimiento_(d, s, reloj) {
  if (!d.test) return null;
  const porRbd = agrupar_(d.test, x => x.rbd);
  const uso = {};
  s.metricas.forEach(m => {
    const u = uso[m.rbd] || (uso[m.rbd] = { ingresos: 0, ultimo: null, acciones: { ase: [], rel: [] } });
    if (m.evento === 'login') {
      u.ingresos++;
      if (m.ms != null && (u.ultimo == null || m.ms > u.ultimo)) u.ultimo = m.ms;
    } else if (SEG_ACCIONES[m.evento] && u.acciones[m.programa] && u.acciones[m.programa].indexOf(SEG_ACCIONES[m.evento]) < 0) {
      u.acciones[m.programa].push(SEG_ACCIONES[m.evento]);
    }
  });
  const conFormato = (ms, conHora) => (ms == null ? '' : Utilities.formatDate(new Date(ms), TZ, conHora ? 'dd-MM-yyyy HH:mm' : 'dd-MM-yyyy'));
  // A cell value (Date, serial number or text): a date if it reads as one, otherwise the text as is
  const fecha = (v, conHora) => { const ms = ms_(v); return ms != null ? conFormato(ms, conHora) : v === '' || v == null ? '' : String(v); };
  const corto = n => n.split(' ')[0]; // "7° básico" → "7°", "I° medio" → "I°"
  const pct = (r, est) => (est ? Math.round(r / est * 1000) / 1000 : '');
  const miles = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const resp = n => miles(n) + (n === 1 ? ' respuesta' : ' respuestas');
  // Why a grade is outside the registered ones (same three cases the portal folds into "Fuera de lo registrado")
  const porQue = (p, t, nivel) => (t.nivelesPapel.indexOf(nivel) >= 0 ? 'este nivel hace el test en papel (Agencia Focus)'
    : p.nivelesImplementados.indexOf(nivel) >= 0 ? 'este nivel no tiene Test en línea para el colegio'
      : 'SF no tiene este nivel en el programa');

  const filas = [];
  Object.keys(d.sf).forEach(rbd => {
    const res = panel_(rbd, Object.assign({}, d, { test: porRbd[rbd] || [], efa: null }), reloj);
    res.programas.forEach(p => {
      const t = p.test;
      if (!t.niveles.length || (normTexto_(p.modelo) === 'control' && !t.resumen.r)) return; // paper-only, no Test, Control
      filas.push({ rbd, col: res.colegio, p, t, u: uso[rbd] || { ingresos: 0, ultimo: null, acciones: { ase: [], rel: [] } } });
    });
  });
  filas.sort((a, b) => compararTexto_(a.p.jefeProyecto, b.p.jefeProyecto) || compararTexto_(a.col.nombre, b.col.nombre)
    || (a.p.programa < b.p.programa ? -1 : a.p.programa > b.p.programa ? 1 : 0));

  // Grade columns: every grade that shows up (registered, seen or on paper), canonical order
  const vistos = {};
  filas.forEach(f => f.t.niveles.concat(f.t.nivelesPapel.map(n => ({ nivel: n }))).forEach(n => { vistos[nivelIdx_(n.nivel)] = true; }));
  const columnas = Object.keys(vistos).map(Number).sort((a, b) => a - b);

  const prog = p => (p.programa === 'ase' ? 'ASE' : 'REL');
  const estado = [['Actualizado: ' + conFormato(ms_(reloj.generado), true)],
    [`Actualización automática cada 2 minutos de ${SEG_HORARIO.desde}:00 a ${SEG_HORARIO.hasta}:00, y una vez por hora el resto del día.`]];
  // Two numeric columns per grade (responses, estimate) so the team can add them up
  const resumen = estado.concat([SEG_RESUMEN.concat([].concat.apply([], columnas.map(i => [NIVELES[i] + ' resp.', NIVELES[i] + ' est.'])))]);
  const cursos = estado.concat([SEG_CURSOS.slice()]);
  const notasR = [], notasC = [];
  const base = SEG_RESUMEN.length, cPct = SEG_RESUMEN.indexOf('%');
  const cC = { curso: SEG_CURSOS.indexOf('Curso'), r: SEG_CURSOS.indexOf('Respuestas'), est: SEG_CURSOS.indexOf('Estimado'), reg: SEG_CURSOS.indexOf('Registrado') };
  filas.forEach(f => {
    const { t, p } = f;
    const fila = resumen.length;
    columnas.forEach((i, k) => {
      const nivel = NIVELES[i], n = t.niveles.find(x => x.nivel === nivel);
      const cR = base + 2 * k, cE = cR + 1;
      if (!n) { if (t.nivelesPapel.indexOf(nivel) >= 0) notasR.push([fila, cR, 'Test en papel · a cargo de la Agencia Focus.']); return; }
      if (!n.registrado) notasR.push([fila, cE, `Fuera de lo registrado: ${porQue(p, t, nivel)}, pero hay ${resp(n.r)}. ${n.r === 1 ? 'Cuenta' : 'Cuentan'} en Respuestas, no en el %.`]);
      else if (!n.est) notasR.push([fila, cE, 'Sin estimado: SF no tiene Alumnos para este nivel. No cuenta en el %.']);
      else if (n.r > n.est) notasR.push([fila, cR, `${miles(n.r - n.est)} sobre lo estimado (estimado: ${miles(n.est)}).`]);
    });
    if (t.resumen.est && t.resumen.rConEst < t.resumen.r) {
      notasR.push([fila, cPct, `El % considera solo los niveles con estimado: ${miles(t.resumen.rConEst)} de ${resp(t.resumen.r)}.`]);
    }
    const pendientes = [];
    t.niveles.filter(n => n.registrado).forEach(n => {
      const reg = n.cursos.filter(c => c.registrado);
      if (reg.length) reg.filter(c => !c.r).forEach(c => pendientes.push(corto(n.nivel) + c.letra));
      else if (!n.r) pendientes.push(n.nivel);
    });
    // [resp., est.]: text only where there is no number (SUM ignores it)
    const celdas = i => {
      const n = t.niveles.find(x => x.nivel === NIVELES[i]);
      if (n) return [n.r, !n.registrado ? 'Fuera de lo registrado' : n.est || ''];
      return [t.nivelesPapel.indexOf(NIVELES[i]) >= 0 ? 'Papel' : '', ''];
    };
    resumen.push([Number(f.rbd), f.col.nombre || '', prog(p), p.modelo || '', p.edi ? 'SÍ' : '', p.jefeProyecto || '', p.coordinador || '',
      fecha(s.enviados[f.rbd], false), f.u.ingresos, conFormato(f.u.ultimo, true),
      f.u.acciones[p.programa].join(', '), t.resumen.r, t.resumen.est || '', pct(t.resumen.rConEst, t.resumen.est),
      pendientes.join(', ')].concat([].concat.apply([], columnas.map(celdas))));
    t.niveles.forEach(n => n.cursos.forEach(c => {
      const fc = cursos.length;
      if (!c.letra) {
        notasC.push([fc, cC.curso, 'Respuestas sin letra de curso.'], [fc, cC.reg, 'Respuestas sin letra de curso: no se pueden asignar a un curso.']);
      } else if (!n.registrado) {
        notasC.push([fc, cC.reg, `Curso no registrado: ${porQue(p, t, n.nivel)}.`]);
      } else if (!c.registrado) {
        const reg = n.cursos.filter(x => x.registrado).map(x => x.letra);
        notasC.push([fc, cC.reg, letrasDe_(d, f.rbd, p.programa, nivelIdx_(n.nivel)) ? `Curso no registrado: la pestaña Letras tiene ${reg.join(', ')} en ${n.nivel}.`
          : reg.length ? `Curso no registrado: SF tiene ${reg.length} ${reg.length === 1 ? 'curso' : 'cursos'} en ${n.nivel} (${reg.join(', ')}).`
          : `Curso no registrado: SF no tiene cursos (CxN) para ${n.nivel}.`]);
      } else if (!c.est) {
        notasC.push([fc, cC.est, letrasDe_(d, f.rbd, p.programa, nivelIdx_(n.nivel)) ? 'Sin estimado: falta Alumnos en SF.' : 'Sin estimado: falta Alumnos o CxN en SF.']);
      } else if (c.r > c.est) {
        notasC.push([fc, cC.r, `${miles(c.r - c.est)} sobre lo estimado.`]);
      }
      cursos.push([Number(f.rbd), f.col.nombre || '', prog(p), p.modelo || '', p.jefeProyecto || '', p.coordinador || '', n.nivel,
        c.letra ? corto(n.nivel) + ' ' + c.letra : 'Sin letra', c.r, c.est || '', pct(c.r, c.est),
        n.registrado && c.registrado ? 'Sí' : 'Fuera de lo registrado']);
    }));
  });
  const tabs = {}, notas = {}, formato = {};
  tabs[SEG_TABS.resumen] = resumen;
  tabs[SEG_TABS.cursos] = cursos;
  notas[SEG_TABS.resumen] = notasR;
  notas[SEG_TABS.cursos] = notasC;
  formato[SEG_TABS.resumen] = { gris: [].concat.apply([], columnas.map((_, k) => (k % 2 ? [] : [base + 2 * k, base + 2 * k + 1]))) };
  formato[SEG_TABS.cursos] = { gris: [] };
  return { tabs, notas, formato };
}

// ── Seguimiento EFA (team tracker for the EFA; Cloud Run writes it to its own Sheet, SEGUIMIENTO_EFA_ID) ─
// One row per school-program with EFA: what each person answered (the portal's responses, by role) against what
// Salesforce has (contacts per role, refreshed every 4 hours: if a number doesn't fit, it is fixed in SF, never here).
// Counts only, never names or emails.

const SEG_EFA_TAB = 'Resumen';
const SEG_EFA_JDP = 'Por JdP', SEG_EFA_PROG = 'Por programa';
const SEG_EFA_DEST_TAB = 'Destinatarios'; // recipients + clave per school and JdP, read by gas-seguimiento/
const SEG_EFA_DEST = ['RBD', 'Colegio', 'Programas', 'Jefe/a de Proyecto', 'Correo JdP', 'Para', 'Nombres', 'CC', 'Clave', 'Cierre EFA', 'Fase EFA', 'Ajustes internos', 'Observaciones']; // sums of Resumen rows (2025 tracker's Resumen JdP / Resumen Programa)
const SEG_EFA_SUMA = ['Implementaciones', 'Impl. con al menos 1 respuesta', 'Respuestas'];
// SF report "Contactos EFA '26 (seguimiento)" through the Salesforce connector (every 4 hours). Cloud Run downloads only these
// columns: Email only to spot repeated contacts, never written. SF labels the role field "Implementacióon" (typo).
const TAB_CONTACTOS_EFA = 'Contactos EFA';
const COLS_CONTACTOS_EFA = ['Nombre para formulario', 'Implementación: Record Type', 'Rol en la Implementacióon', 'Rol en la Implementación', 'Email',
  'First Name', 'Last Name']; // names only to match a response whose email differs from SF's (first word of each); never written
// Hand adjustments to the EFA tracker (Mau 12-11-2026), kept in the portal Sheet so the reasons (leaves…) never reach
// this public repo: RBD | Programa | Rol | Esperado | Motivo (extra columns ignored). CONTRACT.md §1 and §5.
const TAB_AJUSTES_EFA = 'Ajustes EFA';
const SEG_ACCIONES_EFA = { efa_copiar_link: 'link', efa_copiar_mensaje: 'mensaje', efa_whatsapp: 'WhatsApp', efa_qr: 'QR' };
// Tracker roles (as in the 2025 EFA tracker). A response or a contact counts in every role it holds.
const SEG_COL_CONTACTOS = 'Contactos en SF (sin ajustes)'; // raw SF count, not the expected total (Mau 05-11-2026)
const SEG_ESPERADO_MINIMO = ['director', 'encargado']; // roles every school has: expected 1 when SF has none
const SEG_SIN_LIDERES_CUADERNILLOS = ['encargado', 'mentor']; // REL Cuadernillos: expected 0, whatever SF says
const SEG_ROLES_EFA = [['director', 'Director/a'], ['encargado', 'Encargado/a'], ['mentor', 'Mentor/a'], ['otros', 'Otros líderes'], ['docente', 'Docentes']];
const ROLES_SEG_EFA = { // ROLES_EFA short label → tracker roles; an unknown option → Otros líderes, no role → none
  'Director/a': ['director'], 'Equipo Directivo / Convivencia Escolar': ['otros'], 'Encargado/a': ['encargado'], 'Mentor/a': ['mentor'],
  'Encargado/a y Mentor/a': ['encargado', 'mentor'], 'Encargado/a, Mentor/a y Docente': ['encargado', 'mentor', 'docente'],
  'Otro/a líder': ['otros'], 'Docente': ['docente'],
};
const SEG_EFA = ['RBD', 'Colegio', 'Programa', 'Modelo', 'EDI', 'Jefe/a de Proyecto', 'Coordinador/a', 'Correo enviado',
  'Ingresos desde la apertura', 'Último ingreso', 'Compartió la EFA', SEG_COL_CONTACTOS, 'Respuestas'];

function leerContactosEfa_() {
  const t = leerTabla_(TAB_CONTACTOS_EFA);
  const c = { nombre: colExacta_(t, 'Nombre para formulario'), tipo: colExacta_(t, 'Implementación: Record Type'),
    rol: colsPrefijo_(t, 'Rol en la Implementaci', true), correo: colExacta_(t, 'Email'),
    nombre1: colsPrefijo_(t, 'First Name'), apellido1: colsPrefijo_(t, 'Last Name') };
  return t.rows.filter(r => r.some(v => v !== '' && v != null)).map(r => ({
    rbd: rbdDeColegio_(r[c.nombre]), // SF "- - 0" = the contact's account is not a school
    programa: programa_(r[c.tipo]),
    rol: limpio_(primero_(r, c.rol)),
    roles: rolesContacto_(primero_(r, c.rol)),
    correo: String(r[c.correo] == null ? '' : r[c.correo]).trim().toLowerCase(),
    nombre: primeraPalabra_(primero_(r, c.nombre1)),
    apellido: primeraPalabra_(primero_(r, c.apellido1)),
  }));
}

const primeraPalabra_ = v => normTexto_(v).split(' ')[0] || '';

// Ajustes EFA → { 'rbd|programa': { roles: { role: { n, motivo } }, niveles: { gradeIdx: motivo } } }. Rol = a tracker
// role (its expected count becomes Esperado, over SF, the automatic 1 and REL Cuadernillos) or an ASE grade (no
// teacher expected there: out of "Niveles sin docentes", with a note). Rows that can't be read are skipped.
function leerAjustesEfa_() {
  const t = leerTabla_(TAB_AJUSTES_EFA);
  const c = { rbd: colExacta_(t, 'RBD'), prog: colExacta_(t, 'Programa'), rol: colExacta_(t, 'Rol'), esp: colExacta_(t, 'Esperado'), motivo: colsPrefijo_(t, 'Motivo') };
  const out = {};
  t.rows.forEach(r => {
    const rbd = normRbd_(r[c.rbd]), pr = normTexto_(r[c.prog]);
    const programa = pr.startsWith('ase') ? 'ase' : pr.startsWith('rel') ? 'rel' : null;
    if (!rbd || !programa) return;
    const motivo = String(limpio_(primero_(r, c.motivo)) || '').replace(/[.\s]+$/, '');
    const k = rolAjuste_(r[c.rol]);
    const o = out[rbd + '|' + programa] || (out[rbd + '|' + programa] = { roles: {}, niveles: {} });
    if (k) {
      const v = r[c.esp], n = Number(v);
      if (v !== '' && v != null && isFinite(n) && n >= 0) o.roles[k] = { n: Math.round(n), motivo };
      return;
    }
    const i = nivelIdx_(r[c.rol]);
    if (i >= 0) o.niveles[i] = motivo;
  });
  return out;
}

function rolAjuste_(v) {
  const n = normTexto_(v);
  return [['director', 'director'], ['encargad', 'encargado'], ['mentor', 'mentor'], ['otro', 'otros'], ['docente', 'docente']]
    .filter(x => n.startsWith(x[0])).map(x => x[1])[0] || null;
}

// SF "Rol en la Implementación" ("Docente", "Mentor/a y Encargado/a", "Encargado/a, Docente y Mentor/a"…) → tracker roles
function rolesContacto_(v) {
  const n = normTexto_(v);
  return [['director', 'director'], ['encargad', 'encargado'], ['mentor', 'mentor'], ['otro', 'otros'], ['docente', 'docente']]
    .filter(x => n.indexOf(x[0]) >= 0).map(x => x[1]);
}

// Pure: loaded data (cargarDatos_) + datosSeguimiento_() → { tabs: { Resumen: rows }, notas, formato } like seguimiento_();
// notes also on the header row (what a column means). null when EFA responses could not be read (keep the old tracker).
function seguimientoEfa_(d, s, reloj) {
  if (!d.efa) return null;
  const abre = ventana_((d.cfg || {}).efa_abre, (d.cfg || {}).efa_cierra, reloj.hoy).abre;
  const dia = ms => Utilities.formatDate(new Date(ms), TZ, 'yyyy-MM-dd');
  const ddmm = iso => iso.split('-').reverse().join('-');
  const conFormato = (ms, conHora) => (ms == null ? '' : Utilities.formatDate(new Date(ms), TZ, conHora ? 'dd-MM-yyyy HH:mm' : 'dd-MM-yyyy'));
  const fecha = v => { const ms = ms_(v); return ms != null ? conFormato(ms, false) : v === '' || v == null ? '' : String(v); };
  const miles = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const pl = (n, uno, varios) => miles(n) + ' ' + (n === 1 ? uno : varios);
  const pct = (r, e) => (e ? Math.round(r / e * 1000) / 1000 : '');
  const corto = n => n.split(' ')[0];

  const uso = {};
  s.metricas.forEach(m => {
    const u = uso[m.rbd] || (uso[m.rbd] = { ingresos: 0, ultimo: null, acciones: { ase: [], rel: [] } });
    if (m.evento === 'login') {
      if (m.ms != null && (!abre || dia(m.ms) >= abre)) u.ingresos++;
      if (m.ms != null && (u.ultimo == null || m.ms > u.ultimo)) u.ultimo = m.ms;
    } else if (SEG_ACCIONES_EFA[m.evento] && u.acciones[m.programa] && u.acciones[m.programa].indexOf(SEG_ACCIONES_EFA[m.evento]) < 0) {
      u.acciones[m.programa].push(SEG_ACCIONES_EFA[m.evento]);
    }
  });

  // SF contacts per school-program, as SF has them (nothing removed); emails only to spot repeats
  const contactos = s.contactos ? agrupar_(s.contactos.filter(x => x.rbd && (x.programa === 'ase' || x.programa === 'rel')), x => x.rbd + '|' + x.programa) : null;
  const sinColegio = s.contactos ? s.contactos.filter(x => !x.rbd).length : 0;
  const colegiosDe = {}; // email|programa → RBDs where it appears
  (s.contactos || []).forEach(x => {
    if (!x.correo || !x.rbd) return;
    const l = colegiosDe[x.correo + '|' + x.programa] || (colegiosDe[x.correo + '|' + x.programa] = []);
    if (l.indexOf(x.rbd) < 0) l.push(x.rbd);
  });

  // Responses the tracker can't place (the portal doesn't show them either)
  const fuera = { control: 0, sf: 0, programa: 0 };
  d.efa.forEach(x => {
    const col = d.sf[x.rbd], p = col && col.programas[x.programa];
    if (!col) fuera.sf++; else if (!p) fuera.programa++; else if (normTexto_(p.modelo) === 'control') fuera.control++;
  });

  const efaPorRbd = agrupar_(d.efa, x => x.rbd);
  const filas = [];
  Object.keys(d.sf).forEach(rbd => {
    const res = panel_(rbd, Object.assign({}, d, { test: null, efa: efaPorRbd[rbd] || [] }), reloj);
    res.programas.forEach(p => {
      const sp = d.sf[rbd].programas[p.programa];
      if (normTexto_(sp.modelo) === 'control' || (!p.efa.links.length && !p.efa.total)) return; // no EFA for this program
      const resps = (efaPorRbd[rbd] || []).filter(x => x.programa === p.programa); // same rows as the panel
      filas.push({ rbd, col: res.colegio, p, sp, resps, vig: dedupEfa_(resps), u: uso[rbd] || { ingresos: 0, ultimo: null, acciones: { ase: [], rel: [] } } });
    });
  });
  filas.sort((a, b) => compararTexto_(a.sp.jefeProyecto, b.sp.jefeProyecto) || compararTexto_(a.col.nombre, b.col.nombre)
    || (a.p.programa < b.p.programa ? -1 : a.p.programa > b.p.programa ? 1 : 0));

  // ASE docentes by grade: every grade that shows up (implemented or declared), canonical order
  const gruposDe = f => (f.p.programa === 'ase' ? f.p.efa.secciones.find(x => x.id === 'docentes').niveles.filter(n => n.nivel) : []);
  const vistos = {};
  filas.forEach(f => gruposDe(f).forEach(n => { vistos[nivelIdx_(n.nivel)] = true; }));
  const columnas = Object.keys(vistos).map(Number).sort((a, b) => a - b);

  const base = SEG_EFA.length, cRol = base, cNiv = base + 3 * SEG_ROLES_EFA.length, cGrado = cNiv + 1;
  const col = nombre => SEG_EFA.indexOf(nombre);
  const encabezado = SEG_EFA.concat([].concat.apply([], SEG_ROLES_EFA.map(r => [r[1] + ' resp.', r[1] + ' esp.', r[1] + ' %'])),
    ['Niveles sin docentes'], [].concat.apply([], columnas.map(i => [NIVELES[i] + ' resp.', NIVELES[i] + ' cursos'])));
  const tab = [['Actualizado: ' + conFormato(ms_(reloj.generado), true)],
    [`Actualización automática cada 2 minutos de ${SEG_HORARIO.desde}:00 a ${SEG_HORARIO.hasta}:00, y una vez por hora el resto del día.`], encabezado];
  const notas = [];
  const nota = (fila, c, lineas) => { // several notes on one cell → one note, one line each
    const l = lineas.filter(Boolean);
    if (!l.length) return;
    const n = notas.find(x => x[0] === fila && x[1] === c);
    if (n) n[2] += '\n' + l.join('\n'); else notas.push([fila, c, l.join('\n')]);
  };

  // Header notes: what a column means
  const noMuestran = [fuera.control && pl(fuera.control, 'respuesta de un programa Control', 'respuestas de programas Control'),
    fuera.sf && pl(fuera.sf, 'respuesta de un RBD que no está en SF (pruebas incluidas)', 'respuestas de RBD que no están en SF (pruebas incluidas)'),
    fuera.programa && pl(fuera.programa, 'respuesta de un programa que el colegio no tiene en SF', 'respuestas de programas que el colegio no tiene en SF')].filter(Boolean);
  nota(2, col('Ingresos desde la apertura'), [`Ingresos al portal${abre ? ' desde el ' + ddmm(abre) : ''}, en cualquier pestaña. Las vistas internas no cuentan.`]);
  nota(2, col(SEG_COL_CONTACTOS), [s.contactos ? 'Contactos vigentes de la implementación en el reporte de Salesforce («Contactos EFA \'26 (seguimiento)», que el seguimiento lee cada 4 horas), tal como están. '
    + 'No es el total esperado: los esperados por rol incluyen ajustes (1 automático en Director/a y Encargado/a, 0 en Encargado/a y Mentor/a de REL Cuadernillos, y ajustes acordados para algunos colegios en la pestaña ' + TAB_AJUSTES_EFA + ', cada uno con su comentario) y un contacto con varios roles cuenta en cada uno. '
    + 'Si un número no calza, corrígelo en Salesforce.'
    : `Falta la pestaña ${TAB_CONTACTOS_EFA} en la planilla: sin esperados.`,
  sinColegio ? pl(sinColegio, 'contacto no tiene colegio en Salesforce y no se puede asignar.', 'contactos no tienen colegio en Salesforce y no se pueden asignar.') : '']);
  nota(2, col('Respuestas'), ['Respuestas después de quitar envíos repetidos (mismo correo y rol; cuenta el más reciente). Quien responde más de una vez la encuesta, con un rol distinto cada vez, suma una respuesta por envío; una opción con varios roles («Encargado/a y Mentor/a», «Cumplo todos los roles») es una sola respuesta.',
    noMuestran.length ? 'No se muestran: ' + noMuestran.join(', ') + '.' : '']);
  nota(2, cRol + 9, ['Otro/a líder y, en EFA-EDI, Equipo Directivo / Convivencia Escolar (en el portal aparece en Dirección).']);
  nota(2, cNiv, ['ASE: niveles implementados sin respuestas de docentes.']);
  if (columnas.length) nota(2, cGrado, ['Docentes que declararon el nivel (ASE). Un docente con varios niveles cuenta en cada uno; quien hace clases pero respondió solo con otro rol no aparece aquí. cursos = CxN en SF: contexto, no esperado (un docente puede tener varios cursos).']);

  const prog = p => (p.programa === 'ase' ? 'ASE' : 'REL');
  // SurveyMonkey writes "-" for an unanswered question (EFA-EDI without consent ends before the role): no role
  const rolSeg = x => (/^[\s\-–—]*$/.test(x.rol || '') ? null : x.rolCorto);
  // never says why (Mau 03-11-2026): only the count, in the Respuestas note
  const sinRolTexto = n => (n ? `${pl(n, 'respuesta sin rol: cuenta', 'respuestas sin rol: cuentan')} en Respuestas totales, pero no en la desagregación por rol.` : '');
  // Roles counted from SF (Mau 12-11-2026, CONTRACT.md §1): a response is matched to its SF contact in the same
  // school-program (email; else first name + first surname, one person only). Regular programs: someone with several
  // roles answers once (with the highest one), so a response in one of their SF roles counts in all of them. EFA-EDI:
  // leaders all get the same questions, so a leader response counts in their SF leader roles instead of the one picked;
  // a leader who teaches an EDI grade answers as a teacher, so that response counts in their leader roles too; and a
  // response without a role counts in their SF roles. A person counts once per role.
  const LIDERES = ['director', 'encargado', 'mentor', 'otros'];
  const union = (a, b) => a.concat(b.filter(k => a.indexOf(k) < 0));
  filas.forEach(f => {
    const { p, sp, vig } = f;
    const fila = tab.length;
    const declarados = x => (rolSeg(x) ? ROLES_SEG_EFA[rolSeg(x)] || ['otros'] : []);
    const lista = contactos ? contactos[f.rbd + '|' + p.programa] || [] : null;
    const edi = p.programa === 'ase' && !!sp.edi;
    const papel = edi ? (PAPEL_EDI[sp.anioInicio] || []).map(nivelIdx_) : [];
    const rolesSf = x => { // the SF roles of the respondent, or null when not found
      if (!lista) return null;
      const deCorreo = x.correo ? lista.filter(c => c.correo === x.correo && c.roles.length) : [];
      const n = primeraPalabra_(x.nombres), a = primeraPalabra_(x.apellidos);
      const deNombre = deCorreo.length || !n || !a ? [] : lista.filter(c => c.roles.length && c.nombre === n && c.apellido === a);
      const m = deCorreo.length ? deCorreo : new Set(deNombre.map(c => c.correo)).size === 1 ? deNombre : [];
      return m.length ? m.reduce((t, c) => union(t, c.roles), []) : null;
    };
    const rolesDe = x => {
      const d = declarados(x), sf = rolesSf(x);
      if (!sf) return d;
      const lid = sf.filter(k => LIDERES.indexOf(k) >= 0);
      if (!edi) return d.some(k => sf.indexOf(k) >= 0) ? union(d, sf) : d;
      if (!d.length) return sf;
      // A leader response counts in the person's SF leader roles instead of the one picked ("Mover", Mau 13-11-2026,
      // agreed with the subdirecciones: every leader gets the same questions, so the label picked carries no weight)
      if (d.some(k => LIDERES.indexOf(k) >= 0)) return lid.length ? union(d.filter(k => LIDERES.indexOf(k) < 0), lid) : d;
      return lid.length && x.niveles.some(i => papel.indexOf(i) >= 0) ? union(d, lid) : d;
    };
    const r = {}, e = {}, eSf = {}, porSf = {};
    SEG_ROLES_EFA.forEach(([k]) => { r[k] = 0; e[k] = ''; porSf[k] = 0; });
    const porPersona = {};
    vig.forEach(x => {
      const id = x.correo || '#' + x.fila, q = porPersona[id] || (porPersona[id] = { roles: [], marcados: [] });
      q.roles = union(q.roles, rolesDe(x));
      q.marcados = union(q.marcados, declarados(x));
    });
    Object.keys(porPersona).forEach(id => porPersona[id].roles.forEach(k => { r[k]++; if (porPersona[id].marcados.indexOf(k) < 0) porSf[k]++; }));
    if (lista) SEG_ROLES_EFA.forEach(([k]) => { e[k] = eSf[k] = lista.filter(x => x.roles.indexOf(k) >= 0).length; });
    // Every school has a Director/a and an Encargado/a (Mau 05-11-2026): when SF has none, expect 1 (SF rules otherwise)
    const automatico = {};
    if (lista) SEG_ESPERADO_MINIMO.forEach(k => { if (!e[k]) { e[k] = 1; automatico[k] = true; } });
    // REL Cuadernillos (the SIP ones get the EFA): encargados and mentores don't answer it (Mau 05-11-2026), expected 0 over SF
    const sinLideres = {};
    if (lista && p.programa === 'rel' && normTexto_(sp.modelo) === 'cuadernillos') SEG_SIN_LIDERES_CUADERNILLOS.forEach(k => { e[k] = 0; sinLideres[k] = true; automatico[k] = false; });
    // Ajustes EFA tab (Mau 12-11-2026: leaves, vacancies, agreed exceptions), over everything above
    const aj = (s.ajustes || {})[f.rbd + '|' + p.programa] || { roles: {}, niveles: {} };
    const fijo = {};
    if (lista) Object.keys(aj.roles).forEach(k => { e[k] = aj.roles[k].n; fijo[k] = aj.roles[k]; automatico[k] = false; sinLideres[k] = false; });
    const sinRol = vig.filter(x => !rolSeg(x)).length; // every response without a role (EFA-EDI consents table)
    const sinRolUbicadas = vig.filter(x => !rolSeg(x) && rolesDe(x).length).length;
    const sinRolSueltas = sinRol - sinRolUbicadas; // in no role column
    // someone counted in a role they didn't mark: the portal (what each person declared) won't match these numbers
    const difierePortal = SEG_ROLES_EFA.some(([k]) => porSf[k] > 0) || sinRolUbicadas > 0;
    Object.assign(f, { r, e, sinRol, sinRolSueltas, difierePortal, nContactos: lista ? lista.length : '' }); // for Por JdP / Por programa / Destinatarios

    // Respuestas: why the numbers don't add up
    const conCorreo = vig.filter(x => x.correo), personas = new Set(conCorreo.map(x => x.correo)).size + vig.length - conCorreo.length;
    const porCorreoR = agrupar_(conCorreo, x => x.correo), variasVeces = Object.keys(porCorreoR).filter(k => porCorreoR[k].length > 1).length;
    const conteo = corto => vig.filter(x => rolSeg(x) === corto).length;
    const todos = conteo('Encargado/a, Mentor/a y Docente'), ambos = conteo('Encargado/a y Mentor/a');
    const desconocidos = vig.filter(x => rolSeg(x) && !ROLES_SEG_EFA[rolSeg(x)]).map(rolSeg).filter((v, i, a) => a.indexOf(v) === i);
    const antes = abre ? vig.filter(x => x.fecha != null && dia(x.fecha) < abre).length : 0;
    const repetidos = f.resps.length - vig.length;
    nota(fila, col('Respuestas'), [
      sinRolTexto(sinRolSueltas) + (sinRolSueltas && !sp.edi ? ` La encuesta siempre pide el rol: ${sinRolSueltas === 1 ? 'revísala' : 'revísalas'}.` : ''),
      sinRolUbicadas ? `${pl(sinRolUbicadas, 'respuesta sin rol cuenta', 'respuestas sin rol cuentan')} según el rol de la persona en Salesforce.` : '',
      vig.length > personas ? `${pl(vig.length, 'respuesta', 'respuestas')} de ${pl(personas, 'persona', 'personas')}: ${pl(variasVeces, 'persona respondió', 'personas respondieron')} más de una vez la encuesta, con un rol distinto cada vez; cada envío cuenta como una respuesta.` : '',
      repetidos ? `Se ${repetidos === 1 ? 'descartó 1 envío repetido' : 'descartaron ' + miles(repetidos) + ' envíos repetidos'} (mismo correo y rol); de cada persona y rol cuenta el envío más reciente.` : '',
      todos ? `${pl(todos, 'respuesta «Cumplo todos los roles» cuenta', 'respuestas «Cumplo todos los roles» cuentan')} en las columnas Encargado/a, Mentor/a y Docentes; en Respuestas, ${todos === 1 ? 'una vez' : 'una vez cada una'}. La encuesta no le pregunta niveles.` : '',
      ambos ? `${pl(ambos, 'respuesta «Encargado/a y Mentor/a» cuenta', 'respuestas «Encargado/a y Mentor/a» cuentan')} en las columnas Encargado/a y Mentor/a; en Respuestas, ${ambos === 1 ? 'una vez' : 'una vez cada una'}.` : '',
      desconocidos.map(t => `Rol no reconocido «${t}»: cuenta en Otros líderes.`).join('\n'),
      antes ? `${pl(antes, 'respuesta anterior', 'respuestas anteriores')} a la apertura (${ddmm(abre)}): ${antes === 1 ? 'posible prueba' : 'posibles pruebas'}.` : '',
      !p.efa.links.length ? 'Sin link EFA en Formularios para este programa.' : '']);
    if (!s.enviadosEfa[f.rbd] && normTexto_(sp.modelo) === 'cuadernillos') nota(fila, col('Correo enviado'), ['Cuadernillos: el correo de la EFA se envía a mano.']);

    // Per role: above or without what SF has
    SEG_ROLES_EFA.forEach(([k, nombre], j) => {
      const cR = cRol + 3 * j;
      if (lista && e[k] && r[k] > e[k]) nota(fila, cR, [`${miles(r[k] - e[k])} sobre lo esperado (esperado: ${miles(e[k])}).`]);
      else if (sinLideres[k] && r[k]) nota(fila, cR, [`Encargados y mentores no responden EFA, pero hay ${pl(r[k], 'respuesta', 'respuestas')}.`]);
      else if (fijo[k] && !e[k] && r[k]) nota(fila, cR, [`Esperado ajustado a 0 para este colegio, pero hay ${pl(r[k], 'respuesta', 'respuestas')}.`]);
      else if (lista && !e[k] && r[k]) nota(fila, cR, [`Sin contactos con este rol en Salesforce, pero hay ${pl(r[k], 'respuesta', 'respuestas')}.`]);
      if (sinLideres[k]) nota(fila, cR + 1, ['Encargados y mentores no responden EFA.']);
      if (porSf[k]) nota(fila, cR, [`${pl(porSf[k], 'persona cuenta', 'personas cuentan')} aquí por su rol en Salesforce, aunque en la encuesta ${porSf[k] === 1 ? 'marcó' : 'marcaron'} otro rol o ninguno: cada persona responde una vez.`]);
      if (fijo[k]) nota(fila, cR + 1, [`Esperado ajustado a ${miles(e[k])} (en Salesforce: ${miles(eSf[k])})${fijo[k].motivo ? ': ' + fijo[k].motivo : ''}. Ajuste acordado en la pestaña ${TAB_AJUSTES_EFA}.`]);
      if (automatico[k]) nota(fila, cR + 1, [`Esperado automático: Salesforce no tiene ${nombre} vigente para esta implementación, así que se asume 1. Para que este comentario desaparezca, actualiza el contacto en SF.`]);
    });

    // Contactos SF: cases that look like a Salesforce mistake, to fix there
    if (lista) {
      const porCorreo = agrupar_(lista.filter(x => x.correo), x => x.correo);
      const rep = Object.keys(porCorreo).map(k => porCorreo[k]).filter(g => g.length > 1);
      const mismoRol = rep.filter(g => g[0].rol && g.every(x => x.rol === g[0].rol)).length;
      const todosSinRol = rep.filter(g => g.every(x => !x.rol)).length;
      const unoSinRol = rep.filter(g => g.some(x => !x.rol) && g.some(x => x.rol)).length;
      const distintos = rep.filter(g => g.every(x => x.rol) && g.some(x => x.rol !== g[0].rol));
      const combos = distintos.map(g => g.map(x => '«' + x.rol + '»').filter((v, i, a) => a.indexOf(v) === i).join(' y ')).filter((v, i, a) => a.indexOf(v) === i);
      const sinRolSF = lista.filter(x => !x.roles.length).length;
      const otros = [];
      Object.keys(porCorreo).forEach(k => (colegiosDe[k + '|' + p.programa] || []).forEach(o => { if (o !== f.rbd && otros.indexOf(o) < 0) otros.push(o); }));
      const enOtro = Object.keys(porCorreo).filter(k => colegiosDe[k + '|' + p.programa].length > 1).length;
      nota(fila, col(SEG_COL_CONTACTOS), [
        !lista.length ? 'Sin contactos en Salesforce para esta implementación.' : '',
        mismoRol ? `${pl(mismoRol, 'correo aparece', 'correos aparecen')} más de una vez con el mismo rol: ${mismoRol === 1 ? 'cuenta' : 'cuentan'} cada vez. Si es la misma persona, corrígelo en Salesforce.` : '',
        todosSinRol ? `${pl(todosSinRol, 'correo aparece', 'correos aparecen')} más de una vez, siempre sin Rol en la Implementación. Si es la misma persona, corrígelo en Salesforce.` : '',
        unoSinRol ? `${pl(unoSinRol, 'correo aparece', 'correos aparecen')} más de una vez, al menos una sin Rol en la Implementación. Si es la misma persona, corrígelo en Salesforce.` : '',
        distintos.length ? `${pl(distintos.length, 'correo tiene', 'correos tienen')} roles distintos en filas distintas (${combos.join('; ')}): ${distintos.length === 1 ? 'cuenta' : 'cuentan'} en cada rol. Si no corresponde, corrígelo en Salesforce.` : '',
        sinRolSF ? `${pl(sinRolSF, 'contacto', 'contactos')} sin Rol en la Implementación en Salesforce: no ${sinRolSF === 1 ? 'cuenta' : 'cuentan'} en ningún esperado. Complétalo en Salesforce.` : '',
        enOtro ? `${pl(enOtro, 'correo también aparece', 'correos también aparecen')} en ${otros.length === 1 ? 'otro colegio' : 'otros colegios'} (RBD ${otros.join(', ')}).` : '']);
    }

    // ASE docentes by grade
    const grupos = gruposDe(f);
    if (p.programa === 'ase') {
      const docentes = vig.filter(x => declarados(x).indexOf('docente') >= 0); // grades: only who answered as docente
      const varios = docentes.filter(x => x.niveles.length > 1), sinNivel = docentes.filter(x => !x.niveles.length).length;
      if (varios.length || sinNivel) {
        const suma = docentes.reduce((t, x) => t + x.niveles.length, 0);
        nota(fila, cRol + 12, [`Docentes: ${miles(docentes.length)}. En los niveles suman ${miles(suma)}: ` + [
          varios.length ? `${pl(varios.length, 'declaró', 'declararon')} más de un nivel y ${varios.length === 1 ? 'cuenta' : 'cuentan'} en cada uno` : '',
          sinNivel ? `${pl(sinNivel, 'sin nivel declarado', 'sin nivel declarado')}` : ''].filter(Boolean).join('; ') + '.']);
      }
    }
    const celdas = [].concat.apply([], columnas.map((i, k) => {
      const n = grupos.find(x => x.nivel === NIVELES[i]);
      if (!n) return ['', ''];
      const cC = cGrado + 2 * k + 1;
      if (aj.niveles[i] != null) nota(fila, cC - 1, [`No se esperan respuestas de docentes en este nivel${aj.niveles[i] ? ': ' + aj.niveles[i] : ''}. Ajuste acordado en la pestaña ${TAB_AJUSTES_EFA}.`]);
      if (!n.registrado) nota(fila, cC, [`Fuera de lo registrado: SF no tiene este nivel en el programa, pero ${pl(n.r, 'docente lo declaró', 'docentes lo declararon')}.`]);
      else if (!n.cursos) nota(fila, cC, ['Sin CxN en SF para este nivel.']);
      return [n.r, !n.registrado ? 'Fuera de lo registrado' : n.cursos || ''];
    }));
    tab.push([Number(f.rbd), f.col.nombre || '', prog(p), sp.modelo || '', sp.edi ? 'SÍ' : '', sp.jefeProyecto || '', sp.coordinador || '',
      fecha(s.enviadosEfa[f.rbd]), f.u.ingresos, conFormato(f.u.ultimo, true), f.u.acciones[p.programa].join(', '),
      lista ? lista.length : '', vig.length]
      .concat([].concat.apply([], SEG_ROLES_EFA.map(([k]) => [r[k], e[k], lista ? pct(r[k], e[k]) : ''])))
      .concat([grupos.filter(n => n.registrado && !n.r && aj.niveles[nivelIdx_(n.nivel)] == null).map(n => corto(n.nivel)).join(', ')], celdas));
  });
  // Gray / white blocks: every other role (resp. + esp. + %), then every other grade (doc. + cursos)
  const gris = [].concat.apply([], SEG_ROLES_EFA.map((_, j) => (j % 2 ? [] : [cRol + 3 * j, cRol + 3 * j + 1, cRol + 3 * j + 2])))
    .concat([].concat.apply([], columnas.map((_, k) => (k % 2 ? [] : [cGrado + 2 * k, cGrado + 2 * k + 1]))));
  const tabs = {}, notasT = {}, formato = {};
  tabs[SEG_EFA_TAB] = tab;
  notasT[SEG_EFA_TAB] = notas;
  formato[SEG_EFA_TAB] = { gris, patron: '0.00%' }; // % with 2 decimals (EFA tracker only)

  // Por JdP / Por programa (Mau 03-11-2026): laid out like the 2025 tracker's Resumen JdP / Resumen Programa (title,
  // tables from column B, a block per table, Total row, footnote); the team does the colors. Sums of Resumen rows;
  // % = group responses ÷ group expected (not an average of schools).
  const hayE = !!s.contactos;
  // % capped at 100% (Mau 05-11-2026); topes = the roles where the real % is higher, for Por JdP's notes
  const topes = grupo => SEG_ROLES_EFA.map(([k, nombre]) => {
    const rr = grupo.reduce((t, f) => t + f.r[k], 0), ee = grupo.reduce((t, f) => t + (typeof f.e[k] === 'number' ? f.e[k] : 0), 0);
    const sobreF = grupo.filter(f => f.r[k] > (typeof f.e[k] === 'number' ? f.e[k] : 0)); // schools above what SF expects
    const jdps = new Set(sobreF.map(f => f.sp.jefeProyecto || '')).size;
    return { nombre, rr, ee, sobre: sobreF.length, jdps, tope: hayE && ee > 0 && rr > ee };
  });
  const sumar = grupo => [grupo.length, grupo.filter(f => f.vig.length).length, grupo.reduce((t, f) => t + f.vig.length, 0)]
    .concat(topes(grupo).map(x => (hayE ? (x.tope ? 1 : pct(x.rr, x.ee)) : '')));
  const real = x => String(Math.round(x.rr / x.ee * 10000) / 100).replace('.', ',') + '%';
  const textoTope = x => `Se muestra 100%, pero el cálculo da ${real(x)} `
    + `(${pl(x.rr, 'respuesta', 'respuestas')} de ${x.nombre} sobre ${pl(x.ee, 'esperado', 'esperados')}): `
    + `en ${pl(x.sobre, 'colegio hay', 'colegios hay')} más respuestas que contactos de Salesforce con ese rol.`;
  // Por programa: where to look, never whose it is (Mau 05-11-2026)
  const textoTopeP = x => `Se muestra 100%, pero el cálculo da ${real(x)}. Hay ${pl(x.sobre, 'colegio', 'colegios')} con más respuestas `
    + `que contactos de Salesforce con ese rol (de ${pl(x.jdps, 'Jefe/a de Proyecto', 'Jefes/as de Proyecto')}); el detalle está en Resumen.`;
  const anio = reloj.hoy.slice(0, 4);
  const PIE = '*% = respuestas del grupo ÷ contactos esperados en Salesforce, sumando todo el grupo (no es el promedio de los colegios). Una respuesta cuenta en cada rol que declara.';
  const cResp = 1 + SEG_EFA_SUMA.length; // 0-based column of Respuestas (col A blank, B label)
  const resumen = (nombre, titulo, bloques, pie) => {
    const t = [tab[0], tab[1], ['', titulo]], notasR = [];
    bloques.forEach(b => {
      t.push([]);
      if (b.titulo) t.push(['', b.titulo]);
      t.push(['', b.etiqueta].concat(b.columnas || SEG_EFA_SUMA.concat(SEG_ROLES_EFA.map(r => '% Avance ' + r[1]))));
      b.filas.forEach(g => {
        const sr = g.filas.reduce((n, f) => n + f.sinRolSueltas, 0);
        if (sr && !b.valores) notasR.push([t.length, cResp, sinRolTexto(sr)]);
        if (!b.valores) topes(g.filas).forEach((x, j) => { if (x.tope) notasR.push([t.length, cResp + 1 + j, nombre === SEG_EFA_JDP ? textoTope(x) : textoTopeP(x)]); });
        t.push(['', g.nombre].concat((b.valores || sumar)(g.filas)));
      });
    });
    t.push([], ['', pie]);
    tabs[nombre] = t;
    notasT[nombre] = notasR;
    // free layout: no header band; % columns as percent from the title row down
    formato[nombre] = { libre: true, pct: SEG_ROLES_EFA.map((_, j) => cResp + 1 + j), patron: '0.00%' }; // 2 decimals, as in 2025
  };
  const porJdp = agrupar_(filas, f => f.sp.jefeProyecto || '');
  resumen(SEG_EFA_JDP, `Resumen de respuestas por Jefe/a de Proyecto · EFA ${anio}`, [{ etiqueta: 'Jefe/a de Proyecto',
    filas: Object.keys(porJdp).sort(compararTexto_).map(k => ({ nombre: k || '(sin Jefe/a de Proyecto)', filas: porJdp[k] })).concat([{ nombre: 'Total', filas }]) }], PIE);
  // Por programa: first table = one row per group + Total (main indicator); then one table per group by modelo.
  // Groups: ASE sin EDI, ASE EDI by cohort (Año inicio: 2025 = cohorte 1, 2026 = cohorte 2), REL.
  const grupoP = f => {
    const pr = prog(f.p), c = f.sp.anioInicio;
    if (!f.sp.edi) return { orden: pr + '0', nombre: pr === 'ASE' ? 'ASE sin EDI' : pr };
    return c ? { orden: pr + '1' + c, nombre: `${pr} EDI · cohorte ${c - 2024} (${c})` } : { orden: pr + '1', nombre: pr + ' EDI' };
  };
  const porGrupo = agrupar_(filas, f => { const g = grupoP(f); return g.orden + '|' + g.nombre; });
  const claves = Object.keys(porGrupo).sort();
  const nombreG = k => k.slice(k.indexOf('|') + 1);
  const bloquesP = [{ titulo: 'Implementaciones por grupo', etiqueta: 'Grupo',
    filas: claves.map(k => ({ nombre: nombreG(k), filas: porGrupo[k] })).concat([{ nombre: 'Total', filas }]) }];
  // EFA-EDI consents by cohort (Mau 03-11-2026): a response without a role in EFA-EDI = negative consent (the survey
  // ends before the role). Same columns as the other tables up to F, so "%" sits in a percent column.
  const edi = claves.filter(k => porGrupo[k][0].sp.edi);
  if (edi.length) bloquesP.push({ titulo: 'EFA-EDI: consentimientos por cohorte', etiqueta: 'Cohorte',
    columnas: ['Implementaciones', 'Respuestas EFA-EDI', 'Consentimientos negativos', '% de consentimientos negativos'],
    valores: grupo => {
      const r = grupo.reduce((t, f) => t + f.vig.length, 0), neg = grupo.reduce((t, f) => t + f.sinRol, 0);
      return [grupo.length, r, neg, r ? Math.round(neg / r * 1000) / 1000 : ''];
    },
    filas: edi.map(k => ({ nombre: nombreG(k), filas: porGrupo[k] })).concat(edi.length > 1 ? [{ nombre: 'Total EFA-EDI', filas: [].concat.apply([], edi.map(k => porGrupo[k])) }] : []) });
  claves.forEach(k => {
    const porModelo = agrupar_(porGrupo[k], f => f.sp.modelo || '');
    bloquesP.push({ titulo: `Implementaciones ${nombreG(k)} por modelo`, etiqueta: 'Modelo',
      filas: Object.keys(porModelo).sort(compararTexto_).map(m => ({ nombre: m || '(sin modelo)', filas: porModelo[m] })).concat([{ nombre: 'Total', filas: porGrupo[k] }]) });
  });
  resumen(SEG_EFA_PROG, `Resumen de respuestas por Programa y Modelo · EFA ${anio}`, bloquesP, PIE + ' EDI: cohorte 1 = año de inicio 2025, cohorte 2 = 2026.');

  // Destinatarios (Mau 06-11-2026): who each school's progress email goes to, for the tracker's own script
  // (gas-seguimiento/: Seguimiento → Generar correos de avance), which builds the email when the JdP clicks, with the
  // numbers of Resumen at that moment. One row per school and JdP (programs with different JdPs → one row each).
  if (s.encargados) {
    const v = ventana_((d.cfg || {}).efa_abre, (d.cfg || {}).efa_cierra, reloj.hoy, (d.cfg || {}).efa_extension);
    // Cierre EFA = the date the survey really closes once the extra week has started (the drafts say "hasta el …")
    const cierreDest = v.extension && v.fase !== 'pre' && v.fase !== 'open' ? v.extension : v.cierra;
    const dest = [tab[0], tab[1], SEG_EFA_DEST]; // same status lines; header on row 3
    const porColegioJdp = agrupar_(filas, f => f.rbd + '|' + (f.sp.jefeProyecto || ''));
    Object.keys(porColegioJdp).forEach(k => {
      const grupo = porColegioJdp[k], f0 = grupo[0], jdp = f0.sp.jefeProyecto || '';
      const correoJdp = jdp ? s.correosJdp[normTexto_(jdp)] || '' : '';
      const enc = s.encargados.porRbd[f0.rbd] || [];
      // CC: the Coordinador/a of these programs (the JdP sends it; never an encargado)
      const cc = Array.from(new Set(grupo.map(f => f.sp.coordinador).filter(Boolean))).map(n => s.correosJdp[normTexto_(n)])
        .filter((c, i, a) => c && c !== correoJdp && !enc.some(e => e.email === c) && a.indexOf(c) === i);
      const obs = [!jdp ? 'Sin Jefe/a de Proyecto en SF' : !correoJdp ? `Sin correo en ${TAB_CORREOS_JDP} para ${jdp}` : '',
        !enc.length ? `Sin encargado en la pestaña ${TAB_ENCARGADOS}` : '', !s.claves[f0.rbd] ? 'Sin clave en Contraseñas' : ''].filter(Boolean);
      dest.push([Number(f0.rbd), f0.col.nombre || '', grupo.map(f => prog(f.p)).join(' + '), jdp, correoJdp,
        enc.map(e => e.email).join(', '), enc.map(e => e.nombre).filter(Boolean).join(', '), cc.join(', '), s.claves[f0.rbd] || '',
        cierreDest || '', v.fase || '', grupo.some(f => f.difierePortal) ? 'SÍ' : '', obs.join(' · ')]);
    });
    tabs[SEG_EFA_DEST_TAB] = dest;
    notasT[SEG_EFA_DEST_TAB] = [];
    formato[SEG_EFA_DEST_TAB] = { gris: [] };
  }
  return { tabs, notas: notasT, formato };
}

// ── Normalization ───────────────────────────────────────────

const NIVEL_IDX = {};
NIVELES.forEach((n, i) => { NIVEL_IDX[claveNivel_(n)] = i; });

function normTexto_(v) {
  return String(v == null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

// Grade sign optional: "5° básico", "5º Básico" and "5 basico" are the same key. Still an exact match (never substring).
function claveNivel_(v) {
  return normTexto_(String(v == null ? '' : v).replace(/[°º]/g, ' '));
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

// A plain number is a Sheets date serial: a date cell that lost its date format reads as one
// (Métricas rows 07-10 → 16-10-2026 did). Only years ~1955–2173 qualify, so a stray small number is never a date.
function ms_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === 'number') return v > 20000 && v < 100000 ? fechaSerial_(v).getTime() : null;
  const t = Date.parse(String(v == null ? '' : v).trim());
  return isNaN(t) ? null : t;
}

// Sheets serial (days since 30-12-1899, in the Sheet's local time) → Date in the script's time zone
function fechaSerial_(s) {
  const dias = Math.floor(s), seg = Math.round((s - dias) * 86400);
  const b = new Date(Date.UTC(1899, 11, 30) + dias * 86400000);
  return new Date(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate(), Math.floor(seg / 3600), Math.floor((seg % 3600) / 60), seg % 60);
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

// ── Manual checks (run from the editor) ─────────────────────

/**
 * Builds the panel for every school that has rows in the response tabs and logs counts only (never names).
 */
function probarPanel() {
  const d = cargarDatos_();
  const rbds = Array.from(new Set([].concat(d.test || [], d.efa || []).map(x => x.rbd))).sort();
  const out = [`Colegios con respuestas: ${rbds.length}`,
    `Test ok: ${!!d.test} · EFA ok: ${!!d.efa} · Formularios: ${d.formularios.length} filas`];
  rbds.forEach(rbd => {
    const p = panel_(rbd, d, reloj_());
    out.push(`RBD ${rbd} · Test ${p.encuestas.test.fase} · EFA ${p.encuestas.efa.fase}` +
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

  const grupos = { sinTest: [], sinEfa: [], variasEfa: [], sinNivelesTest: [], linkIncompleto: [] };
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
    test.concat(efa).filter(f => f.link && !linkDe_(f, rbd, sf[rbd]))
      .forEach(f => grupos.linkIncompleto.push(`${etiqueta} (${f.form})`));
  }));
  out.push(`Colegio-programa revisados (sin Control): ${revisadas}`);
  const lista = (titulo, l) => out.push(`${titulo}: ${l.length}` + (l.length ? '\n  ' + l.join('\n  ') : ''));
  lista('Sin formulario de Test', grupos.sinTest);
  lista('Sin formulario EFA', grupos.sinEfa);
  lista('Con más de un formulario EFA', grupos.variasEfa);
  lista('Link sin mostrar: faltan nombre o comuna en SF (Nombre para formulario)', grupos.linkIncompleto);
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

// ── Sin Test (manual, from the editor; re-run after SF or Formularios change) ─

const COLS_SIN_TEST = ['RBD', 'Colegio', 'Comuna', 'Programa', 'Modelo', 'EDI', 'Año inicio', 'Jefe/a de Proyecto',
  'Niveles del colegio', 'Test en papel', 'Habilitar'];

/**
 * Lists every school-program whose SF grades have no online Test (Formularios grades ∩ SF grades is empty).
 * By default the portal shows them no Test links; ticking Habilitar shows them their group's links.
 * Rebuilds the tab each run; Habilitar and any column Mau adds are kept per RBD + Programa (as values).
 */
function listarSinTest() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sf = leerSF_();
  const forms = leerFormularios_();
  let sh = ss.getSheetByName(TABS.sinTest);
  const previo = {};
  let extras = [];
  if (sh && sh.getLastRow() > 0) {
    const t = leerTabla_(TABS.sinTest);
    extras = t.headers.filter(h => h && COLS_SIN_TEST.indexOf(h) < 0);
    const cR = t.headers.indexOf('RBD'), cP = t.headers.indexOf('Programa');
    if (cR >= 0 && cP >= 0) t.rows.forEach(r => {
      const fila = {};
      t.headers.forEach((h, i) => { fila[h] = r[i]; });
      previo[normRbd_(r[cR]) + '|' + programa_(r[cP])] = fila;
    });
  }
  const filas = [];
  Object.keys(sf).forEach(rbd => Object.keys(sf[rbd].programas).forEach(k => {
    const p = sf[rbd].programas[k];
    const testIdx = [].concat.apply([], formulariosDe_(forms, 'test', p).map(rango_));
    if (p.implementados.some(i => testIdx.indexOf(i) >= 0)) return;
    const papel = p.programa === 'ase' && p.edi
      ? (PAPEL_EDI[p.anioInicio] || []).map(nivelIdx_).filter(i => p.implementados.indexOf(i) >= 0) : [];
    const antes = previo[rbd + '|' + p.programa] || {};
    filas.push([rbd, sf[rbd].nombre || '', sf[rbd].comuna || '', p.programa.toUpperCase(), p.modelo || '', p.edi ? 'SÍ' : 'NO',
      p.anioInicio || '', p.jefeProyecto || '', tramos_(p.implementados), tramos_(papel), esVerdadero_(antes['Habilitar'])]
      .concat(extras.map(h => (antes[h] == null ? '' : antes[h]))));
  }));
  const orden = f => [f[3], normTexto_(f[7]), normTexto_(f[1])].join('|');
  filas.sort((a, b) => (orden(a) < orden(b) ? -1 : orden(a) > orden(b) ? 1 : 0));

  const enc = COLS_SIN_TEST.concat(extras);
  if (!sh) sh = ss.insertSheet(TABS.sinTest, ss.getNumSheets());
  const viejas = sh.getLastRow();
  if (viejas > 0) sh.getRange(1, 1, viejas, Math.max(sh.getLastColumn(), enc.length)).clearContent().clearDataValidations();
  sh.getRange(1, 1, 1, enc.length).setValues([enc]).setFontWeight('bold');
  if (filas.length) {
    sh.getRange(2, COLS_SIN_TEST.length, filas.length, 1).insertCheckboxes(); // before the values: it resets cells to false
    sh.getRange(2, 1, filas.length, enc.length).setValues(filas);
  }
  const habilitados = filas.filter(f => f[COLS_SIN_TEST.length - 1] === true).length;
  const texto = `${TABS.sinTest}: ${filas.length} colegio-programa sin niveles con Test en línea (${habilitados} habilitados).`;
  console.log(texto);
  return texto;
}

/**
 * Creates the Letras tab (headers, ASE / REL checkboxes, a note on each header) so the team can type a school's real
 * class letters. Does nothing if the tab already exists.
 */
function prepararLetras() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSheetByName(TABS.letras)) return `${TABS.letras}: ya existe, no la modifiqué`;
  const sh = ss.insertSheet(TABS.letras, ss.getNumSheets());
  const filas = 300;
  sh.getRange(1, 1, 1, LETRAS_ENCABEZADOS.length).setValues([LETRAS_ENCABEZADOS]).setFontWeight('bold').setNotes([[
    'RBD del colegio, solo el número (sin dígito verificador).',
    'Nivel como en el portal: «I° medio», «4° básico» (el signo °, las tildes y las mayúsculas dan igual).',
    'Las letras reales de los cursos de ese nivel, separadas por coma: «A, D». Reemplazan las que el portal deduce de los cursos en SF (A, B, C…). El estimado por curso se reparte entre estas letras.',
    'Marca si la fila vale para ASE.',
    'Marca si la fila vale para Religión. Una fila sin ningún programa marcado no se usa. Si una fila no se puede leer (nivel o letras mal escritos), ese nivel queda con las letras de SF.',
  ]]);
  sh.setFrozenRows(1);
  sh.getRange(2, 4, filas, 2).insertCheckboxes();
  const texto = `${TABS.letras}: creada con ${filas} filas para completar`;
  console.log(texto);
  return texto;
}

// Grade indices → "NT1 a 3° básico, I° medio"
function tramos_(idx) {
  const s = idx.slice().sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(i === j ? NIVELES[s[i]] : `${NIVELES[s[i]]} a ${NIVELES[s[j]]}`);
    i = j;
  }
  return out.join(', ');
}

// ── Correos de anuncio: Test and EFA (manual, run as evaluacion@ from the editor) ─
// 1) Mau pastes the encargados export into "Encargados" (headers as exported from SF); "correos_jdp" maps each
//    Jefe/a de Proyecto or Coordinador/a name to an email (CC).
// 2) prepararCorreosTest() / prepararCorreosEfa() build "Correos Test" / "Correos EFA": one row per school, all its
//    encargados together, review + Enviar box.
// 3) enviarCorreoPrueba() / enviarCorreoPruebaEfa() send up to 3 samples to Config "correos_prueba".
// 4) enviarCorreosTest() / enviarCorreosEfa() send, stamping Enviado.
// Programs come from SF, never from the encargados' "Programa" column; Control and programs without the survey are left out.

const TAB_ENCARGADOS = 'Encargados'; // not in TABS; Cloud Run reads it only for the EFA tracker's Destinatarios tab
const TAB_CORREOS_JDP = 'correos_jdp';
const COLS_ENCARGADOS = ['Nombre para formulario', 'ID RBD', 'Programa que participa', 'First Name', 'Email']; // what leerEncargados_ reads (Cloud Run downloads only these)
const TAB_CORREOS = 'Correos Test'; // the trackers read the Enviado column of both
const TAB_CORREOS_EFA = 'Correos EFA';
const CORREOS = {
  test: { tab: TAB_CORREOS, preparar: 'prepararCorreosTest', enviar: 'enviarCorreosTest', categorias: true,
    programas: res => programasConTest_(res), sinProgramas: 'Sin programas con Test (Control o pestaña Sin Test)' },
  efa: { tab: TAB_CORREOS_EFA, preparar: 'prepararCorreosEfa', enviar: 'enviarCorreosEfa', categorias: false,
    programas: res => programasConEfa_(res), sinProgramas: 'Sin programas con link EFA (Control, Cuadernillos con correo manual, o sin fila EFA en Formularios)' },
};
const COLS_CORREOS = ['RBD', 'Colegio', 'Programas', 'Jefe/a de Proyecto', 'Para', 'CC', 'Nombres', 'Contacto', 'Asunto', 'Mensaje',
  'Observaciones', 'Enviar', 'Enviado'];
const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const TITULO_PROGRAMA = { ase: 'Aprendizaje Socioemocional', rel: 'Religión Católica' };
const PORTAL_URL = 'https://portal.fundaciontrabun.cl';
// Logo sent inside the email (inline image, cid:logo): hosted images are blocked by default in Outlook and others
const LOGO_CORREO_B64 = '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';
const COLOR = { tinta: '#151b29', rojo: '#b51a2a', naranjo: '#dc911b', verde: '#a2c037', celeste: '#6bacc4', amarillo: '#f9dc0a',
  gris: '#f5f5f5', celesteClaro: '#c8e3ed', amarilloClaro: '#fef7c1', muted: '#5b6070' };
const RE_CORREO = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;

function prepararCorreosTest() { return prepararCorreos_('test'); }
function prepararCorreosEfa() { return prepararCorreos_('efa'); }
function enviarCorreoPrueba() { return enviarCorreoPrueba_('test'); }
function enviarCorreoPruebaEfa() { return enviarCorreoPrueba_('efa'); }
function enviarCorreosTest() { return enviarCorreos_('test'); }
function enviarCorreosEfa() { return enviarCorreos_('efa'); }

function prepararCorreos_(tipo) {
  const conf = CORREOS[tipo];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ctx = contextoCorreos_();
  const encargados = ctx.encargados;
  const cJdp = leerCorreosJdp_();

  let sh = ss.getSheetByName(conf.tab);
  const previo = {};
  if (sh && sh.getLastRow() > 1) {
    const t = leerTabla_(conf.tab);
    const iR = t.headers.indexOf('RBD'), iE = t.headers.indexOf('Enviar'), iS = t.headers.indexOf('Enviado');
    const iP = t.headers.indexOf('Para'), iG = t.headers.indexOf('Programas'), iO = t.headers.indexOf('Observaciones');
    if (iR >= 0) t.rows.forEach(r => {
      previo[normRbd_(r[iR])] = { enviar: iE >= 0 ? r[iE] : '', enviado: iS >= 0 ? r[iS] : '',
        listo: !!(iP >= 0 && r[iP] && iG >= 0 && r[iG]), excluida: iO >= 0 && /^(SIP|Bien Público):/m.test(String(r[iO]).replace(/ · /g, '\n')) };
    });
  }

  const filas = [];
  Object.keys(ctx.claves).forEach(rbd => {
    const res = panel_(rbd, ctx.d, ctx.reloj);
    const col = ctx.d.sf[rbd];
    const obs = [];
    // Test only: Bien Público programs are not announced; a school left with only those is unticked (Mau can tick it).
    // SIP schools are unticked until the joint email is defined. EFA (Mau 29-10-2026): Bien Público goes like the rest,
    // and the only SIP schools with an EFA link are the two that get it (the other SIP ones are Cuadernillos).
    const bp = p => !!(conf.categorias && col && col.programas[p.programa] && normTexto_(col.programas[p.programa].proyecto) === 'bien publico');
    const conEncuesta = conf.programas(res);
    const noBp = conEncuesta.filter(p => !bp(p)), siBp = conEncuesta.filter(bp);
    const progs = noBp.length ? noBp : siBp;
    const sip = !!(conf.categorias && col && /sociedad de instruccion primaria/.test(normTexto_(col.sostenedor)));
    const excluida = sip || (!noBp.length && siBp.length > 0);
    if (!res.programas.length) obs.push('No está en SF');
    else if (!progs.length) obs.push(conf.sinProgramas);
    if (sip) obs.push('SIP: no se envía salvo que marques Enviar (correo conjunto por definir)');
    if (!noBp.length && siBp.length) obs.push('Bien Público: no se envía salvo que marques Enviar');
    if (noBp.length && siBp.length) obs.push(`No se menciona ${siBp.map(p => p.programa.toUpperCase()).join(' + ')} (Bien Público)`);
    const enc = encargados.porRbd[rbd] || [];
    if (!enc.length) obs.push('Sin encargado en la pestaña Encargados');
    (encargados.programas[rbd] || []).forEach(p => {
      if (!res.programas.some(x => x.programa === p)) obs.push(`En Encargados figura ${p.toUpperCase()}, que no está en SF`);
    });
    const cc = copiaEquipo_(progs, cJdp, enc);
    if (cc.faltan.length) obs.push(`Sin correo en ${TAB_CORREOS_JDP} para: ${cc.faltan.join(', ')}`);
    const correo = progs.length && enc.length ? correoDe_(tipo, res, progs, enc, ctx) : { asunto: '', texto: '' };
    const antes = previo[rbd] || {};
    const listo = !!(progs.length && enc.length);
    // Mau's own choice is kept once the row was ready, unless the school changed category (SIP / Bien Público)
    const enviar = listo && (antes.listo && antes.excluida === excluida ? esVerdadero_(antes.enviar) : !excluida);
    filas.push([rbd, res.colegio.nombre || '', progs.map(p => p.programa.toUpperCase()).join(' + '),
      Array.from(new Set(progs.map(p => p.jefeProyecto).filter(Boolean))).join(', '),
      enc.map(e => e.email).join(', '), cc.correos.join(', '), enc.map(e => e.nombre).filter(Boolean).join(', '), res.contacto,
      correo.asunto, correo.texto, obs.join(' · '), enviar, antes.enviado || '']);
  });
  const iEnviar = COLS_CORREOS.indexOf('Enviar'), iEnviado = COLS_CORREOS.indexOf('Enviado'), iObs = COLS_CORREOS.indexOf('Observaciones');
  filas.sort((a, b) => (a[iEnviar] === b[iEnviar] ? (normTexto_(a[1]) < normTexto_(b[1]) ? -1 : 1) : a[iEnviar] ? 1 : -1)); // issues first

  if (!sh) sh = ss.insertSheet(conf.tab, ss.getNumSheets());
  const viejas = sh.getLastRow();
  if (viejas > 0) sh.getRange(1, 1, viejas, Math.max(sh.getLastColumn(), COLS_CORREOS.length)).clearContent().clearDataValidations();
  sh.getRange(1, 1, 1, COLS_CORREOS.length).setValues([COLS_CORREOS]).setFontWeight('bold');
  if (filas.length) {
    sh.getRange(2, iEnviar + 1, filas.length, 1).insertCheckboxes();
    sh.getRange(2, 1, filas.length, COLS_CORREOS.length).setValues(filas);
  }
  const aEnviar = filas.filter(f => f[iEnviar] === true && !f[iEnviado]).length;
  const texto = `${conf.tab}: ${filas.length} colegios · ${aEnviar} por enviar · ${filas.filter(f => f[iObs]).length} con observaciones.`;
  console.log(texto);
  return texto;
}

// Programs announced: not Control, and with an online Test grade (or ticked Habilitar in "Sin Test")
function programasConTest_(res) {
  return res.programas.filter(p => normTexto_(p.modelo) !== 'control'
    && ((p.test.nivelesTest || []).some(n => (p.nivelesImplementados || []).indexOf(n) >= 0) || p.test.habilitado));
}

// EFA: not Control, and with a school link (an EFA row in Formularios and SF name + comuna for its gaps).
// Cuadernillos (REL SIP) get their EFA email by hand (Mau 30-10-2026), so they are left out here.
function programasConEfa_(res) {
  return res.programas.filter(p => normTexto_(p.modelo) !== 'control' && normTexto_(p.modelo) !== 'cuadernillos' && (p.efa.links || []).length > 0);
}

function correoDe_(tipo, res, progs, enc, ctx) {
  const clave = ctx.claves[res.colegio.rbd];
  if (tipo !== 'efa') return correoTest_(res, progs, enc, clave);
  const col = ctx.d.sf[res.colegio.rbd];
  const ase = col && col.programas.ase;
  const cohorte = ase && ase.edi && progs.some(p => p.programa === 'ase') ? ase.anioInicio : null;
  const t = ctx.testEnviado[res.colegio.rbd];
  const recibieron = t && enc.every(x => t.para.indexOf(x.email) >= 0) ? t.fecha : ''; // all of them, or nobody is told "we sent you"
  return correoEfa_(res, progs, enc, clave, recibieron, cohorte);
}

// CC: Jefe/a de Proyecto and Coordinador/a of the announced programs, matched by name (case/accents/spaces ignored)
function copiaEquipo_(progs, cJdp, enc) {
  const nombres = [];
  progs.forEach(p => [p.jefeProyecto, p.coordinador].forEach(n => { if (n && nombres.indexOf(n) < 0) nombres.push(n); }));
  const correos = [], faltan = [];
  nombres.forEach(n => {
    const c = cJdp[normTexto_(n)];
    if (!c) faltan.push(n);
    else if (correos.indexOf(c) < 0 && !enc.some(e => e.email === c)) correos.push(c);
  });
  return { correos, faltan };
}

// "correos_jdp": name in the first column, email in the column whose header contains "correo"
function leerCorreosJdp_() {
  const out = {};
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_CORREOS_JDP)) return out;
  const t = leerTabla_(TAB_CORREOS_JDP);
  const cE = t.headers.findIndex(h => normTexto_(h).indexOf('correo') >= 0);
  if (cE < 0) throw new Error(`La pestaña ${TAB_CORREOS_JDP} necesita una columna "correo".`);
  const cN = cE === 0 ? 1 : 0;
  t.rows.forEach(r => {
    const n = normTexto_(r[cN]), e = String(r[cE] == null ? '' : r[cE]).trim().toLowerCase();
    if (n && RE_CORREO.test(e)) out[n] = e;
  });
  return out;
}

// Encargados export: one row per person. RBD from "ID RBD", or from "Nombre para formulario" (Comuna - Nombre - RBD).
// Emails lower-cased and deduplicated per school; first names in title case.
function leerEncargados_() {
  const t = leerTabla_(TAB_ENCARGADOS);
  const cR = colExacta_(t, 'ID RBD'), cN = colExacta_(t, 'Nombre para formulario'), cE = colExacta_(t, 'Email');
  const cF = t.headers.indexOf('First Name'), cP = t.headers.indexOf('Programa que participa');
  const porRbd = {}, programas = {};
  t.rows.forEach(r => {
    const rbd = normRbd_(r[cR]) || rbdDeColegio_(r[cN]);
    const email = String(r[cE] == null ? '' : r[cE]).trim().toLowerCase();
    if (!rbd || !RE_CORREO.test(email)) return;
    const lista = porRbd[rbd] || (porRbd[rbd] = []);
    if (!lista.some(e => e.email === email)) lista.push({ email, nombre: cF >= 0 ? nombrePropio_(r[cF]) : '' });
    const p = cP >= 0 ? programa_(r[cP]) : '';
    if ((p === 'ase' || p === 'rel') && (programas[rbd] || (programas[rbd] = [])).indexOf(p) < 0) programas[rbd].push(p);
  });
  return { porRbd, programas };
}

function nombrePropio_(v) {
  return String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ')
    .replace(/(^|[\s'-])(\S)/g, (m, sep, ch) => sep + ch.toUpperCase());
}

// "2026-10-13" → "martes 13 de octubre"
function fechaLarga_(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const f = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `${DIAS_SEMANA[f.getUTCDay()]} ${+m[3]} de ${MESES[+m[2] - 1]}`;
}

function escHtml_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// "A, B y C"; "e" before a word that sounds like i ("Caroline, Jimena e Isabel"), but not before hie/hia ("y Hierro")
function conY_(l) {
  if (l.length < 2) return l[0] || '';
  const ultimo = l[l.length - 1];
  return l.slice(0, -1).join(', ') + (/^h?[ií](?![aeiouáéíóú])/i.test(String(ultimo).trim()) ? ' e ' : ' y ') + ultimo;
}

// Grade indices → "5° a 8° básico", "4° y 5° básico", "8° básico a I° medio", "4° básico e I° a IV° medio"
function nivelesTexto_(idx) {
  const s = Array.from(new Set(idx)).sort((a, b) => a - b);
  const tramos = [];
  s.forEach(i => { const t = tramos[tramos.length - 1]; if (t && i === t[t.length - 1] + 1) t.push(i); else tramos.push([i]); });
  return conY_(tramos.map(t => {
    const a = NIVELES[t[0]], b = NIVELES[t[t.length - 1]];
    if (t.length === 1) return a;
    const unir = t.length > 2 ? ' a ' : ' y ';
    const ca = a.split(' ')[1], cb = b.split(' ')[1];
    return ca && ca === cb ? a.split(' ')[0] + unir + b : a + unir + b;
  }));
}

// One email per school: singular (tú) for one encargado, plural (ustedes) for several. Plain text + designed HTML
// (table layout and inline styles: what Gmail and Outlook render; brand colors, Lato with Arial fallback, no icons).
// The logo travels inside the email (cid:logo) so clients show it without "download images".
function correoTest_(res, progs, enc, clave) {
  const uno = enc.length === 1;
  const tu = (a, b) => (uno ? a : b);
  const e = escHtml_;
  const nombres = enc.map(x => x.nombre).filter(Boolean);
  const titulos = progs.map(p => TITULO_PROGRAMA[p.programa]);
  const programa = titulos.length > 1 ? `de los programas de ${conY_(titulos)}` : `del programa de ${titulos[0]}`;
  const papel = [].concat.apply([], progs.map(p => (p.test.nivelesPapel || []).map(nivelIdx_)));
  const t = res.encuestas.test;
  const abre = fechaLarga_(t.abre), cierra = fechaLarga_(t.cierra);
  const contacto = res.contacto;
  const colegio = res.colegio.nombre || `RBD ${res.colegio.rbd}`;
  const asunto = `Test de Estudiantes 2026 · ${colegio}`;

  const saludo = `Hola${nombres.length ? ', ' + conY_(nombres) : ''}:`;
  const intro = `${tu('Te escribimos', 'Les escribimos')} de Fundación Trabün para ${tu('contarte', 'contarles')} que el Test de Estudiantes ${programa}`
    + (abre && cierra ? ` estará disponible desde el ${abre} hasta el ${cierra}.` : ' estará disponible pronto.');
  const portalA = `Para ${tu('acompañarte', 'acompañarlos')} en este proceso creamos el `, portalB = `, donde ${tu('vas', 'van')} a encontrar:`;
  const items = [
    ['Los links del test', `de ${tu('tu', 'su')} colegio, listos para copiar, enviar por WhatsApp o mostrar con código QR.`, COLOR.naranjo],
    ['Un instructivo para docentes', 'para imprimir y entregar a quienes aplicarán el test.', COLOR.verde],
    ['El avance de cada curso', `quiénes ya respondieron, para que ${tu('puedas', 'puedan')} acompañar a cada profesor.`, COLOR.rojo],
  ];
  const enPapel = papel.length ? `En ${nivelesTexto_(papel)} el test es en papel y lo aplica la Agencia Focus.` : '';
  const entrar = `${tu('Entra', 'Entren')} al portal con estos datos`;
  const reserva = `La clave es solo para el equipo de ${tu('tu', 'su')} colegio; ${tu('te', 'les')} pedimos no compartirla fuera de él.`;
  const gracias = `¡Muchas gracias por ${tu('tu', 'su')} apoyo!`;
  const pie = `Este es un correo automático, por favor no lo ${tu('respondas', 'respondan')}. Si ${tu('tienes', 'tienen')} cualquier duda, ${tu('escríbenos', 'escríbannos')} a ${contacto}.`;

  const texto = [saludo, intro, `${portalA}Portal de Seguimiento 2026${portalB}`, items.map(i => `• ${i[0]}: ${i[1]}`).join('\n')]
    .concat(enPapel ? [enPapel] : [])
    .concat([`${entrar}:\nRBD: ${res.colegio.rbd}\nClave: ${clave}\n${PORTAL_URL}`, reserva, gracias, 'Fundación Trabün'])
    .join('\n\n') + '\n\n—\n' + pie;

  const titulo = t.fase === 'open' ? 'El Test de Estudiantes ya está disponible'
    : abre ? `El Test de Estudiantes comienza el ${abre}` : 'El Test de Estudiantes está por comenzar';
  const bajada = (titulos.length > 1 ? `Programas de ${conY_(titulos)}` : `Programa de ${titulos[0]}`) + (cierra ? ` · disponible hasta el ${cierra}` : '');
  const html = correoHtml_({ titulo, bajada, contacto, pie, gracias, reserva, entrar, rbd: res.colegio.rbd, clave,
    parrafos: [e(saludo), e(intro), `${e(portalA)}<b>Portal de Seguimiento 2026</b>${e(portalB)}`], items, aviso: enPapel });
  return { asunto, texto, html };
}

// EFA kickoff (Mau 29-10-2026): each person gets their own invitation from the Fundación, but not everyone is on the
// list, so the encargado also shares the link and reminds the team. Same portal and clave as the Test, sent again as a
// reminder; "the same we sent on {date}" only where the Test email went out (Correos Test → Enviado).
// EDI treated schools (Mau 29-10-2026) get one more paragraph by cohort: 2025 = second and last year of the impact
// study, 2026 = first year. Other cohorts: no paragraph.
const ESTUDIO_EDI = {
  2025: ['Después de dos años de implementación, esta encuesta y el Test de Estudiantes son el último hito del estudio'],
  2026: ['En este primer año de implementación, esta encuesta y el Test de Estudiantes son una pieza clave del estudio'],
};
function correoEfa_(res, progs, enc, clave, testEnviado, cohorte) {
  const uno = enc.length === 1;
  const tu = (a, b) => (uno ? a : b);
  const e = escHtml_;
  const nombres = enc.map(x => x.nombre).filter(Boolean);
  const titulos = progs.map(p => TITULO_PROGRAMA[p.programa]);
  const programa = titulos.length > 1 ? `de los programas de ${conY_(titulos)}` : `del programa de ${titulos[0]}`;
  const v = res.encuestas.efa;
  const abre = fechaLarga_(v.abre), cierra = fechaLarga_(v.cierra);
  const contacto = res.contacto;
  const colegio = res.colegio.nombre || `RBD ${res.colegio.rbd}`;
  const asunto = `Encuesta de Fin de Año 2026 · ${colegio}`;

  const saludo = `Hola${nombres.length ? ', ' + conY_(nombres) : ''}:`;
  const intro = `${tu('Te escribimos', 'Les escribimos')} de Fundación Trabün para ${tu('contarte', 'contarles')} que la Encuesta de Fin de Año ${programa}`
    + (abre && cierra ? ` estará disponible desde el ${abre} hasta el ${cierra}.` : ' estará disponible pronto.')
    + ` La responden directivos, líderes y docentes que participan en ${titulos.length > 1 ? 'los programas' : 'el programa'}.`;
  const edi = ESTUDIO_EDI[cohorte];
  const estudio = edi ? `${tu('Tu', 'Su')} colegio forma parte del Estudio de Impacto del programa. ${edi[0]}, por eso ${tu('tu', 'su')} opinión es tan valiosa. `
    + `${tu('Te', 'Les')} pedimos, por favor, que la ${tu('respondas', 'respondan')} con calma y a conciencia.` : '';
  const reparto = 'Cada persona va a recibir la invitación en su correo, pero es posible que no le llegue a todo el equipo. '
    + `Por eso ${tu('te', 'les')} pedimos compartir el link con ${tu('tu', 'su')} equipo y recordarles que la respondan.`;
  const portalA = 'En el ', portalB = `${testEnviado ? ', el mismo del Test de Estudiantes,' : ''} ${tu('vas', 'van')} a encontrar:`;
  const items = [
    ['El link de la encuesta', `de ${tu('tu', 'su')} colegio, listo para copiar o enviar por WhatsApp con un mensaje para el equipo.`, COLOR.naranjo],
    ['Quiénes ya respondieron', `en dirección, líderes educativos y docentes (solo quién respondió, nunca sus respuestas), para que ${tu('puedas', 'puedan')} recordarle a quien falte.`, COLOR.rojo],
  ];
  const entrar = testEnviado ? `${tu('Entra', 'Entren')} con el mismo RBD y clave que ${tu('te', 'les')} enviamos el ${fechaCorta_(testEnviado)}`
    : `${tu('Entra', 'Entren')} al portal con estos datos`;
  // Narrower than the Test email (Mau 30-10-2026): the EFA panel lists colleagues by name, so not the whole team
  const reserva = `La clave es para ${tu('ti', 'ustedes')} y quienes ${tu('te', 'les')} ayuden con el seguimiento; ${tu('te', 'les')} pedimos no compartirla con nadie más, ya que en el portal se ve quién ha respondido.`;
  const gracias = `¡Muchas gracias por ${tu('tu', 'su')} apoyo!`;
  const pie = `Este es un correo automático, por favor no lo ${tu('respondas', 'respondan')}. Si ${tu('tienes', 'tienen')} cualquier duda, ${tu('escríbenos', 'escríbannos')} a ${contacto}.`;

  const texto = [saludo, intro].concat(estudio ? [estudio] : []).concat([reparto, `${portalA}Portal de Seguimiento 2026${portalB}`, items.map(i => `• ${i[0]}: ${i[1]}`).join('\n'),
    `${entrar}:\nRBD: ${res.colegio.rbd}\nClave: ${clave}\n${PORTAL_URL}`, reserva, gracias, 'Fundación Trabün'])
    .join('\n\n') + '\n\n—\n' + pie;

  const titulo = v.fase === 'open' ? 'La Encuesta de Fin de Año ya está disponible'
    : abre ? `La Encuesta de Fin de Año comienza el ${abre}` : 'La Encuesta de Fin de Año está por comenzar';
  const bajada = (titulos.length > 1 ? `Programas de ${conY_(titulos)}` : `Programa de ${titulos[0]}`) + (cierra ? ` · disponible hasta el ${cierra}` : '');
  const html = correoHtml_({ titulo, bajada, contacto, pie, gracias, reserva, entrar, rbd: res.colegio.rbd, clave,
    parrafos: [e(saludo), e(intro)].concat(estudio ? [e(estudio)] : []).concat([e(reparto), `${e(portalA)}<b>Portal de Seguimiento 2026</b>${e(portalB)}`]), items, aviso: '' });
  return { asunto, texto, html };
}

// "2026-10-09" → "9 de octubre" (a past date: no weekday)
function fechaCorta_(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${+m[3]} de ${MESES[+m[2] - 1]}` : '';
}

// Shared layout of the announcement emails: table layout and inline styles (what Gmail and Outlook render), brand
// colors, Lato with Arial fallback, no icons; logo inside the email (cid:logo). o.parrafos are HTML (already escaped).
function correoHtml_(o) {
  const e = escHtml_;
  const fuente = "font-family:Lato,'Helvetica Neue',Arial,sans-serif";
  const parrafo = s => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:${COLOR.tinta}">${s}</p>`;
  const caja = (fondo, borde, interior) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${fondo};border-left:5px solid ${borde};border-radius:12px;margin:0 0 12px"><tr><td style="padding:14px 18px">${interior}</td></tr></table>`;
  const franja = [COLOR.rojo, COLOR.naranjo, COLOR.verde, COLOR.celeste, COLOR.amarillo]
    .map(c => `<td height="6" style="height:6px;background:${c};font-size:0;line-height:0">&nbsp;</td>`).join('');
  const dato = (k, v) => `<tr><td style="padding:3px 18px 3px 0;font-size:14px;color:${COLOR.tinta}">${k}</td><td style="padding:3px 0;font-size:22px;font-weight:bold;letter-spacing:1px;color:${COLOR.tinta};font-family:Menlo,Consolas,'Courier New',monospace">${e(v)}</td></tr>`;
  return `<div style="margin:0;padding:24px 12px;background:${COLOR.gris};${fuente}">
<!--prueba-->
<table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border-collapse:separate">
<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${franja}</tr></table></td></tr>
<tr><td style="padding:26px 32px 0"><img src="cid:logo" width="64" height="59" alt="Fundación Trabün" style="display:block;border:0;outline:none"></td></tr>
<tr><td style="padding:18px 32px 0">
<h1 style="margin:0 0 6px;font-size:24px;line-height:1.25;font-weight:bold;color:${COLOR.tinta}">${e(o.titulo)}</h1>
<p style="margin:0 0 22px;font-size:15px;line-height:1.4;color:${COLOR.tinta};opacity:.8">${e(o.bajada)}</p>
${o.parrafos.map(parrafo).join('')}
${o.items.map(i => caja(COLOR.gris, i[2], `<p style="margin:0;font-size:15px;font-weight:bold;color:${COLOR.tinta}">${e(i[0])}</p><p style="margin:2px 0 0;font-size:14px;line-height:1.45;color:${COLOR.tinta}">${e(i[1].charAt(0).toUpperCase() + i[1].slice(1))}</p>`)).join('')}
${o.aviso ? caja(COLOR.amarilloClaro, COLOR.amarillo, `<p style="margin:0;font-size:14px;line-height:1.45;color:${COLOR.tinta}">${e(o.aviso)}</p>`) : ''}
<div style="height:10px"></div>
${caja(COLOR.celesteClaro, COLOR.celeste, `<p style="margin:0 0 8px;font-size:16px;font-weight:bold;color:${COLOR.tinta}">${e(o.entrar)}</p>
<table role="presentation" cellpadding="0" cellspacing="0">${dato('RBD', o.rbd)}${dato('Clave', o.clave)}</table>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:14px 0 10px"><tr><td style="border-radius:999px;background:${COLOR.rojo}"><a href="${PORTAL_URL}" style="display:inline-block;padding:12px 26px;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:999px">Entrar al portal</a></td></tr></table>
<p style="margin:0;font-size:13px;line-height:1.45;color:${COLOR.tinta}"><a href="${PORTAL_URL}" style="color:${COLOR.tinta}">portal.fundaciontrabun.cl</a> · ${e(o.reserva)}</p>`)}
<div style="height:8px"></div>${parrafo(e(o.gracias))}
<p style="margin:0 0 28px;font-size:15px;line-height:1.45;font-weight:bold;color:${COLOR.tinta}">Fundación Trabün</p>
</td></tr>
<tr><td style="padding:18px 32px;background:${COLOR.gris};font-size:12px;line-height:1.5;color:${COLOR.muted}">${e(o.pie).replace(e(o.contacto), `<a href="mailto:${e(o.contacto)}" style="color:${COLOR.muted}">${e(o.contacto)}</a>`)}</td></tr>
</table></div>`;
}

function logoCorreo_() {
  return Utilities.newBlob(Utilities.base64Decode(LOGO_CORREO_B64), 'image/png', 'logo-trabun.png');
}

function correoDeFila_(fila, ctx, tipo) {
  const rbd = normRbd_(fila.RBD);
  const res = panel_(rbd, ctx.d, ctx.reloj);
  const progs = res.programas.filter(p => String(fila.Programas).toUpperCase().split(/\s*\+\s*/).indexOf(p.programa.toUpperCase()) >= 0);
  const lista = s => String(s == null ? '' : s).split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(x => RE_CORREO.test(x));
  const enc = lista(fila.Para).map(email => (ctx.encargados.porRbd[rbd] || []).find(x => x.email === email) || { email, nombre: '' });
  if (!progs.length || !enc.length) return null;
  return Object.assign(correoDe_(tipo, res, progs, enc, ctx),
    { para: enc.map(x => x.email).join(','), cc: lista(fila.CC).filter(c => !enc.some(x => x.email === c)).join(','), replyTo: res.contacto });
}

function filasCorreos_(tipo) {
  const conf = CORREOS[tipo];
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(conf.tab);
  if (!sh) throw new Error(`Falta la pestaña ${conf.tab}: corre primero ${conf.preparar}().`);
  const t = leerTabla_(conf.tab);
  return { sh, t, filas: t.rows.map((r, i) => { const o = { fila: i + 2 }; t.headers.forEach((h, j) => { o[h] = r[j]; }); return o; }) };
}

function contextoCorreos_() {
  return { d: cargarDatos_(), reloj: reloj_(), claves: leerClaves_(), encargados: leerEncargados_(), testEnviado: testEnviado_() };
}

// RBD → clave (Contraseñas; the first row of an RBD wins)
function leerClaves_() {
  const tc = leerTabla_(TABS.claves);
  const cR = colExacta_(tc, 'rbd'), cC = colExacta_(tc, 'clave');
  const claves = {};
  tc.rows.forEach(r => { const rbd = normRbd_(r[cR]); if (rbd && !claves[rbd]) claves[rbd] = String(r[cC]).trim(); });
  return claves;
}

// RBD → date and recipients of the Test announcement (Correos Test → Enviado, Para), so the EFA email can say
// "the same clave we sent you on…" only to people who got it (an encargado may have changed since)
function testEnviado_() {
  const out = {};
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_CORREOS)) return out;
  const t = leerTabla_(TAB_CORREOS);
  const iR = t.headers.indexOf('RBD'), iS = t.headers.indexOf('Enviado'), iP = t.headers.indexOf('Para');
  if (iR < 0 || iS < 0 || iP < 0) return out;
  t.rows.forEach(r => {
    const rbd = normRbd_(r[iR]), fecha = fechaIso_(r[iS]);
    const para = String(r[iP] == null ? '' : r[iP]).split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(x => RE_CORREO.test(x));
    if (rbd && fecha) out[rbd] = { fecha, para };
  });
  return out;
}

// Sends up to 3 sample emails (one encargado, several encargados, EDI), subject "[PRUEBA] …", only to the addresses in
// Config "correos_prueba" (comma-separated; kept in the Sheet, never in this public repo) or else to whoever runs it.
// Never CCs anyone; a box at the top shows who would get the real one.
function enviarCorreoPrueba_(tipo) {
  const { filas } = filasCorreos_(tipo);
  const ctx = contextoCorreos_();
  const lista = String((ctx.d.cfg || {}).correos_prueba || '').split(/[\s,;]+/).filter(x => RE_CORREO.test(x));
  const yo = lista.length ? lista.join(',') : Session.getActiveUser().getEmail();
  if (!yo) throw new Error('No se pudo saber a quién enviar la prueba: agrega correos_prueba en Config.');
  const listas = filas.filter(f => esVerdadero_(f.Enviar) && !f.Enviado);
  const muestras = [listas.find(f => String(f.Para).indexOf(',') < 0), listas.find(f => String(f.Para).indexOf(',') >= 0),
    listas.find(f => String(f.Contacto) !== CONTACTO_DEFECTO)].filter((f, i, a) => f && a.indexOf(f) === i);
  muestras.forEach(f => {
    const c = correoDeFila_(f, ctx, tipo);
    if (!c) return;
    const aviso = `<div style="max-width:600px;margin:0 auto 12px;padding:10px 14px;border:1px dashed ${COLOR.muted};border-radius:10px;font-size:12px;line-height:1.5;color:${COLOR.tinta};background:#ffffff">`
      + `<b>Correo de prueba.</b> En el envío real va a: ${escHtml_(c.para.replace(/,/g, ', '))}${c.cc ? ` · CC: ${escHtml_(c.cc.replace(/,/g, ', '))}` : ''}</div>`;
    MailApp.sendEmail({ to: yo, subject: `[PRUEBA] ${c.asunto}`, body: `[Prueba · Para: ${c.para} · CC: ${c.cc || '—'}]\n\n${c.texto}`,
      htmlBody: c.html.replace('<!--prueba-->', aviso), inlineImages: { logo: logoCorreo_() }, name: 'Fundación Trabün', replyTo: c.replyTo });
  });
  console.log(`${muestras.length} correos de prueba enviados.`); // counts only
  return `${muestras.length} correos de prueba enviados a ${yo}.`;
}

// Sends every row with Enviar ticked and Enviado empty (Para + CC as in the row); stamps Enviado right after each send,
// so a re-run never sends twice. Stops before the daily quota or ~5 min (Apps Script limit): run it again to continue.
function enviarCorreos_(tipo) {
  const { sh, t, filas } = filasCorreos_(tipo);
  const cEnviado = t.headers.indexOf('Enviado') + 1;
  const ctx = contextoCorreos_();
  const inicio = Date.now();
  let enviados = 0, pendientes = 0, sinCorreo = 0;
  for (const f of filas) {
    if (!esVerdadero_(f.Enviar) || f.Enviado) continue;
    const c = correoDeFila_(f, ctx, tipo);
    if (!c) { sinCorreo++; continue; }
    const n = c.para.split(',').length + (c.cc ? c.cc.split(',').length : 0);
    if (Date.now() - inicio > 5 * 60 * 1000 || MailApp.getRemainingDailyQuota() < n) { pendientes++; continue; }
    const correo = { to: c.para, subject: c.asunto, body: c.texto, htmlBody: c.html.replace('<!--prueba-->', ''), inlineImages: { logo: logoCorreo_() }, name: 'Fundación Trabün', replyTo: c.replyTo };
    if (c.cc) correo.cc = c.cc;
    MailApp.sendEmail(correo);
    sh.getRange(f.fila, cEnviado).setValue(new Date());
    enviados++;
  }
  const texto = `Enviados: ${enviados}.` + (pendientes ? ` Quedan ${pendientes}: vuelve a correr ${CORREOS[tipo].enviar}() (o mañana, si se acabó la cuota diaria).` : ' No quedan pendientes.')
    + (sinCorreo ? ` ${sinCorreo} filas marcadas no se pudieron armar (sin programas o sin correos): revisa Observaciones.` : '');
  console.log(texto); // counts only, never emails or claves
  return texto;
}

// ── EFA-EDI reminder to each pending person (Mau 17-11-2026) ─
// Sent from the account that runs it (Mau's own Gmail), shown as «Mauricio de Trabün»; replies go to that account.
// Three steps like the announcements: prepararCorreosFaltan() → tab «Correos Faltan» (one row per person, review +
// Enviar), enviarCorreoPruebaFaltan() → up to 3 samples to whoever runs it, enviarCorreosFaltan() → sends, stamping Enviado.
// Who: the people in the portal's «Faltan por responder» (faltanEdi_), recomputed at each step: anyone who answered after
// the tab was prepared is skipped at send time. One email per person; several addresses go together in To (Mau 17-11-2026:
// only when we're sure it's the same person): every address whose record joined by its own row, RUT or email, plus an
// address joined only by name when it is a near copy of another (a typo: one of them bounces) or the person's only one.
// Any other is listed in «No se envía a» (Mau can move it to Para).
const TAB_CORREOS_FALTAN = 'Correos Faltan';
const COLS_CORREOS_FALTAN = ['RBD', 'Colegio', 'Persona', 'Rol', 'Para', 'No se envía a', 'Asunto', 'Mensaje', 'Observaciones', 'Enviar', 'Enviado'];
const REMITENTE_FALTAN = 'Mauricio de Trabün';

// Two addresses at most two edits apart (letters changed, added, dropped or swapped): "ana.rojass@x" / "ana.rojas@x"
function casiIgual_(a, b) {
  if (Math.abs(a.length - b.length) > 2) return false;
  const d = [];
  for (let i = 0; i <= a.length; i++) { d[i] = [i]; for (let j = 1; j <= b.length; j++) d[i][j] = i ? 0 : j; }
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length] <= 2;
}

function destinosFaltan_(per) {
  const ok = per.vias.filter(v => RE_CORREO.test(v.correo));
  const para = ok.filter(v => v.via !== 'nombre').map(v => v.correo), dudosos = [];
  ok.filter(v => v.via === 'nombre').forEach(v => (!para.length || para.some(c => casiIgual_(c, v.correo)) ? para : dudosos).push(v.correo));
  return { para, dudosos, malos: per.vias.filter(v => !RE_CORREO.test(v.correo)).map(v => v.correo) };
}

const claveFaltan_ = (rbd, persona) => normRbd_(rbd) + '|' + normTexto_(persona);

// Every pending person of every treated ASE EDI program whose EFA is open or in its extra week
function personasFaltan_(d, reloj) {
  const out = {};
  Object.keys(d.sf).forEach(rbd => {
    const p = d.sf[rbd].programas.ase;
    if (!p || !p.edi || normTexto_(p.modelo) === 'control') return;
    const res = panel_(rbd, d, reloj);
    const pr = res.programas.find(x => x.programa === 'ase');
    if (!pr || !pr.efa.pendientes) return; // phase open/extra and the lists have the school
    const f = faltanEdi_(rbd, p, d, d.efa.filter(x => x.rbd === rbd && x.programa === 'ase'));
    f.faltan.forEach(per => { out[claveFaltan_(rbd, nombreEdi_(per))] = { rbd, res, pr, per, lider: f.esLider(per) }; });
  });
  return out;
}

function rolFaltan_(x) {
  if (x.lider) return etiquetaEdi_(x.per);
  const niveles = [];
  x.per.clases.forEach(k => { if (niveles.indexOf(k.nivel) < 0) niveles.push(k.nivel); });
  return 'Docente · ' + niveles.sort((a, b) => a - b).map(i => NIVELES[i] + ' ' + x.per.clases.filter(k => k.nivel === i && k.letra)
    .map(k => k.letra).sort().join(', ')).map(t => t.trim()).join('; ');
}

// Portal look for the reminder email (Mau 17-11-2026): header = login screen (logo, waving mascot, orange and celeste
// waves into the white body), footer = wave into navy with the white isotipo. PNGs rendered from the portal's own SVG
// paths and images (email clients don't render SVG), 2x for sharp screens, sent inside the email (cid).
const BANNER_FALTAN_B64 = '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';
const OLA_PIE_B64 = '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';
const ISOTIPO_BLANCO_B64 = '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';
const imagenesFaltan_ = () => ({
  banner: Utilities.newBlob(Utilities.base64Decode(BANNER_FALTAN_B64), 'image/png', 'trabun-encabezado.png'),
  ola: Utilities.newBlob(Utilities.base64Decode(OLA_PIE_B64), 'image/png', 'trabun-ola.png'),
  isotipo: Utilities.newBlob(Utilities.base64Decode(ISOTIPO_BLANCO_B64), 'image/png', 'trabun-isotipo.png'),
});
// Short form of ESTUDIO_EDI by cohort (Mau 17-11-2026): 2025 = second and last year of the study, 2026 = first
const HITO_EDI = { 2025: 'el último hito del estudio', 2026: 'una pieza clave del estudio' };
// usted, warm (Mau 17-11-2026), from Mau to one person; the school is named in the first paragraph. Closing date from Config (the
// extension when there is one), never hardcoded. HTML in the portal's look: header and footer images (cid), one button.
function correoFaltan_(x) {
  const { res, pr, per } = x;
  const v = res.encuestas.efa;
  const cierre = fechaLarga_(v.extension || v.cierra);
  const colegio = res.colegio.nombre || `RBD ${res.colegio.rbd}`;
  const l0 = (pr.efa.links || [])[0] || {};
  const link = l0.link || '';
  // Footer (copied by hand): the portal's short EFA link, same rule as urlCorta() in docs/index.html ("_" and spaces →
  // "-"); the button keeps the full link, so the main path never depends on the portal (Mau 17-11-2026)
  const corto = link && l0.form ? `${PORTAL_URL}/e/?${res.colegio.rbd}-${encodeURIComponent(String(l0.form).replace(/[_\s]+/g, '-'))}` : link;
  const nombre = nombrePropio_(per.nombres);
  const hito = HITO_EDI[pr.cohorte];
  const asunto = 'Aún nos falta su respuesta · Encuesta de Fin de Año 2026'; // Mau 17-11-2026
  const saludo = `Hola${nombre ? ', ' + nombre : ''}:`;
  const p1 = `Le escribo porque aún no hemos recibido su respuesta a la Encuesta de Fin de Año del programa de Aprendizaje Socioemocional en su colegio, ${colegio}. `
    + 'Sabemos que son semanas de mucho trabajo, así que de verdad le agradecemos el tiempo.';
  const p2 = `La encuesta está abierta hasta el ${cierre} y toma unos 20 minutos:`;
  const p3 = `Su colegio forma parte del Estudio de Impacto del programa${hito ? ' y esta encuesta es ' + hito : ''}, por eso su opinión es tan valiosa para nosotros. `
    + 'Le pido, por favor, que la responda con calma y a conciencia.';
  const p4 = 'Si ya la respondió, ¡muchas gracias! Solo respóndame este correo y lo reviso.';
  const firma = ['Un abrazo,', 'Mauricio', 'Fundación Trabün'];
  const texto = [saludo, p1, p2 + '\n' + link, p3, p4, firma.join('\n')].join('\n\n');

  const e = escHtml_;
  const fuente = "font-family:Lato,'Helvetica Neue',Arial,sans-serif";
  const parrafo = t => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${COLOR.tinta}">${t}</p>`;
  const html = `<div style="margin:0;padding:20px 12px;background:${COLOR.gris};${fuente}">
<!--prueba-->
<table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border-collapse:separate">
<tr><td style="line-height:0;font-size:0"><img src="cid:banner" width="560" alt="Fundación Trabün" style="display:block;width:100%;max-width:560px;height:auto;border:0;outline:none"></td></tr>
<tr><td style="padding:6px 32px 4px">
<h1 style="margin:0 0 18px;font-size:23px;line-height:1.25;font-weight:800;color:${COLOR.tinta}">Aún está a tiempo</h1>
${parrafo(e(saludo))}${parrafo(e(p1))}${parrafo(e(p2))}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 24px"><tr><td style="border-radius:999px;background:${COLOR.rojo}"><a href="${e(link)}" style="display:inline-block;padding:14px 30px;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:999px">Responder la encuesta</a></td></tr></table>
${parrafo(e(p3))}${parrafo(e(p4))}
<p style="margin:6px 0 22px;font-size:15px;line-height:1.5;color:${COLOR.tinta}">${firma.map((t, i) => (i === 1 ? `<b>${e(t)}</b>` : e(t))).join('<br>')}</p>
</td></tr>
<tr><td style="line-height:0;font-size:0"><img src="cid:ola" width="560" alt="" style="display:block;width:100%;max-width:560px;height:auto;border:0"></td></tr>
<tr><td style="padding:6px 32px 22px;background:${COLOR.tinta}">
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:12px;vertical-align:middle"><img src="cid:isotipo" width="30" height="30" alt="" style="display:block;border:0"></td>
<td style="vertical-align:middle;font-size:13px;font-weight:bold;color:#ffffff">Fundación Trabün</td></tr></table>
<p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:${COLOR.celesteClaro}">Si el botón no funciona, copie este link en su navegador:<br><a href="${e(corto)}" style="color:${COLOR.celesteClaro};word-break:break-all">${e(corto.replace(/^https:\/\//, ''))}</a></p>
</td></tr>
</table></div>`;
  return { asunto, texto, html, link };
}

function prepararCorreosFaltan() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const personas = personasFaltan_(cargarDatos_(), reloj_());
  let sh = ss.getSheetByName(TAB_CORREOS_FALTAN);
  const previo = {};
  if (sh && sh.getLastRow() > 1) {
    const t = leerTabla_(TAB_CORREOS_FALTAN);
    t.rows.forEach(r => { const o = {}; t.headers.forEach((h, j) => { o[h] = r[j]; }); previo[claveFaltan_(o.RBD, o.Persona)] = o; });
  }
  const filas = [];
  Object.keys(personas).forEach(k => {
    const x = personas[k];
    const c = correoFaltan_(x);
    const dest = destinosFaltan_(x.per);
    const obs = [];
    if (!dest.para.length) obs.push('Sin correo');
    if (dest.dudosos.length) obs.push('Otro correo unido solo por nombre: revisa «No se envía a»');
    if (dest.malos.length) obs.push('Correo no válido: ' + dest.malos.join(', '));
    if (!c.link) obs.push('Sin link EFA');
    const antes = previo[k];
    const listo = !!(dest.para.length && c.link);
    filas.push([x.rbd, x.res.colegio.nombre || '', nombreEdi_(x.per), rolFaltan_(x), dest.para.join(', '), dest.dudosos.join(', '),
      c.asunto, c.texto, obs.join(' · '), listo && (antes ? esVerdadero_(antes.Enviar) : true), antes ? antes.Enviado || '' : '']);
    delete previo[k];
  });
  // Already emailed and no longer pending (they answered): kept as a record, never sent again
  Object.keys(previo).forEach(k => {
    const o = previo[k];
    if (o.Enviado) filas.push(COLS_CORREOS_FALTAN.map(h => (h === 'Enviar' ? false : h === 'Observaciones' ? 'Ya no aparece como pendiente' : o[h] == null ? '' : o[h])));
  });
  filas.sort((a, b) => (normTexto_(a[1]) < normTexto_(b[1]) ? -1 : normTexto_(a[1]) > normTexto_(b[1]) ? 1 : normTexto_(a[2]) < normTexto_(b[2]) ? -1 : 1));

  if (!sh) sh = ss.insertSheet(TAB_CORREOS_FALTAN, ss.getNumSheets());
  const viejas = sh.getLastRow();
  if (viejas > 0) sh.getRange(1, 1, viejas, Math.max(sh.getLastColumn(), COLS_CORREOS_FALTAN.length)).clearContent().clearDataValidations();
  sh.getRange(1, 1, 1, COLS_CORREOS_FALTAN.length).setValues([COLS_CORREOS_FALTAN]).setFontWeight('bold');
  const iEnviar = COLS_CORREOS_FALTAN.indexOf('Enviar'), iEnviado = COLS_CORREOS_FALTAN.indexOf('Enviado');
  if (filas.length) {
    sh.getRange(2, iEnviar + 1, filas.length, 1).insertCheckboxes();
    sh.getRange(2, 1, filas.length, COLS_CORREOS_FALTAN.length).setValues(filas);
  }
  const aEnviar = filas.filter(f => f[iEnviar] === true && !f[iEnviado]);
  const texto = `${TAB_CORREOS_FALTAN}: ${filas.length} personas · ${aEnviar.length} por enviar (${new Set(aEnviar.map(f => f[0])).size} colegios) · `
    + `${filas.filter(f => f[8] && f[8] !== 'Ya no aparece como pendiente').length} con observaciones.`;
  console.log(texto); // counts only
  return texto;
}

function filasFaltan_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_CORREOS_FALTAN);
  if (!sh) throw new Error(`Falta la pestaña ${TAB_CORREOS_FALTAN}: corre primero prepararCorreosFaltan().`);
  const t = leerTabla_(TAB_CORREOS_FALTAN);
  return { sh, t, filas: t.rows.map((r, i) => { const o = { fila: i + 2 }; t.headers.forEach((h, j) => { o[h] = r[j]; }); return o; }) };
}
const paraFila_ = f => String(f.Para == null ? '' : f.Para).split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(x => RE_CORREO.test(x));

// Up to 3 samples (a leader, a teacher, a person with two addresses), only to whoever runs it, subject "[PRUEBA] …",
// with a box saying who would get the real one
function enviarCorreoPruebaFaltan() {
  const { filas } = filasFaltan_();
  const personas = personasFaltan_(cargarDatos_(), reloj_());
  const yo = Session.getActiveUser().getEmail();
  if (!yo) throw new Error('No se pudo saber a quién enviar la prueba.');
  const listas = filas.filter(f => esVerdadero_(f.Enviar) && !f.Enviado && personas[claveFaltan_(f.RBD, f.Persona)] && paraFila_(f).length);
  const muestras = [listas.find(f => !/^Docente/.test(f.Rol)), listas.find(f => /^Docente/.test(f.Rol)), listas.find(f => paraFila_(f).length > 1)]
    .filter((f, i, a) => f && a.indexOf(f) === i);
  muestras.forEach(f => {
    const c = correoFaltan_(personas[claveFaltan_(f.RBD, f.Persona)]);
    const aviso = `<div style="max-width:560px;margin:0 auto 12px;padding:10px 14px;border:1px dashed ${COLOR.muted};border-radius:10px;font-size:12px;background:#ffffff">`
      + `<b>Correo de prueba.</b> En el envío real va a: ${escHtml_(paraFila_(f).join(', '))}</div>`;
    MailApp.sendEmail({ to: yo, subject: `[PRUEBA] ${c.asunto}`, body: `[Prueba · Para: ${paraFila_(f).join(', ')}]\n\n${c.texto}`,
      htmlBody: c.html.replace('<!--prueba-->', aviso), inlineImages: imagenesFaltan_(), name: REMITENTE_FALTAN });
  });
  console.log(`${muestras.length} correos de prueba enviados.`);
  return `${muestras.length} correos de prueba enviados a ${yo}.`;
}

// Sends every row with Enviar ticked and Enviado empty to the addresses in Para (Mau may edit them), text rebuilt now;
// skips anyone who answered since the tab was prepared. Stamps Enviado after each send (a re-run never sends twice);
// stops before the daily quota or ~5 min: run it again to continue.
function enviarCorreosFaltan() {
  const { sh, t, filas } = filasFaltan_();
  const cEnviado = t.headers.indexOf('Enviado') + 1, cObs = t.headers.indexOf('Observaciones') + 1;
  const personas = personasFaltan_(cargarDatos_(), reloj_());
  const inicio = Date.now();
  let enviados = 0, pendientes = 0, respondieron = 0, sinCorreo = 0;
  for (const f of filas) {
    if (!esVerdadero_(f.Enviar) || f.Enviado) continue;
    const x = personas[claveFaltan_(f.RBD, f.Persona)];
    if (!x) { respondieron++; sh.getRange(f.fila, cObs).setValue('Respondió antes del envío: no se envió'); continue; }
    const para = paraFila_(f);
    if (!para.length) { sinCorreo++; continue; }
    if (Date.now() - inicio > 5 * 60 * 1000 || MailApp.getRemainingDailyQuota() < para.length) { pendientes++; continue; }
    const c = correoFaltan_(x);
    if (!c.link) { sinCorreo++; continue; }
    MailApp.sendEmail({ to: para.join(','), subject: c.asunto, body: c.texto, htmlBody: c.html.replace('<!--prueba-->', ''), inlineImages: imagenesFaltan_(), name: REMITENTE_FALTAN });
    sh.getRange(f.fila, cEnviado).setValue(new Date());
    enviados++;
  }
  const texto = `Enviados: ${enviados}.` + (respondieron ? ` ${respondieron} ya respondieron y no se les envió.` : '')
    + (pendientes ? ` Quedan ${pendientes}: vuelve a correr enviarCorreosFaltan() (o mañana, si se acabó la cuota diaria).` : ' No quedan pendientes.')
    + (sinCorreo ? ` ${sinCorreo} filas marcadas sin correo o sin link: revisa Observaciones.` : '');
  console.log(texto); // counts only, never emails or names
  return texto;
}

// ── Fake test data (staging only; cleared by hand at launch) ─

const FAKE_NOMBRES = ['Agustín', 'Martina', 'Benjamín', 'Sofía', 'Vicente', 'Isidora', 'Matías', 'Florencia', 'Lucas',
  'Antonia', 'Joaquín', 'Emilia', 'Tomás', 'Josefa', 'Maximiliano', 'Trinidad', 'Gaspar', 'Amanda', 'Clemente',
  'Rafaela', 'Diego', 'Catalina', 'Felipe', 'Javiera', 'Ignacio', 'Valentina', 'Bastián', 'Fernanda', 'Simón', 'Julieta'];
const FAKE_APELLIDOS = ['Bravo', 'Castro', 'Díaz', 'Espinoza', 'Fuentes', 'González', 'Hidalgo', 'Ibáñez', 'Jara', 'Klein',
  'López', 'Muñoz', 'Navarro', 'Olivares', 'Pérez', 'Quiroz', 'Rojas', 'Silva', 'Torres', 'Urrutia', 'Vargas', 'Yáñez',
  'Zamora', 'Araya', 'Bustos', 'Cárdenas', 'Donoso', 'Escobar', 'Morales', 'Núñez'];
// The 2026 survey options, as SurveyMonkey writes them (REL and ASE share most; EDI has its own wording)
const ROLES_FAKE = {
  director: 'Director/a del establecimiento',
  encargado: 'Encargado/a del Programa, es decir, estoy a cargo de la relación del establecimiento con la Fundación',
  mentor: 'Mentor/a, es decir, acompaño y retroalimento a docentes que implementan el Programa',
  ambos: 'Cumplo ambos roles, es decir, soy Encargado/a y Mentor/a del Programa',
  todos: 'Cumplo todos los roles: Encargado/a, Mentor/a y Docente', // REL only, no grades asked
  otro: 'Otro/a líder del establecimiento (UTP, coordinador/a u otros)',
  ase: 'Docente que implementa el Programa ASE-Orientación de Trabün',
  rel: 'Docente que implementa el Programa de Religión de Trabün',
  ediDocente: 'Soy Docente e implemento el Programa de ASE-Orientación Trabün en sala de clases',
  ediMentor: 'Soy Mentor/a del programa, es decir, acompaño y retroalimento a docentes que implementan el programa.',
  ediEncargado: 'Soy Encargado del programa, es decir, estoy a cargo de la relación del establecimiento con Trabün.',
  ediDirectivo: 'Equipo Directivo / Convivencia Escolar.',
};

// ── Claves nuevas (manual, run once from the editor) ───────

const TAB_CLAVES_NUEVAS = 'Claves 2026'; // not in TABS: nothing reads it (Cloud Run reads every TABS entry)
// 6 characters like today's claves. No 0/o/1/l (easily confused) and no "e" (Sheets reads "3e4567" as a number).
const ALFABETO_CLAVES = 'abcdfghijkmnpqrstuvwxyz23456789';

/**
 * Writes a new random clave for every RBD in Contraseñas to a new tab (TAB_CLAVES_NUEVAS), as plain text.
 * Contraseñas is NOT modified: Mau reviews the tab and copies the claves over. Refuses to run if the tab
 * already has rows. Claves never go to the log.
 */
function generarClavesNuevas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const existente = ss.getSheetByName(TAB_CLAVES_NUEVAS);
  if (existente && existente.getLastRow() > 0) throw new Error(`${TAB_CLAVES_NUEVAS} ya tiene filas. Bórrala si quieres generar claves de nuevo.`);
  const t = leerTabla_(TABS.claves);
  const cRbd = colExacta_(t, 'rbd');
  const cClave = colExacta_(t, 'clave');
  const rbds = [];
  const usadas = new Set();
  t.rows.forEach(r => {
    const rbd = normRbd_(r[cRbd]);
    if (rbd && rbds.indexOf(rbd) < 0) rbds.push(rbd);
    usadas.add(String(r[cClave]).trim());
  });
  const filas = rbds.map(rbd => {
    let c;
    do { c = claveAleatoria_(); } while (usadas.has(c));
    usadas.add(c);
    return [rbd, c];
  });
  const sh = existente || ss.insertSheet(TAB_CLAVES_NUEVAS, ss.getNumSheets());
  sh.getRange(1, 1, filas.length + 1, 2).setNumberFormat('@'); // text, so a clave is never turned into a number
  sh.getRange(1, 1, filas.length + 1, 2).setValues([['rbd', 'clave']].concat(filas));
  const texto = `${TAB_CLAVES_NUEVAS}: ${filas.length} claves nuevas (distintas entre sí y de las actuales). ` +
    'Contraseñas no fue modificada: revisa la pestaña y copia la columna clave a Contraseñas cuando quieras activarlas.';
  console.log(texto); // counts only, never claves
  return texto;
}

// Secure randomness: Utilities.getUuid() is a v4 UUID; its first 8 hex digits are random.
// Rejection sampling keeps every character equally likely. At least one letter and one digit.
function claveAleatoria_() {
  const n = ALFABETO_CLAVES.length;
  const tope = 256 - (256 % n);
  for (;;) {
    let c = '';
    while (c.length < 6) {
      const hex = Utilities.getUuid().replace(/-/g, '').slice(0, 8);
      for (let i = 0; i < 8 && c.length < 6; i += 2) {
        const b = parseInt(hex.slice(i, i + 2), 16);
        if (b < tope) c += ALFABETO_CLAVES[b % n];
      }
    }
    if (/[a-z]/.test(c) && /[0-9]/.test(c)) return c;
  }
}

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
  const conEfa = p => formulariosDe_(forms, 'efa', p).some(f => f.link); // EFA rows only where the school has the survey
  const casos = [ // most specific first, so a rare case isn't used up by a broad one
    ['ASE EDI cohorte 2025', ps => ps.some(p => p.programa === 'ase' && p.edi && p.anioInicio === 2025)],
    ['ASE EDI cohorte 2026', ps => ps.some(p => p.programa === 'ase' && p.edi && p.anioInicio === 2026)],
    ['SIP con EFA (excepción)', (ps, col) => /sociedad de instruccion primaria/.test(normTexto_(col.sostenedor)) && ps.some(conEfa)],
    ['Religión sin Test, con EFA (solo 1° a 4° básico)', ps => ps.some(p => p.programa === 'rel' && !conTest(p) && conEfa(p))],
    ['Sin niveles con Test (sin respuestas de estudiantes)', ps => ps.some(p => !conTest(p))],
    ['ASE + Religión', ps => ps.length === 2 && ps.every(conTest)],
    ['Religión sola', ps => ps.length === 1 && ps[0].programa === 'rel' && conTest(ps[0])],
    ['ASE sin EDI', ps => ps.length === 1 && ps[0].programa === 'ase' && !ps[0].edi && conTest(ps[0])],
  ];

  const elegidos = [];
  casos.forEach(([caso, pred]) => {
    const cands = Object.keys(sf).sort()
      .filter(rbd => conClave.has(rbd) && !elegidos.some(e => e.rbd === rbd))
      .filter(rbd => { const ps = activos(sf[rbd]); return ps.length && pred(ps, sf[rbd]); });
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
  // No Test grade → no student responses: since 07-10-2026 those schools see no Test links (Mau 29-10-2026)
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

// Only for programs with an EFA link (excluded groups never answer); 2026 role options, EDI wording for EDI schools.
function fakeEfa_(p, colegioTxt, forms, rnd, conBordes) {
  const f = formulariosDe_(forms, 'efa', p).find(x => x.link);
  if (!f) return [];
  const form = f.form;
  const persona = (rol, niveles) => {
    const nombre = elegir_(FAKE_NOMBRES, rnd);
    const apellido = elegir_(FAKE_APELLIDOS, rnd);
    const correo = `${normTexto_(nombre)}.${normTexto_(apellido)}.${Math.floor(rnd() * 1e4)}@ejemplo.invalid`
      .replace(/[^a-z0-9.@]/g, '');
    return { Form: form, Fecha: Utilities.formatDate(fechaFake_(rnd), TZ, "yyyy-MM-dd'T'HH:mm:ss"),
      Nombre: nombre, Apellido: apellido, Correo: correo, Colegio: colegioTxt, Rol: rol, Niveles: niveles || '-' };
  };
  const R = ROLES_FAKE, edi = p.programa === 'ase' && p.edi;
  const out = edi
    ? [persona(R.director), persona(R.ediDirectivo), persona(R.ediEncargado), persona(R.ediMentor)]
    : [persona(R.director), persona(R.encargado), persona(R.mentor), persona(R.ambos)];
  if (!edi && rnd() < 0.5) out.push(persona(R.otro));
  if (p.programa === 'ase') {
    const docente = edi ? R.ediDocente : R.ase;
    p.implementados.forEach(i => {
      if (rnd() < 0.75) out.push(persona(docente, NIVELES[i]));
    });
    if (p.implementados.length > 1) {
      out.push(persona(docente, p.implementados.slice(0, 2).map(i => NIVELES[i]).join(', '))); // several grades
    }
  } else {
    out.push(persona(R.todos)); // listed in Líderes and Docentes, counted once
    const n = 2 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) out.push(persona(R.rel, rnd() < 0.5 ? NIVELES[elegir_(p.implementados, rnd)] : '-'));
  }
  if (conBordes) {
    const doc = out[out.length - 1];
    out.push(Object.assign({}, doc, { Rol: edi ? R.ediMentor : R.mentor, Niveles: '-' }));             // same person, second role
    out.push(Object.assign({}, out[0], { Apellido: out[0].Apellido + ' ' + elegir_(FAKE_APELLIDOS, rnd),  // resubmission
      Fecha: Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss") }));
    if (p.programa === 'ase') {
      const fuera = NIVELES.map((_, i) => i).filter(i => p.implementados.indexOf(i) < 0 && i >= 2);
      if (fuera.length) out.push(persona(edi ? R.ediDocente : R.ase, NIVELES[fuera[fuera.length - 1]]));    // outside registered
    }
  }
  return out;
}

// Header-driven row: each Colegio value lands in one random region column.
// Any header starting with "Colegio" ("Colegio", "Colegio (RBD)" of the SurveyMonkey import), as the readers do.
function filaPorEncabezado_(headers, obj, rnd) {
  const esColegio = h => /^colegio/.test(normTexto_(h));
  const colegios = headers.map((h, i) => (esColegio(h) ? i : -1)).filter(i => i >= 0);
  const destino = colegios[Math.floor(rnd() * colegios.length)];
  return headers.map((h, i) => (esColegio(h) ? (i === destino ? obj.Colegio : '') : (obj[h] == null ? '' : obj[h])));
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
  [TABS.metricas]: ['timestamp', 'rbd', 'programas', 'testOk', 'efaOk', 'evento'],
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
      ['efa_extension', '', 'Semana extra de la EFA (fecha; vacío = sin extensión): el portal sigue mostrando efa_cierra'],
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

// ── Response monitor (time trigger, every minute; Apps Script only) ──
// revisarConteos() counts rows per Form in Respuestas Test and Respuestas EFA (both imports already drop rows without a
// school, so a row with a Form is a response), shows
// them in the Monitor tab and emails when a Form stays below its reference for MONITOR.confirmar checks in a row (5 = about
// 5 minutes; shorter blips are IMPORTRANGE reloading, and Cloud Run holds the previous copy meanwhile): one
// email per drop, another when it recovers. A "REVISAR" row or a tab whose formula shows an error counts as a drop too.
// Reference = highest count confirmed; reiniciarMonitor() accepts the current counts (e.g. after deleting test
// responses). Counts only, never names. Recipients: Config "monitor_correo" (comma-separated) or else the trigger's
// owner. State in script properties. The trigger is created by hand (Activadores → revisarConteos, cada minuto).
const MONITOR = { tab: 'Monitor', estado: 'monitor_estado', historial: 'monitor_historial', confirmar: 5, maxHistorial: 60,
  encuestas: [{ id: 'test', tab: TABS.respTest, nombre: 'Test de Estudiantes' }, { id: 'efa', tab: TABS.respEfa, nombre: 'EFA' }] };
const MONITOR_PESTANA = '(pestaña)';

function revisarConteos() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) return 'Otra revisión en curso';
  try { return revisarConteos_(new Date(), false); } finally { lock.releaseLock(); }
}

function reiniciarMonitor() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return revisarConteos_(new Date(), true); } finally { lock.releaseLock(); }
}

// Reads only the first columns: Form and the third one, where a REVISAR row writes its message.
function contarRespuestas_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) return { error: 'falta la pestaña' };
  const filas = sh.getLastRow(), ancho = sh.getLastColumn();
  if (filas < 1) return { error: 'la pestaña está vacía' };
  const enc = sh.getRange(1, 1, 1, ancho).getDisplayValues()[0].map(h => normTexto_(h));
  const cForm = enc.indexOf('form');
  if (cForm < 0) return { error: 'no encontré la columna Form' };
  const v = filas > 1 ? sh.getRange(2, 1, filas - 1, Math.max(cForm, 2) + 1).getDisplayValues() : [];
  const primera = v.length ? String(v[0][0]).trim() : '';
  if (/^#|^(cargando|loading)/i.test(primera)) return { error: `la fórmula muestra «${primera.slice(0, 80)}»` };
  const porForm = {}, revisar = [];
  v.forEach(r => {
    const aviso = r.map(x => String(x).trim()).find(x => /^REVISAR/i.test(x));
    if (aviso) { if (revisar.indexOf(aviso) < 0) revisar.push(aviso); return; }
    const form = String(r[cForm]).trim();
    if (form) porForm[form] = (porForm[form] || 0) + 1;
  });
  return { porForm, revisar };
}

function revisarConteos_(ahora, reiniciar) {
  const props = PropertiesService.getScriptProperties();
  const st = JSON.parse(props.getProperty(MONITOR.estado) || '{}');
  st.base = st.base || {}; st.bajo = st.bajo || {}; st.alerta = st.alerta || {};
  let hist = JSON.parse(props.getProperty(MONITOR.historial) || '[]');
  const hora = Utilities.formatDate(ahora, TZ, 'dd-MM-yyyy HH:mm:ss');
  const miles = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const nuevas = [], recuperadas = [], filas = [];

  // One key per survey × Form, plus one per survey for the whole tab (REVISAR row or formula error)
  const evaluar = (enc, form, baja, detalle, actual) => {
    const k = enc.id + '|' + form;
    if (reiniciar || !baja) {
      if (st.alerta[k] && !reiniciar) recuperadas.push({ enc, form, detalle });
      delete st.bajo[k]; delete st.alerta[k];
      return 'OK';
    }
    st.bajo[k] = (st.bajo[k] || 0) + 1;
    if (st.bajo[k] >= MONITOR.confirmar && !st.alerta[k]) { st.alerta[k] = hora; nuevas.push({ enc, form, detalle, actual }); }
    return st.alerta[k] ? `Bajó · aviso enviado ${st.alerta[k]}` : `Bajó · ${st.bajo[k]} de ${MONITOR.confirmar} revisiones antes de avisar`;
  };

  MONITOR.encuestas.forEach(enc => {
    const c = contarRespuestas_(enc.tab);
    const problema = c.error || (c.revisar.length ? c.revisar.join(' | ') : '');
    filas.push([enc.nombre, MONITOR_PESTANA, '', '', evaluar(enc, MONITOR_PESTANA, !!problema, problema || 'se lee bien') +
      (problema ? ` · ${problema}` : '')]);
    if (c.error) return; // unreadable tab: keep each Form's state as it was
    const forms = Array.from(new Set(Object.keys(c.porForm).concat(Object.keys(st.base)
      .filter(k => k.startsWith(enc.id + '|') && !k.endsWith('|' + MONITOR_PESTANA)).map(k => k.slice(enc.id.length + 1))))).sort();
    let total = 0;
    forms.forEach(form => {
      const k = enc.id + '|' + form, n = c.porForm[form] || 0, b = st.base[k];
      total += n;
      const baja = b != null && n < b;
      const estado = evaluar(enc, form, baja, `${miles(b)} → ${miles(n)} (−${miles((b || 0) - n)})`, n);
      if (!baja || reiniciar) st.base[k] = n;
      filas.push([enc.nombre, form, n, st.base[k], estado]);
    });
    filas.push([enc.nombre, 'Total', total, '', '']);
  });

  if (reiniciar) hist.unshift([hora, '', '', 'Referencias reiniciadas con los números actuales', '']);
  nuevas.forEach(a => hist.unshift([hora, a.enc.nombre, a.form, a.detalle, 'Aviso de baja']));
  recuperadas.forEach(a => hist.unshift([hora, a.enc.nombre, a.form, '', 'Se recuperó']));
  hist = hist.slice(0, MONITOR.maxHistorial);
  props.setProperty(MONITOR.estado, JSON.stringify(st));
  props.setProperty(MONITOR.historial, JSON.stringify(hist));

  const para = String(leerConfig_().monitor_correo || '').split(/[\s,;]+/).filter(x => RE_CORREO.test(x)).join(',') ||
    Session.getEffectiveUser().getEmail();
  if ((nuevas.length || recuperadas.length) && para) {
    const linea = a => `· ${a.enc.nombre} · ${a.form === MONITOR_PESTANA ? a.enc.tab : a.form}: ${a.detalle}`;
    const partes = ['Hola,', ''];
    if (nuevas.length) partes.push(`En la revisión de las ${hora} bajó el número de respuestas y siguió bajo durante ${MONITOR.confirmar} revisiones seguidas:`, '',
      ...nuevas.map(linea), '', `Revisa las pestañas ${TABS.respTest} / ${TABS.respEfa} y los compilados de SurveyMonkey. ` +
      'Si la baja es esperada (por ejemplo, borraste respuestas de prueba), ejecuta reiniciarMonitor() en el editor de Apps Script ' +
      'para aceptar los números actuales. Te escribo de nuevo cuando se recupere.', '');
    if (recuperadas.length) partes.push(`Se recuperaron (revisión de las ${hora}):`, '',
      ...recuperadas.map(a => `· ${a.enc.nombre} · ${a.form === MONITOR_PESTANA ? a.enc.tab : a.form}`), '');
    const que = nuevas.length ? 'Bajaron las respuestas: ' + nuevas.map(a => a.form === MONITOR_PESTANA ? a.enc.tab : a.form).join(', ')
      : 'Se recuperaron las respuestas: ' + recuperadas.map(a => a.form === MONITOR_PESTANA ? a.enc.tab : a.form).join(', ');
    MailApp.sendEmail({ to: para, subject: `[Portal] ${que}`, body: partes.join('\n'), name: 'Monitor del Portal' });
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(MONITOR.tab) || ss.insertSheet(MONITOR.tab, ss.getNumSheets());
  sh.clearContents();
  sh.getRange(1, 1, 2, 1).setValues([[`Última revisión: ${hora} · avisa a: ${para || '(nadie)'}`],
    [`Una baja se avisa por correo si sigue ${MONITOR.confirmar} revisiones seguidas. Para aceptar números más bajos (p. ej. tras borrar respuestas de prueba), ejecuta reiniciarMonitor().`]]);
  sh.getRange(4, 1, 1, 5).setValues([['Encuesta', 'Form', 'Respuestas ahora', 'Referencia', 'Estado']]).setFontWeight('bold');
  if (filas.length) sh.getRange(5, 1, filas.length, 5).setValues(filas);
  sh.getRange(4, 7, 1, 5).setValues([['Fecha', 'Encuesta', 'Form', 'Cambio', 'Aviso']]).setFontWeight('bold');
  if (hist.length) sh.getRange(5, 7, hist.length, 5).setValues(hist);
  return `${hora}: ${nuevas.length} bajas nuevas, ${recuperadas.length} recuperadas`;
}
