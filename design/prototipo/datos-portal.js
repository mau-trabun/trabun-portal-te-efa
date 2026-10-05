// Datos de ejemplo del Portal de Seguimiento 2026 (colegio ficticio).
(function () {
  const ALL = ["NT1", "NT2", "1° básico", "2° básico", "3° básico", "4° básico", "5° básico", "6° básico", "7° básico", "8° básico", "I° medio", "II° medio", "III° medio", "IV° medio"];
  const TEST_FROM = { ase: "4° básico", rel: "5° básico" };           // disponibilidad del Test
  const SCHOOL = { ase: ["1° básico", "8° básico"], rel: ["5° básico", "II° medio"] }; // niveles implementados
  const SURVEY = {
    est: { name: "Test de Estudiantes", open: "13 oct", openLong: "13 de octubre", dates: "13 oct – 20 nov" },
    efa: { name: "EFA · Docentes y líderes", open: "2 nov", openLong: "2 de noviembre", dates: "2 – 20 nov" },
  };
  const FECHAS = {
    "1 oct": { est: "pre", efa: "pre", left: 0 },
    "20 oct": { est: "open", efa: "pre", left: 31 },
    "5 nov": { est: "open", efa: "open", left: 15 },
    "25 nov": { est: "closed", efa: "closed", left: 0 },
  };
  const FIRST = ["Agustín", "Martina", "Benjamín", "Sofía", "Vicente", "Isidora", "Matías", "Florencia", "Lucas", "Antonia", "Joaquín", "Emilia", "Tomás", "Josefa", "Maximiliano", "Trinidad", "Gaspar", "Amanda", "Clemente", "Rafaela", "Diego", "Catalina", "Felipe", "Javiera", "Ignacio", "Valentina", "Bastián", "Fernanda", "Cristóbal", "Constanza", "Simón", "Agustina", "León", "Julieta", "Renato"];
  const LAST = ["Bravo", "Castro", "Díaz", "Espinoza", "Fuentes", "González", "Hidalgo", "Ibáñez", "Jara", "Klein", "López", "Muñoz", "Navarro", "Olivares", "Pérez", "Quiroz", "Rojas", "Silva", "Torres", "Urrutia", "Vargas", "Yáñez", "Zamora", "Araya", "Bustos", "Cárdenas", "Donoso", "Escobar", "Morales"];
  const DOC = [["Camila Rojas", "a"], ["Javier Pérez", "o"], ["Valentina Díaz", "a"], ["Tomás Herrera", "o"], ["Sebastián Lara", "o"], ["Constanza Vidal", "a"], ["Martín Gallardo", "o"], ["Rocío Pizarro", "a"], ["Daniela Ortiz", "a"], ["Nicolás Bravo", "o"], ["Carla Espinoza", "a"], ["Hernán Toledo", "o"], ["Fernanda Lagos", "a"], ["Gonzalo Reyes", "o"], ["Macarena Silva", "a"], ["Patricio Morales", "o"]];

  const range = (a, b) => ALL.slice(ALL.indexOf(a), ALL.indexOf(b) + 1);
  const rng = seed => { let s = seed; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; };
  const P = (n, role, ok) => ({ n, role, ok: !!ok });
  const implemented = p => range(...SCHOOL[p]);
  const testGrades = p => implemented(p).filter(g => ALL.indexOf(g) >= ALL.indexOf(TEST_FROM[p]));
  const fmtRange = list => {
    if (!list.length) return "";
    const a = list[0], b = list[list.length - 1], lvl = g => g.split(" ")[1] || "";
    if (a === b) return a;
    return lvl(a) && lvl(a) === lvl(b) ? `${a.split(" ")[0]} a ${b}` : `${a} a ${b}`;
  };
  const phase = (fecha, kind) => (FECHAS[fecha] || FECHAS["5 nov"])[kind];
  const statusLabel = (fecha, kind) => {
    const ph = phase(fecha, kind), f = FECHAS[fecha] || FECHAS["5 nov"];
    return ph === "pre" ? `Abre el ${SURVEY[kind].open}` : ph === "closed" ? "Cerrada el 20 nov" : `Abierta · faltan ${f.left} días`;
  };

  const cache = {};
  function students(p, ph, edge) {
    const key = "s" + p + ph + (edge ? "e" : "");
    if (cache[key]) return cache[key];
    const r = rng(p === "ase" ? 7 : 13);
    let idx = 0;
    const out = testGrades(p).map((g, gi) => ({
      grade: g,
      rooms: ["A", "B"].map((sec, k) => {
        const t = 27 + Math.floor(r() * 8);
        let resp = Math.floor(t * (0.35 + r() * 0.65));
        if (gi === 2 && k === 0) resp = 0;
        if (gi === 1 && k === 0) resp = t;
        if (ph === "pre") resp = 0;
        if (ph === "closed") resp = resp === 0 ? Math.round(t * 0.7) : Math.min(t, Math.round(resp * 1.25) + 2);
        const i = idx++;
        const answers = Array.from({ length: t }, (_, j) => ({
          n: `${FIRST[(i * 7 + j * 3) % FIRST.length]} ${LAST[(i * 5 + j * 11) % LAST.length]}`,
          num: j + 1, ok: ((j * 13 + i * 5) % t) < resp,
        })).filter(x => x.ok);
        return { label: `${g} ${sec}`, r: resp, t, answers };
      })
    })).map(g => ({ ...g, est: Math.round(g.rooms.reduce((a, c) => a + c.t, 0) / 5) * 5 }));
    if (edge && ph !== "pre") {
      const mk = (label, n, seed) => ({ label, r: n, t: 0, unexpected: true, answers: Array.from({ length: n }, (_, j) => ({ n: `${FIRST[(seed + j * 5) % FIRST.length]} ${LAST[(seed + j * 7) % LAST.length]}`, num: 3 + j * 4, ok: true })) });
      if (p === "ase") {
        const g0 = out[0], g1 = out[1], g2 = out[2];
        const a0 = g0.rooms[0].answers;
        if (a0.length) { a0.splice(1, 0, { ...a0[0], n: a0[0].n.split(" ")[0].toLowerCase() + " josé " + a0[0].n.split(" ")[1].toLowerCase() }); g0.rooms[0].r++; }                 // respuesta duplicada
        g0.rooms[1].answers.push({ n: "", num: null, ok: true }); g0.rooms[1].r++;             // sin identificar
        g1.est = Math.max(20, Math.round((g1.rooms[0].r + g1.rooms[1].r) * 0.85 / 5) * 5);      // más respuestas que lo estimado
        g2.rooms.push(mk(`${g2.grade} C`, 3, 4));                                             // curso no registrado
        out.push({ grade: "IV° medio", unexpected: true, est: null, rooms: [mk("IV° medio A", 4, 9)] }); // nivel autodeclarado fuera de lo implementado
      } else {
        out[1].rooms.push(mk(`${out[1].grade} C`, 2, 6));                                    // curso no registrado
      }
    }
    out.forEach(g => { g.r = g.rooms.reduce((a, c) => a + c.r, 0); });
    return (cache[key] = out);
  }

  function efa(p, ph, edge) {
    const key = "e" + p + ph + (edge ? "e" : "");
    if (cache[key]) return cache[key];
    const dir = { label: "Dirección", people: [P("María José Fuentes", "Directora", 1), P("Rodrigo Salinas", "Subdirector", 1)] };
    let out;
    if (p === "ase") {
      const r = rng(21); let k = 0;
      const grades = implemented("ase").map(g => ({
        grade: g,
        people: ["A", "B"].map(sec => { const [n, x] = DOC[k++ % DOC.length]; return P(n, `Profesor${x === "a" ? "a" : ""} jefe ${g} ${sec}`, r() > 0.3); })
      }));
      out = [dir,
        { label: "Líderes educativos", people: [P("Paula Ríos", "Jefa UTP", 1), P("Cristián Muñoz", "Orientador", 1), P("Andrea Soto", "Encargada de convivencia", 1), P("Felipe Araya", "Coordinador de ciclo", 0)] },
        { label: "Docentes", grades }];
    } else {
      out = [dir,
        { label: "Líderes educativos", people: [P("Paula Ríos", "Jefa UTP", 1), P("Ignacio Vera", "Coordinador pastoral", 0), P("Carolina Lagos", "Encargada de pastoral", 1)] },
        { label: "Docentes", people: [P("Francisca Mella", "Profesora de Religión", 1), P("Diego Castro", "Profesor de Religión", 0), P("Javiera Núñez", "Profesora de Religión", 1), P("Pablo Riquelme", "Profesor de Religión", 0), P("Soledad Campos", "Profesora de Religión", 1)] }];
    }
    if (edge && ph !== "pre") {
      if (p === "ase") {
        const doc = out[2];
        const g3 = doc.grades[3], okp = g3.people.find(x => x.ok) || g3.people[0];
        g3.people = [...g3.people, { ...okp, ok: true }];                                    // respuesta duplicada
        doc.grades = [...doc.grades, { grade: "I° medio", outside: true, people: [P("Ricardo Fuenzalida", "Profesor jefe I° medio A", 1)] }]; // nivel autodeclarado
      } else {
        out[2] = { ...out[2], people: [...out[2].people, { ...out[2].people[0] }] };          // respuesta duplicada
      }
    }
    let h = 0;
    const adj = x => { h++; return { ...x, ok: ph === "pre" ? false : ph === "closed" ? (x.ok || h % 3 !== 0) : x.ok }; };
    const only = l => l.map(adj).filter(x => x.ok);
    out = out.map(s => s.grades ? { ...s, grades: s.grades.map(g => ({ ...g, people: only(g.people) })) } : { ...s, people: only(s.people) });
    return (cache[key] = out);
  }

  const pct = (r, t) => (t ? Math.round(r / t * 100) : 0) + "%";
  const efaPeople = s => s.grades ? s.grades.flatMap(g => g.people) : s.people;
  function summary(p, kind, ph, edge) {
    let r = 0, t = 0;
    if (kind === "est") {
      students(p, ph, edge).forEach(g => { r += g.r; t += g.est || 0; });
      return { r, t, pct: pct(r, t), short: pct(r, t), line: `${r} respuestas de ~${t} estudiantes estimados` };
    }
    efa(p, ph, edge).forEach(s => { r += efaPeople(s).length; });
    return { r, t: 0, pct: `${r}`, short: `${r}`, line: r === 1 ? "1 respuesta" : `${r} respuestas` };
  }
  function pendingText(p, kind, ph, edge) {
    if (kind === "est") {
      return students(p, ph, edge).filter(g => !g.unexpected).map(g => g.est ? `• ${g.grade}: ${g.r} de ~${g.est}` : `• ${g.grade}: ${g.r} respuestas`).join("\n");
    }
    return "";
  }
  function scope(p, kind) {
    return kind === "est" ? `Niveles con Test de Estudiantes: ${fmtRange(testGrades(p))}` : `Niveles implementados: ${fmtRange(implemented(p))}`;
  }
  window.TrabunPortal = { ALL, SURVEY, FECHAS, phase, statusLabel, students, efa, efaPeople, summary, pendingText, scope, pct };
})();
