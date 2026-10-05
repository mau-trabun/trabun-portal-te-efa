# Data contract v1 — Portal de Seguimiento 2026

Agreed 05-10-2026. Items marked **PENDING** are open decisions (see CLAUDE.md). This file holds no real data; examples are fictional.

## 0. General rules
- Columns are found **by header**, never by position. Extra columns are ignored, so adding a column never breaks the backend.
  - `SF`, `Contraseñas`, `Config`, `Formularios`: exact header match.
  - Response tabs: **prefix** match. When several columns share a prefix (e.g. one `Colegio` column per region), the first non-empty value in the row wins.
- Rows with no RBD are skipped.
- The backend never writes to any tab except `Métricas` (and later `Precalculo`).
- `Nuevas` is Mau's auxiliary tab. **Nothing reads it.**

## 1. Sheet tabs

### `SF` (Salesforce connector, raw, no formula columns)
| Header | Use |
|---|---|
| `ID RBD` | key, normalized (§2) |
| `Nombre para formulario` | `Comuna - Nombre - RBD` → `nombre` = part 2, `comuna` = part 1 |
| `Implementación: Record Type` | `ASE` → `ase`, `Religión` → `rel`; any other value → row ignored |
| `Modelo` | `Formularios` matching (EFA, PENDING); shown as a pill |
| `Jefe de Proyecto`, `Coordinador` | optional; shown as pills in the program band (Trabün staff, not respondents) |
| `EDI` | TRUE/FALSE. Only ever TRUE on ASE rows. |
| `Año inicio ASE`, `Año inicio Religión` | `Formularios` matching (EDI cohort) |
| `Alumnos NT1` … `Alumnos IV` (14) | `est` per grade |
| `CxN NT1` … `CxN IV` (14) | course count per grade |

Grade suffixes: `NT1, NT2, 1º, 2º, 3º, 4º, 5º, 6º, 7º, 8º, I, II, III, IV`. If the same RBD × program appears twice, the first row wins.

### `Contraseñas`
`rbd | clave`. The match is exact after trimming spaces (case-sensitive).

### `Config` (`clave | valor | nota`)
| clave | valor |
|---|---|
| `test_abre`, `test_cierra` | date cells |
| `efa_abre`, `efa_cierra` | date cells |
| `student_id` | `nombre` \| `numero` |
| `contacto_general` | `evaluacion@fundaciontrabun.cl` |
| `contacto_edi` | `consultas_edi@fundaciontrabun.cl` |

### `Formularios` (one row per form)
| Encuesta | Form | Programa | EDI | Año inicio | Modelo | Desde | Hasta | Link |
|---|---|---|---|---|---|---|---|---|
| test | ASE_4-5 | ASE | NO | | | 4° básico | 5° básico | … |
| test | ASE_6-IV | ASE | NO | | | 6° básico | IV° medio | … |
| test | ASE_EDI_4 | ASE | SÍ | 2025 | | 4° básico | 4° básico | … |
| test | ASE_EDI_I-IV | ASE | SÍ | 2025 | | I° medio | IV° medio | … |
| test | ASE_EDI_8-IV | ASE | SÍ | 2026 | | 8° básico | IV° medio | … |
| test | REL_5-8 | REL | | | | 5° básico | 8° básico | … |
| test | REL_I-IV | REL | | | | I° medio | IV° medio | … |
| efa | *PENDING (likely one per Programa × Modelo, as in EFS)* | | | | | | | |

- **Matching:** a blank cell means "any". A school-program uses every row of that `Encuesta` whose filled-in cells all equal its SF values. `Año inicio` is compared with the program's own `Año inicio` column. Text values (`Programa`, `EDI`, `Modelo`) are compared ignoring case and accents (SF writes `Semi-Intensivo`, EFS labels wrote `Semi-intensivo`).
- **Test grades** for a school-program = union of `Desde`…`Hasta` over its matching `test` rows. This replaces any fixed availability rule.
  - EDI grades with no row are surveyed on paper (part of the RCT: cohort 2025 → 5°–8° básico, cohort 2026 → 4°–7° básico), so they never show in the portal.
- **`Link`:** an empty `Link` hides that share row, but the row still defines which grades have a Test.
- **`Form`:** uses the same label as the `Form` column of the response imports.

### `Respuestas Test`
Header row typed by hand. Row 2 holds the stacked `{QUERY(IMPORTRANGE(…)); …}` import, one block per form, each labeling `Form`. **Import only these columns**, never test answers.

| Form | Marca temporal | Nombres | Apellidos | Número de lista | Nivel | Letra | Colegio (×N, one per region) |
|---|---|---|---|---|---|---|---|

- The `Colegio` block goes last, so its length (number of regions in the form) never shifts the fixed columns. The setup function writes 16 `Colegio` headers; unused ones are harmless.

- `Marca temporal` is optional (students are not deduplicated).
- `Nivel` is mandatory in the form.
- `Nombres`/`Apellidos` are used in `nombre` mode; `Número de lista` in `numero` mode. Both are mandatory in the forms; the blank-value handling ("Sin identificar", "sin número de lista") is only a guard in case a form question is left optional by mistake.

### `Respuestas EFA`
Same import pattern as EFS.

| Form | Fecha | Nombre | Apellido | Correo | Colegio | Rol | Niveles |
|---|---|---|---|---|---|---|---|

- `Fecha` is a date cell or ISO text.
- `Niveles` is comma-separated (`5° básico, 6° básico`); `-` = empty.
- `Rol` values: fixed list, **PENDING**.

### `Métricas` (append-only, successful logins only)
`timestamp | rbd | programas | testOk | efaOk | ms`. `ms` = server time for that login. It never stores the clave, IP or names.

### `Precalculo` (not built yet; see §3 Volume)
`rbd | json | actualizado`.

## 2. Normalization (in GAS, never in the sheet)
- **RBD:** digits only (`12345.0` → `12345`). From `Colegio`: the last ` - ` segment.
- **Program:** in SF, from the record type. In responses, from the `Programa` of the `Formularios` row with the same `Form` label (so a label like `EFA_EDI` works); if the label has no row, from its first 3 letters (`ASE`/`REL`).
- **Grade:** trim, collapse spaces, `º` → `°`, case-insensitive. Then an **exact** match against the 14 canonical labels:
  `NT1, NT2, 1° básico … 8° básico, I° medio, II° medio, III° medio, IV° medio`.
  - 2025 forms used `5° Básico`; that matches.
  - No substring matching.
  - Test rows whose grade doesn't match are skipped (grade is mandatory, so this shouldn't happen).
- **Letter:** trim and uppercase. One letter A–Z, otherwise `null`.
- **List number:** a whole number from 1 to 99, otherwise `null` (a typo like 999 would otherwise draw a 999-cell grid).
- **Email:** trim and lowercase. Never leaves the server.
- **Names:** trim and collapse spaces only. Case is fixed at render time (`formatNombre`).

## 3. Derivation rules
- **Implemented grade:** `CxN > 0` or `Alumnos > 0`. Treated as a set (gaps allowed).
- **`est`:** `Alumnos` if > 0, else `null`. A `null` estimate shows as "Sin estimado" and is left out of the program %.
- **Registered letters:** the first `CxN` letters (3 → A, B, C).
- **Estudiantes grades** = (implemented ∩ test grades) ∪ grades seen in responses. A school with no intersection still shows the tab; any responses from it appear as "Fuera de lo registrado" (allowed diagnostic use).
- **Classes per grade:** registered letters ∪ letters seen.
- **Display order:** registered grades first, in canonical order, then unregistered ones; the same for letters.
- **Test totals:**
  - `r` counts every response.
  - `rConEst` = responses in grades that have an estimate.
  - Program % = `rConEst / est`.
- **`nombre` mode:** sorted by apellidos, then nombres, ignoring case and accents. No dedup.
- **`numero` mode:** no names are sent.
  - Each class sends its answered numbers (with repeats), `sinNumero`, and `tope = max(highest answered, round(Alumnos ÷ CxN))`. The second term only applies when both values are > 0, and only to registered letters (an unregistered class has no size estimate).
  - The frontend draws 1…`tope` and highlights the numbers that answered.
- **EFA dedup:**
  - Key = email + role within RBD × program, keeping the most recent `Fecha` (if missing, the later row wins).
  - **Any combination of roles is allowed.** A person with two roles appears once per role.
  - A response with no email is not deduplicated.
- **EFA counts:**
  - Section `r` = responses with a role in that section.
  - Grade `r` = people in that grade.
  - Program `total` = unique emails.
- **EFA sections:**
  - Role → Dirección / Líderes educativos / Docentes: **PENDING** list. Interim rule (EFS role texts): starts with `Director` → Dirección; starts with `Docente`/`Profesor` → Docentes; anything else → Líderes. The role shown under a name is the text before the first comma (`Mentor/a, es decir, …` → `Mentor/a`).
  - ASE Docentes are grouped by grade: implemented ∪ declared, NT1–IV. A docente with several grades is listed under each but counted once. A docente with no valid grade goes in a `nivel: null` group.
  - REL Docentes: one flat list.
- **Phases:** computed on the server in `America/Santiago`.
  - `pre` before the `abre` date, `closed` after the end of the `cierra` day, `open` otherwise.
  - `diasRestantes` = calendar days to `cierra`.
  - If `Config` dates are missing, `fase` is `null` (login still works).
- **Contact:** `contacto_edi` if the school's ASE row has EDI = TRUE, otherwise `contacto_general`.
- **Degradation:** login depends only on `Contraseñas` + `SF`. If one response source fails, that survey gets `ok: false` and the rest still renders.
- **Volume:**
  - Launch with the summary built on each login.
  - Before launch, measure on staging with ~70.000 fictional student rows.
  - Have `Precalculo` running (a trigger every ~10 min) before volume peaks (end of October).

## 4. API
**Request:** `POST /exec`, header `Content-Type: text/plain`, body `{"rbd":"12345","clave":"abc123"}`. Refreshes (the "Actualizar" button and the 5-min auto-refresh) add `"refresco":true`: same response, but not logged in `Métricas`.

**Health check:** `GET /exec` → `{"ok":true,"v":1}`. It never returns data.

**Error:** `{"ok":false,"error":"credenciales"|"bloqueado"|"servidor"}`. The frontend owns the wording, and `credenciales` shows "RBD o clave incorrectos".

**Success:**
```json
{
  "ok": true, "v": 1, "ms": 2840,
  "generado": "2026-10-20T14:03:00-03:00",
  "colegio": { "rbd": "12345", "nombre": "Colegio Ficticio", "comuna": "Comuna Ficticia" },
  "contacto": "evaluacion@fundaciontrabun.cl",
  "studentId": "nombre",
  "encuestas": {
    "test": { "abre": "2026-10-13", "cierra": "2026-11-20", "fase": "open", "diasRestantes": 31 },
    "efa":  { "abre": "2026-11-02", "cierra": "2026-11-13", "fase": "pre",  "diasRestantes": null }
  },
  "programas": [{
    "programa": "ase",
    "modelo": "Semi-Intensivo", "jefeProyecto": "Nombre Ficticio", "coordinador": null,
    "edi": false,
    "nivelesImplementados": ["1° básico", "2° básico", "…", "8° básico"],
    "test": {
      "ok": true,
      "nivelesTest": ["4° básico", "…", "8° básico"],
      "links": [
        { "form": "ASE_4-5",  "desde": "4° básico", "hasta": "5° básico", "link": "https://…" },
        { "form": "ASE_6-IV", "desde": "6° básico", "hasta": "IV° medio", "link": "https://…" }
      ],
      "resumen": { "r": 212, "rConEst": 208, "est": 300 },
      "niveles": [{
        "nivel": "4° básico", "registrado": true, "est": 60, "r": 41,
        "cursos": [
          { "letra": "A", "registrado": true, "r": 21,
            "respuestas": [{ "nombres": "Agustín", "apellidos": "Bravo Castro" }] }
        ]
      }]
    },
    "efa": {
      "ok": true,
      "links": [],
      "total": 14,
      "secciones": [
        { "id": "direccion", "r": 2, "personas": [{ "nombre": "María José Fuentes", "rol": "Director/a" }] },
        { "id": "lideres",   "r": 4, "personas": [] },
        { "id": "docentes",  "r": 8,
          "niveles": [{ "nivel": "6° básico", "registrado": true, "r": 2, "personas": [] }] }
      ]
    }
  }]
}
```

Notes:
- **Course in `numero` mode:**
  `{ "letra": "A", "registrado": true, "r": 26, "tope": 38, "numeros": [1, 2, 4, 14, 14, 35], "sinNumero": 1 }`
- **REL `docentes`** carries `personas` (a flat list) instead of `niveles`.
- **`ok: false`** on a survey omits `resumen`/`niveles`/`secciones`, but keeps `links` and `nivelesTest`.
- **A school in `Contraseñas` but not in `SF`** gets `"programas": []`.
- **`ms`:** server time for the login (clave check + reading the Sheet + building the panel). The browser's total wait also includes Apps Script startup and Google's redirect, so total − `ms` ≈ Google's overhead.
- **Not sent:** emails, claves. (Modelo, Jefe/a de Proyecto and Coordinador/a are sent since 05-10-2026 for the band pills, as in EFS.)
- **Share UI:** one tray row per link, labeled with its grade range. The share message lists each link with its range.
