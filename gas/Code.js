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
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (_) { /* malformed → credenciales */ }
  if (body && body.corto !== undefined) return linkCorto_(body.corto); // /t/ page: no clave, returns only what the link carries
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

  if (body.evento !== undefined) return registrarEvento_(rbd, body); // usage event: no panel built

  const res = panel_(rbd, cargarDatos_(), reloj_());
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
    habilitados: intentar_(TABS.sinTest, leerHabilitados_, {}),
  };
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
  const linksTest = links_(formsTest).map(l => Object.assign(l, { link: linkColegio_(l.link, rbd, d.sf[rbd]) }));
  const test = { ok: !!d.test, nivelesTest: testIdx.map(i => NIVELES[i]), nivelesPapel: papelIdx.map(i => NIVELES[i]), links: linksTest,
    habilitado: !!(d.habilitados && d.habilitados[rbd + '|' + p.programa]) };
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

// SurveyMonkey custom variables: the response carries the school's RBD (Respuestas Test reads it) and the
// survey shows "Nombre, Comuna". Same format as the 2026 per-school links file. A link already carrying RBD is kept.
function linkColegio_(link, rbd, col) {
  if (/[?&]RBD=/i.test(link)) return link;
  const texto = col && col.nombre ? [col.nombre, col.comuna].filter(Boolean).join(', ').replace(/\s+/g, ' ').trim() : '';
  const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase());
  return link + (link.indexOf('?') >= 0 ? '&' : '?') + 'RBD=' + enc(rbd) + (texto ? '&colegio=' + enc(texto) : '');
}

// Short Test link shown as text in the portal and the instructivo: "<RBD>-<Form>" (e.g. "12885-REL-5-8") → the
// school's full link. Only if that school-program in SF matches that Test form, so a typo never opens a survey.
function linkCorto_(codigo) {
  const m = String(codigo == null ? '' : codigo).trim().match(/^(\d+)-(.+)$/);
  if (!m) return { ok: false, error: 'link' };
  const rbd = normRbd_(m[1]);
  const d = cargarDatos_();
  const col = d.sf[rbd];
  // Separators ignored: "ASE-6-IV", "ASE_6-IV", "ASE6-IV" (an underlined link hides "_") all name ASE_6-IV
  const clave = s => normTexto_(s).replace(/[^a-z0-9]/g, '');
  const f = d.formularios.find(x => x.encuesta === 'test' && x.link && clave(x.form) === clave(m[2]));
  const p = col && f ? col.programas[f.programa] : null;
  if (!p || !aplica_(f, p)) return { ok: false, error: 'link' };
  return { ok: true, link: linkColegio_(f.link, rbd, col) };
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
    // est: SF Alumnos ÷ CxN for the grade (an average per class), only for SF letters with both values
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
      'login',
    ]);
  } catch (err) {
    console.error('Métricas: ' + (err && err.message));
  }
}

// Usage events sent by the portal, once per session each. Fixed list: anything else is ignored.
const EVENTOS = ['ver_efa',
  'test_copiar_link', 'test_copiar_mensaje', 'test_whatsapp', 'test_qr', 'test_instructivo', 'test_copiar_lista', 'test_whatsapp_lista',
  'efa_copiar_link', 'efa_copiar_mensaje', 'efa_whatsapp', 'efa_qr'];

function registrarEvento_(rbd, body) {
  const programa = body.programa == null ? '' : String(body.programa);
  if (EVENTOS.indexOf(body.evento) < 0 || ['', 'ase', 'rel'].indexOf(programa) < 0) return { ok: false, error: 'evento' };
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABS.metricas);
    if (sh) sh.appendRow([new Date(), rbd, programa.toUpperCase(), '', '', body.evento]);
  } catch (err) {
    console.error('Métricas: ' + (err && err.message));
  }
  return { ok: true };
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

// ── Correos de anuncio del Test (manual, run as evaluacion@ from the editor) ─
// 1) Mau pastes the encargados export into "Encargados" (headers as exported from SF); "correos_jdp" maps each
//    Jefe/a de Proyecto or Coordinador/a name to an email (CC).
// 2) prepararCorreosTest() builds "Correos Test": one row per school, all its encargados together, review + Enviar box.
// 3) enviarCorreoPrueba() sends up to 3 samples to Config "correos_prueba". 4) enviarCorreosTest() sends, stamping Enviado.
// Programs come from SF, never from the encargados' "Programa" column; Control and no-Test programs are left out.

const TAB_ENCARGADOS = 'Encargados'; // not in TABS: Cloud Run never reads people's emails
const TAB_CORREOS_JDP = 'correos_jdp';
const TAB_CORREOS = 'Correos Test';
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

function prepararCorreosTest() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ctx = contextoCorreos_();
  const encargados = ctx.encargados;
  const cJdp = leerCorreosJdp_();

  let sh = ss.getSheetByName(TAB_CORREOS);
  const previo = {};
  if (sh && sh.getLastRow() > 1) {
    const t = leerTabla_(TAB_CORREOS);
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
    // Bien Público programs are not announced; a school left with only those is unticked (Mau can tick it).
    // SIP schools are unticked until the joint email is defined.
    const bp = p => !!(col && col.programas[p.programa] && normTexto_(col.programas[p.programa].proyecto) === 'bien publico');
    const conTest = programasConTest_(res);
    const noBp = conTest.filter(p => !bp(p)), siBp = conTest.filter(bp);
    const progs = noBp.length ? noBp : siBp;
    const sip = !!(col && /sociedad de instruccion primaria/.test(normTexto_(col.sostenedor)));
    const excluida = sip || (!noBp.length && siBp.length > 0);
    if (!res.programas.length) obs.push('No está en SF');
    else if (!progs.length) obs.push('Sin programas con Test (Control o pestaña Sin Test)');
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
    const correo = progs.length && enc.length ? correoTest_(res, progs, enc, ctx.claves[rbd]) : { asunto: '', texto: '' };
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

  if (!sh) sh = ss.insertSheet(TAB_CORREOS, ss.getNumSheets());
  const viejas = sh.getLastRow();
  if (viejas > 0) sh.getRange(1, 1, viejas, Math.max(sh.getLastColumn(), COLS_CORREOS.length)).clearContent().clearDataValidations();
  sh.getRange(1, 1, 1, COLS_CORREOS.length).setValues([COLS_CORREOS]).setFontWeight('bold');
  if (filas.length) {
    sh.getRange(2, iEnviar + 1, filas.length, 1).insertCheckboxes();
    sh.getRange(2, 1, filas.length, COLS_CORREOS.length).setValues(filas);
  }
  const aEnviar = filas.filter(f => f[iEnviar] === true && !f[iEnviado]).length;
  const texto = `${TAB_CORREOS}: ${filas.length} colegios · ${aEnviar} por enviar · ${filas.filter(f => f[iObs]).length} con observaciones.`;
  console.log(texto);
  return texto;
}

// Programs announced: not Control, and with an online Test grade (or ticked Habilitar in "Sin Test")
function programasConTest_(res) {
  return res.programas.filter(p => normTexto_(p.modelo) !== 'control'
    && ((p.test.nivelesTest || []).some(n => (p.nivelesImplementados || []).indexOf(n) >= 0) || p.test.habilitado));
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
  const fuente = "font-family:Lato,'Helvetica Neue',Arial,sans-serif";
  const parrafo = s => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:${COLOR.tinta}">${s}</p>`;
  const caja = (fondo, borde, interior) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${fondo};border-left:5px solid ${borde};border-radius:12px;margin:0 0 12px"><tr><td style="padding:14px 18px">${interior}</td></tr></table>`;
  const franja = [COLOR.rojo, COLOR.naranjo, COLOR.verde, COLOR.celeste, COLOR.amarillo]
    .map(c => `<td height="6" style="height:6px;background:${c};font-size:0;line-height:0">&nbsp;</td>`).join('');
  const dato = (k, v) => `<tr><td style="padding:3px 18px 3px 0;font-size:14px;color:${COLOR.tinta}">${k}</td><td style="padding:3px 0;font-size:22px;font-weight:bold;letter-spacing:1px;color:${COLOR.tinta};font-family:Menlo,Consolas,'Courier New',monospace">${e(v)}</td></tr>`;
  const html = `<div style="margin:0;padding:24px 12px;background:${COLOR.gris};${fuente}">
<!--prueba-->
<table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border-collapse:separate">
<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${franja}</tr></table></td></tr>
<tr><td style="padding:26px 32px 0"><img src="cid:logo" width="64" height="59" alt="Fundación Trabün" style="display:block;border:0;outline:none"></td></tr>
<tr><td style="padding:18px 32px 0">
<h1 style="margin:0 0 6px;font-size:24px;line-height:1.25;font-weight:bold;color:${COLOR.tinta}">${e(titulo)}</h1>
<p style="margin:0 0 22px;font-size:15px;line-height:1.4;color:${COLOR.tinta};opacity:.8">${e(bajada)}</p>
${parrafo(e(saludo))}${parrafo(e(intro))}${parrafo(`${e(portalA)}<b>Portal de Seguimiento 2026</b>${e(portalB)}`)}
${items.map(i => caja(COLOR.gris, i[2], `<p style="margin:0;font-size:15px;font-weight:bold;color:${COLOR.tinta}">${e(i[0])}</p><p style="margin:2px 0 0;font-size:14px;line-height:1.45;color:${COLOR.tinta}">${e(i[1].charAt(0).toUpperCase() + i[1].slice(1))}</p>`)).join('')}
${enPapel ? caja(COLOR.amarilloClaro, COLOR.amarillo, `<p style="margin:0;font-size:14px;line-height:1.45;color:${COLOR.tinta}">${e(enPapel)}</p>`) : ''}
<div style="height:10px"></div>
${caja(COLOR.celesteClaro, COLOR.celeste, `<p style="margin:0 0 8px;font-size:16px;font-weight:bold;color:${COLOR.tinta}">${e(entrar)}</p>
<table role="presentation" cellpadding="0" cellspacing="0">${dato('RBD', res.colegio.rbd)}${dato('Clave', clave)}</table>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:14px 0 10px"><tr><td style="border-radius:999px;background:${COLOR.rojo}"><a href="${PORTAL_URL}" style="display:inline-block;padding:12px 26px;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:999px">Entrar al portal</a></td></tr></table>
<p style="margin:0;font-size:13px;line-height:1.45;color:${COLOR.tinta}"><a href="${PORTAL_URL}" style="color:${COLOR.tinta}">portal.fundaciontrabun.cl</a> · ${e(reserva)}</p>`)}
<div style="height:8px"></div>${parrafo(e(gracias))}
<p style="margin:0 0 28px;font-size:15px;line-height:1.45;font-weight:bold;color:${COLOR.tinta}">Fundación Trabün</p>
</td></tr>
<tr><td style="padding:18px 32px;background:${COLOR.gris};font-size:12px;line-height:1.5;color:${COLOR.muted}">${e(pie).replace(e(contacto), `<a href="mailto:${e(contacto)}" style="color:${COLOR.muted}">${e(contacto)}</a>`)}</td></tr>
</table></div>`;
  return { asunto, texto, html };
}

function logoCorreo_() {
  return Utilities.newBlob(Utilities.base64Decode(LOGO_CORREO_B64), 'image/png', 'logo-trabun.png');
}

function correoDeFila_(fila, ctx) {
  const rbd = normRbd_(fila.RBD);
  const res = panel_(rbd, ctx.d, ctx.reloj);
  const progs = res.programas.filter(p => String(fila.Programas).toUpperCase().split(/\s*\+\s*/).indexOf(p.programa.toUpperCase()) >= 0);
  const lista = s => String(s == null ? '' : s).split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(x => RE_CORREO.test(x));
  const enc = lista(fila.Para).map(email => (ctx.encargados.porRbd[rbd] || []).find(x => x.email === email) || { email, nombre: '' });
  if (!progs.length || !enc.length) return null;
  return Object.assign(correoTest_(res, progs, enc, ctx.claves[rbd]),
    { para: enc.map(x => x.email).join(','), cc: lista(fila.CC).filter(c => !enc.some(x => x.email === c)).join(','), replyTo: res.contacto });
}

function filasCorreos_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_CORREOS);
  if (!sh) throw new Error(`Falta la pestaña ${TAB_CORREOS}: corre primero prepararCorreosTest().`);
  const t = leerTabla_(TAB_CORREOS);
  return { sh, t, filas: t.rows.map((r, i) => { const o = { fila: i + 2 }; t.headers.forEach((h, j) => { o[h] = r[j]; }); return o; }) };
}

function contextoCorreos_() {
  const tc = leerTabla_(TABS.claves);
  const cR = colExacta_(tc, 'rbd'), cC = colExacta_(tc, 'clave');
  const claves = {};
  tc.rows.forEach(r => { const rbd = normRbd_(r[cR]); if (rbd && !claves[rbd]) claves[rbd] = String(r[cC]).trim(); });
  return { d: cargarDatos_(), reloj: reloj_(), claves, encargados: leerEncargados_() };
}

// Sends up to 3 sample emails (one encargado, several encargados, EDI), subject "[PRUEBA] …", only to the addresses in
// Config "correos_prueba" (comma-separated; kept in the Sheet, never in this public repo) or else to whoever runs it.
// Never CCs anyone; a box at the top shows who would get the real one.
function enviarCorreoPrueba() {
  const { filas } = filasCorreos_();
  const ctx = contextoCorreos_();
  const lista = String((ctx.d.cfg || {}).correos_prueba || '').split(/[\s,;]+/).filter(x => RE_CORREO.test(x));
  const yo = lista.length ? lista.join(',') : Session.getActiveUser().getEmail();
  if (!yo) throw new Error('No se pudo saber a quién enviar la prueba: agrega correos_prueba en Config.');
  const listas = filas.filter(f => esVerdadero_(f.Enviar) && !f.Enviado);
  const muestras = [listas.find(f => String(f.Para).indexOf(',') < 0), listas.find(f => String(f.Para).indexOf(',') >= 0),
    listas.find(f => String(f.Contacto) !== CONTACTO_DEFECTO)].filter((f, i, a) => f && a.indexOf(f) === i);
  muestras.forEach(f => {
    const c = correoDeFila_(f, ctx);
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
function enviarCorreosTest() {
  const { sh, t, filas } = filasCorreos_();
  const cEnviado = t.headers.indexOf('Enviado') + 1;
  const ctx = contextoCorreos_();
  const inicio = Date.now();
  let enviados = 0, pendientes = 0, sinCorreo = 0;
  for (const f of filas) {
    if (!esVerdadero_(f.Enviar) || f.Enviado) continue;
    const c = correoDeFila_(f, ctx);
    if (!c) { sinCorreo++; continue; }
    const n = c.para.split(',').length + (c.cc ? c.cc.split(',').length : 0);
    if (Date.now() - inicio > 5 * 60 * 1000 || MailApp.getRemainingDailyQuota() < n) { pendientes++; continue; }
    const correo = { to: c.para, subject: c.asunto, body: c.texto, htmlBody: c.html.replace('<!--prueba-->', ''), inlineImages: { logo: logoCorreo_() }, name: 'Fundación Trabün', replyTo: c.replyTo };
    if (c.cc) correo.cc = c.cc;
    MailApp.sendEmail(correo);
    sh.getRange(f.fila, cEnviado).setValue(new Date());
    enviados++;
  }
  const texto = `Enviados: ${enviados}.` + (pendientes ? ` Quedan ${pendientes}: vuelve a correr enviarCorreosTest() (o mañana, si se acabó la cuota diaria).` : ' No quedan pendientes.')
    + (sinCorreo ? ` ${sinCorreo} filas marcadas no se pudieron armar (sin programas o sin correos): revisa Observaciones.` : '');
  console.log(texto); // counts only, never emails or claves
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
