# Data contract v1 — Portal de Seguimiento 2026

Agreed 05-10-2026. Items marked **PENDING** are open decisions (see CLAUDE.md). This file holds no real data; examples are fictional.

## 0. General rules
- Columns are found **by header**, never by position. Extra columns are ignored, so adding a column never breaks the backend.
  - `SF`, `Contraseñas`, `Config`, `Formularios`: exact header match.
  - Response tabs: **prefix** match. When several columns share a prefix (e.g. one `Colegio` column per region), the first non-empty value in the row wins.
- Rows with no RBD are skipped.
- The backend never writes to any tab except `Métricas` (and later `Precalculo`), plus the separate team tracker Sheets (§1 `Seguimiento interno`, `Seguimiento EFA`).
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
| `efa_extension`, `test_extension` | optional date cell, after `<encuesta>_cierra` (Mau 12-11-2026): an **extra week**. The portal keeps `cierra` as the date the survey was due and shows the extra days as such (phase `extra`); blank, missing or not after `cierra` = no extension |
| `efa_edi_extension` | optional (Mau 20-11-2026): the EFA window of **treated ASE EDI programs only** (EFA-EDI). A date = their extra phase runs to that date; the word `abierta` = extra phase with no end date («until further notice»: band «Plazo extendido · sigue abierta»); blank or missing = they follow `efa_extension` like everyone. Sent per program as `efa.ventana` (§4) |
| `student_id` | `nombre` \| `numero` |
| `contacto_general` | `evaluacion@fundaciontrabun.cl` |
| `contacto_edi` | `consultas_edi@fundaciontrabun.cl` |
| `aviso_portal` | optional text shown to every school at the top of the panel (plain text, line breaks kept); blank or missing = no notice. Cloud Run picks a change up with the next snapshot (~2 min) |
| `monitor_correo` | optional, comma-separated: who gets the `Monitor` alerts; blank = the owner of the `revisarConteos` trigger |

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
  - EDI grades with no row are surveyed on paper by Agencia Focus (part of the RCT: cohort 2025 → 5°–8° básico, cohort 2026 → 4°–7° básico). Hardcoded in `PAPEL_EDI` (fixed by design); sent as `test.nivelesPapel` (∩ implemented) and shown as fixed, non-expandable rows ("Test en papel · a cargo de la Agencia Focus"), never with data.
- **`Link`:** an empty `Link` hides that share row, but the row still defines which grades have a Test.
- **Test links are per school (SurveyMonkey custom variables, 07-10-2026).** `Link` holds the survey's base link (`https://www.surveymonkey.com/r/XXXXXXX`); the backend appends `?RBD=<rbd>&colegio=<Nombre, Comuna>` (`linkColegio_()`: name and comuna from SF `Nombre para formulario`, spaces collapsed, URL-encoded with `!'()*` escaped too). This reproduces the 2026 per-school links file byte for byte (533/533). SurveyMonkey stores the values, so `RBD` reaches the responses; the survey shows the `colegio` text. A `Link` that already has `RBD=` is left as is.
- **Optional `Sostenedor` column (30-10-2026):** blank = any school; filled = only programs whose SF `Sostenedor` contains that text (case and accents ignored). Used for the SIP REL Cuadernillos EFA row ("Instrucción Primaria").
- **Gaps in `Link` (29-10-2026, EFA):** each survey names its own custom variables, so a `Link` may carry gaps `{rbd}`, `{colegio}` (school name only) and `{comuna}` (case-insensitive), filled per school from SF (`linkPlantilla_()`, same encoding as above). EFA rows: `https://es.surveymonkey.com/r/XXXXXXX?rbd={rbd}&colegio={colegio}&comuna={comuna}`, ASE adds `&k={rbd}`; this reproduces the 2026 EFA links file byte for byte (229/229; the other 4 rows there have RBD 0). A gap whose SF value is missing drops that link (the school sees no share card; `revisarFormularios()` lists it). A `Link` without gaps: Test → `linkColegio_()`, EFA → shown as written.
- **`Form`:** uses the same label as the `Form` column of the response imports.

### `Respuestas Test`
Header row typed by hand. **Source (07-10-2026): SurveyMonkey, not Google Forms**: a compiled responses Sheet with one tab per survey (7), SurveyMonkey export columns (`Respondent ID`, `Start Date`, …, `QN. Nombres`, `QN. Apellidos`, `QN. Número de lista …`, `QN. ¿En qué curso estás?`, `QN. ¿Cuál es la letra de tu curso? …`, answers, then `RBD` and `colegio` from the link's custom variables). Question positions differ between REL and ASE tabs. A2 holds one `LET`/`VSTACK` formula: per tab it reads the header row via `IMPORTRANGE`, finds each column by header (`XMATCH` wildcards), imports only the span of identification columns plus the `RBD` column, keeps rows with an RBD, and labels `Form`. A tab that can't be read, or a missing column, writes a visible "REVISAR: …" row naming the problem. **Authorize `IMPORTRANGE` first in a separate cell** (`=IMPORTRANGE(id; "'REL I - IV medio'!1:1")` → Permitir acceso): inside the `LET` the error is caught and the "Permitir acceso" prompt never shows, so every tab reads "REVISAR" (seen 07-10-2026). The source tabs' EDI names carry the cohort in brackets (`ASE EDI 4° básico [Cohorte 1]`); xlsx exports drop the brackets. **Import only these columns**, never test answers.

| Form | Marca temporal | Nombres | Apellidos | Número de lista | Nivel | Letra | Colegio (×N) |
|---|---|---|---|---|---|---|---|

- `Marca temporal` = SurveyMonkey `Start Date`. The bare `RBD` goes into the first `Colegio` column (the backend takes the last ` - ` segment of the first non-empty `Colegio`, so a bare RBD works); the other `Colegio` columns stay empty. They remain from the Google Forms design (one per region) and are harmless.

- `Marca temporal` is optional (students are not deduplicated).
- `Nivel` is mandatory in the form.
- `Nombres`/`Apellidos` are used in `nombre` mode; `Número de lista` in `numero` mode. Both are mandatory in the forms; the blank-value handling ("Sin identificar", "sin número de lista") is only a guard in case a form question is left optional by mistake.

### `Respuestas EFA`
Same import pattern as EFS.

| Form | Fecha | Nombre | Apellido | Correo | Colegio | Rol | Niveles |

**2026 import (30-10-2026):** the compiled SurveyMonkey Sheet (ID in memory only) has one tab per survey (9: ASE ×3, EDI Cohorte 1/2, REL ×3, REL Cuadernillos), header in row 1. `Respuestas EFA` A2 holds one `ARRAYFORMULA(LET(… VSTACK(IFERROR(LET(IMPORTRANGE… FILTER … HSTACK…)))))` block per tab (generated from the headers; column positions differ by tab): Form = the `Formularios` label, Fecha = End Date, Nombre = Primer Nombre, Apellido = Primer + Segundo Apellido, Correo, Colegio = the `rbd` custom variable, Rol, Niveles, plus column `RUN` (EDI only; read by «Faltan por responder» to match a response to its expected person, never sent). EDI grades come as a matrix with every row written, "NT1: A, B | NT2: - | 1° básico: A" (`nivelesDeTexto_()` keeps the grade before ":" only when a class follows it; "-" = not declared, fixed 13-11-2026).
|---|---|---|---|---|---|---|---|

- `Fecha` is a date cell or ISO text.
- `Niveles` is comma-separated (`5° básico, 6° básico`); `-` = empty.
- `Rol` values: the role options of the 2026 EFA surveys (see §3, roles).

### `Métricas` (append-only, successful logins and usage events only)
`timestamp | rbd | programas | testOk | efaOk | evento`. It never stores the clave, IP or names.
- Login: `programas` = the school's programs (`ASE,REL`), `testOk`/`efaOk` booleans, `evento` = `login`.
- **Internal team view (29-10-2026):** RBD typed as `<RBD>trabun` (case, spaces and "-" ignored) + the school's clave → same panel plus `"interno": true`; rows are written with `evento` = `login_interno` and `<evento>_interno` (e.g. `efa_qr_interno`), which every count (team tracker, usage) skips; attempts counted apart (`intentos_<rbd>_interno`).
- Usage event (sent by the portal once per session each): `programas` = the program of the card used (`ASE` | `REL`; blank for `ver_efa`), `testOk`/`efaOk` blank, `evento` one of: `ver_efa` (EFA tab opened); `test_copiar_link`, `test_copiar_mensaje`, `test_whatsapp`, `test_qr`, `test_instructivo`, `test_copiar_lista`, `test_whatsapp_lista`; `efa_copiar_link`, `efa_copiar_mensaje`, `efa_whatsapp`, `efa_qr`.

### `Sin Test` (written by `listarSinTest()`, manual; Mau ticks `Habilitar`)
`RBD | Colegio | Comuna | Programa | Modelo | EDI | Año inicio | Jefe/a de Proyecto | Niveles del colegio | Test en papel | Habilitar`, plus any column Mau adds.
- One row per school-program (all SF programs, Control included) whose SF grades have no online Test: `Formularios` test grades ∩ SF grades is empty. `Niveles del colegio` and `Test en papel` are written as ranges ("NT1 a 3° básico").
- **The portal shows these school-programs no Test links** (only "No hay niveles con Test…" or their paper rows). `Habilitar` ticked (checkbox, or `SÍ`/`TRUE` typed) → `test.habilitado: true` → the share section shows every Test link of the group, as before 07-10-2026.
- Re-run after SF or `Formularios` change: the tab is rebuilt, sorted by Programa, Jefe/a de Proyecto, Colegio; `Habilitar` and extra columns are kept per RBD + Programa **as values** (a formula in an extra column becomes its value: keep lookups in another tab). Rows that no longer qualify are dropped. Missing tab = nobody habilitado; login never depends on it.

### `Encargados`, `Correos Test` and `Correos EFA` (announcement emails; manual functions, run as evaluacion@)
- `Encargados`: the SF encargados export pasted as is (`Nombre para formulario | ID RBD | Programa que participa | Account Name | First Name | Last Name | Email`, one row per person). Not in `TABS`; Cloud Run reads only `COLS_ENCARGADOS` (no last names), for the EFA tracker's `Destinatarios` tab (Mau 06-11-2026: nothing in the portal Sheet is secret within Trabün).
- **Bien Público / SIP** (optional SF columns `Proyecto` and `Sostenedor`; absent = no effect): a program with `Proyecto` = "Bien Público" is not announced (like Control); a school left with only such programs, or whose `Sostenedor` is the Sociedad de Instrucción Primaria (SIP), gets `Enviar` unticked by default with an Observación starting "Bien Público:" / "SIP:" (joint SIP email still to be defined). Mau's tick is kept on rebuild unless the school changes category.
- `correos_jdp`: name (first column) → email (column whose header contains "correo"), for the CC. Names matched to SF `Jefe de Proyecto` / `Coordinador` ignoring case, accents and spaces.
- `prepararCorreosTest()` writes `Correos Test`: `RBD | Colegio | Programas | Jefe/a de Proyecto | Para | CC | Nombres | Contacto | Asunto | Mensaje | Observaciones | Enviar | Enviado`, one row per school in `Contraseñas`. Programs come from SF (Control and no-Test programs left out, `Habilitar` counts), never from the export's "Programa" column; all the school's encargados (emails deduplicated, lower case; RBD from "ID RBD" or the name's last ` - ` segment) go together in one email, singular (tú) or plural (ustedes) wording. Rebuild keeps `Enviado` and an unticked `Enviar` per RBD. `CC` = Jefe/a de Proyecto + Coordinador/a of the announced programs (deduped, never an encargado); names missing from `correos_jdp` are listed in Observaciones. `Para` and `CC` can be edited by hand before sending.
- **EFA kickoff (29-10-2026):** `prepararCorreosEfa()` → `Correos EFA` (same columns and rules; programs = not Control and with an EFA link for the school), `enviarCorreoPruebaEfa()`, `enviarCorreosEfa()`. Text: dates from Config, who answers (directivos, líderes, docentes), each person gets their own invitation from the Fundación but not everyone is on the list, so the encargado shares the link and reminds the team; the portal offers the link and who answered (never answers). RBD + clave always included, with a narrower note than the Test's: the clave is for the encargado and whoever helps with the follow-up, not to be shared further, because the portal shows who answered (Mau 30-10-2026); where `Correos Test` has `Enviado` for the RBD it reads "Entra con el mismo RBD y clave que te enviamos el {9 de octubre}" and calls the portal "el mismo del Test de Estudiantes", **only if every recipient was in that row's `Para`** (an encargado changed since → plain "Entra al portal con estos datos"). `Correos Test` is never modified. Bien Público and SIP rules apply to the Test only (EFA: Bien Público goes like the rest; the only SIP schools with an EFA link are Los Nogales and Eliodoro Matte Ossa, the agreed exceptions). EDI treated schools get one more paragraph by ASE cohort (`ESTUDIO_EDI`: 2025 = last milestone of the impact study after two years, 2026 = first year).
- `enviarCorreoPrueba()` (EFA: `enviarCorreoPruebaEfa()`): up to 3 samples, subject "[PRUEBA] …", to Config `correos_prueba` (comma-separated, in the Sheet only) or the runner. `enviarCorreosTest()`: every ticked row without `Enviado`, stamps `Enviado` after each send (never twice), stops before the daily quota or ~5 min (re-run to continue). Designed HTML (table layout, inline styles, brand colors; logo sent inside the email as an inline image `cid:logo`, because Outlook and others block hosted images by default) + plain-text body; signed "Fundación Trabün"; order: what the portal offers first, then the access box; samples carry a box with the real Para/CC and never CC anyone. Name "Fundación Trabün", reply-to = the school's contacto (consultas_edi@ for EDI), text says it's automatic and not to reply. Logs counts only.

### `Seguimiento interno` (separate Sheet for the team, written by Cloud Run; 19-10-2026)
A Google Sheet outside the 2026 Sheet (which holds claves and emails), shared with the team and with the service account `portal-api@…` as **Editor**. Its ID goes only in the env var `SEGUIMIENTO_ID` at deploy (`SHEET_ID=… SEGUIMIENTO_ID=… bash cloudrun/deploy.sh prod`); unset = not written. **Counts only, never names or emails.**
- Rewritten after every snapshot (Scheduler every 2 min, so as fresh as the portal; IMPORTRANGE's own delay is upstream) **from 8:00 to 18:00** Santiago time (`SEG_HORARIO` in `gas/Code.js`); outside those hours only the first snapshot of each clock hour writes (18:00, 19:00 … 23:00, 6:00, 7:00). Nothing from 0:00 to 6:00, when the Scheduler is off (unless a login triggers a snapshot). Row 2 states the schedule. Built by `seguimiento_(d, datosSeguimiento_(), reloj)` in `gas/Code.js` (pure), which runs `panel_()` per school: every number is the one the school sees. Not written when `Respuestas Test` can't be read (the previous version stays). Never blocks a login.
- Extra sources: `Métricas` (logins and Test share events) and `Correos Test` (**only** the `RBD` and `Enviado` columns are downloaded by Cloud Run, never `Para`/`CC`). Either missing → blank columns.
- Each tab: A1 = "Actualizado: DD-MM-YYYY HH:MM", A2 = "Actualización automática cada 2 minutos de 8:00 a 18:00, y una vez por hora el resto del día." (Mau 19-10-2026), row 3 = header, data from row 4. Values written RAW (numbers stay numbers, dates as `DD-MM-YYYY` text). The layout's formatting: 3 frozen rows, bold header, `%` columns as percentages (the rest automatic), and **gray bands per grade** (Mau 19-10-2026): every other grade's `resp.` + `est.` pair gray (`#EEEEEE`) from the header down, every other column white (`formato.gris` from `seguimiento_()`). Applied to a new tab, and again only when the layout changes (header, bands or `FORMATO_V` in `cloudrun/sheets.js`), tracked by a developer-metadata marker `seguimiento_formato` on each tab; otherwise only values are written, so the team's formatting stays. Re-applying repaints the backgrounds of the header and data columns; conditional formatting rules are separate and survive. **Manual edits and sorts are overwritten**: use filter views.
- Rows: every SF school-program with Test grades (registered ∪ seen), sorted by Jefe/a de Proyecto, Colegio, Programa. Left out: paper-only and no-Test school-programs, and Control unless it has responses.
- **`Resumen`**: `RBD | Colegio | Programa | Modelo | EDI | Jefe/a de Proyecto | Coordinador/a | Correo enviado | Ingresos al portal | Último ingreso | Compartió el Test | Respuestas | Estimado | % | Cursos sin respuestas | <two columns per grade, canonical order: '<grade> resp.' | '<grade> est.'>` (no Comuna; Coordinador/a from SF `Coordinador` of that program; Mau 19-10-2026).
  - `Correo enviado` = `Correos Test` `Enviado` date of the RBD. `Ingresos al portal` / `Último ingreso` = `login` rows of the RBD (per school, same on both program rows). `Compartió el Test` = distinct Test share events of that program (`link, mensaje, WhatsApp, QR, instructivo, lista por curso`).
  - `Respuestas`, `Estimado`, `%` = panel `resumen.r`, `resumen.est`, `rConEst / est` (internal only: schools never see a %).
  - `Cursos sin respuestas` = registered classes (SF letters) of registered grades with 0 responses (`7°B, I°A`); a registered grade with no SF letters and 0 responses is listed by name.
  - Grade columns, two numbers so the team can add them up (Mau 19-10-2026; was one `r / ~est` text cell): `resp.` = `r`, `est.` = grade `est` (blank if none). Text only where there is no number (SUM ignores it): `est.` = `Fuera de lo registrado` for an unregistered grade with responses; `resp.` = `Papel` for an EDI paper grade; both blank when the school doesn't have the grade. Σ `resp.` = `Respuestas`, Σ `est.` = `Estimado`.
- **Cell notes** (hover notes, Mau 19-10-2026): unexpected cases carry a note that starts with the portal's wording and says why. Rewritten as a whole per tab when they change (the writer remembers the last set; first write after a restart always sends them), placed after the values. Notes typed by hand from the header row (row 3) down are erased whenever a tab's notes change (header notes since 03-11-2026, used by `Seguimiento EFA`); hand notes in rows 1–2 stay.
  - `Resumen`, grade `est.` = `Fuera de lo registrado` → "Fuera de lo registrado: {why}, pero hay N respuestas. Cuentan en Respuestas, no en el %." with {why} = "este nivel hace el test en papel (Agencia Focus)" (EDI paper grade) | "este nivel no tiene Test en línea para el colegio" (implemented, no form) | "SF no tiene este nivel en el programa".
  - `Resumen`, registered grade without estimate, on `est.` → "Sin estimado: SF no tiene Alumnos para este nivel. No cuenta en el %."; `resp.` above `est.` → "N sobre lo estimado (estimado: E)."; `resp.` = `Papel` → "Test en papel · a cargo de la Agencia Focus."; `%` when `rConEst < r` → "El % considera solo los niveles con estimado: X de N respuestas."
  - `Por curso`, `Registrado` = `Fuera de lo registrado` → "Curso no registrado: {why}." (grade outside) | "Curso no registrado: SF tiene K cursos en {nivel} (A, B)." | "…: SF no tiene cursos (CxN) para {nivel}."; `Sin letra` → note on `Curso` and `Registrado`; registered class without estimate → `Estimado` "Sin estimado: falta Alumnos o CxN en SF."; `Respuestas` above `Estimado` → "N sobre lo estimado."
- **`Por curso`**: `RBD | Colegio | Programa | Modelo | Jefe/a de Proyecto | Coordinador/a | Nivel | Curso | Respuestas | Estimado | % | Registrado`, one row per class of the panel (`Sin letra` for the no-letter bucket). `Estimado` = class `est` (`round(Alumnos ÷ CxN)`); `Registrado` = `Sí` | `Fuera de lo registrado`.

### `Contactos EFA` (SF report through the Salesforce connector; 03-11-2026)
The SF report "Contactos EFA '26 (seguimiento)" (contacts vigentes 2026 of ASE and REL implementations, encargados and Cuadernillos included; Control, Piloto gratuito and Materiales left out), connected by Mau to this tab of the 2026 Sheet, refreshed every 4 hours (like `SF`). Raw, like `SF`: never edited by hand; if a number doesn't fit, it is fixed in Salesforce. Only for the `Seguimiento EFA` expected counts. Code.js reads `Nombre para formulario` (RBD = last ` - ` segment; `- - 0` = the contact's account is not a school), `Implementación: Record Type`, `Rol en la Implementación…` (by prefix: SF's label is `Rol en la Implementacióon`) and `Email` (lower-cased, only to spot repeated contacts; never written anywhere). Cloud Run downloads only those columns (`COLS_CONTACTOS_EFA`), never names. Missing tab → no expected counts. SF role → tracker roles by substring: `Director/a`, `Encargado/a`, `Mentor/a`, `Otro` (→ Otros líderes), `Docente`; combinations (`Mentor/a y Encargado/a`, `Encargado/a, Docente y Mentor/a`, `Docente y Mentor/a`, `Docente y Encargado/a`) count in each role; blank → no role.

### `Seguimiento EFA` (separate Sheet for the team, written by Cloud Run; 03-11-2026)
Its own Google Sheet (not a tab of `Seguimiento interno`), shared with the team and with `portal-api@…` as **Editor**. ID only in the env var `SEGUIMIENTO_EFA_ID` at deploy; unset = not written. Same writer, schedule, status lines (A1 update time, A2 schedule), header on row 3, RAW values, layout formatting and cell notes as `Seguimiento interno`; `% ` columns (`Director/a %`…) as percent with 2 decimals (`formato.patron`, EFA tracker only; the Test tracker keeps 0%). **Counts only, never names or emails.** Built by `seguimientoEfa_(d, datosSeguimiento_(), reloj)` in `gas/Code.js` (pure; runs `panel_()` per school, so Respuestas is the portal's total). Not written when `Respuestas EFA` can't be read (the previous version stays); written independently of the Test tracker (one failing never stops the other).
- Extra sources: `Métricas`, `Correos EFA` (only `RBD` + `Enviado`), `Contactos EFA` (above).
- Rows: every SF school-program with an EFA link or a response, never Control; sorted by Jefe/a de Proyecto, Colegio, Programa.
- **`Resumen`**: `RBD | Colegio | Programa | Modelo | EDI | Jefe/a de Proyecto | Coordinador/a | Correo enviado | Ingresos desde la apertura | Último ingreso | Compartió la EFA | Contactos en SF (sin ajustes) | Respuestas | <per role: '<rol> resp.' | '<rol> esp.' | '<rol> %'> | Niveles sin docentes | <per grade: '<grade> resp.' | '<grade> cursos'>`.
  - Roles (as in the 2025 EFA tracker): Director/a, Encargado/a, Mentor/a, Otros líderes, Docentes. **A response counts in every role it declares** (`ROLES_SEG_EFA`): `Encargado/a y Mentor/a` in both, `Cumplo todos los roles` in Encargado/a, Mentor/a and Docentes, EDI `Equipo Directivo / Convivencia Escolar` and `Otro/a líder` in Otros líderes (an unknown option too); Respuestas counts it once, so Σ roles can exceed Respuestas. A role of `-` (SurveyMonkey's blank: EFA-EDI without consent ends before the role) or empty → no role: in Respuestas, in no role; no column (Mau 03-11-2026), only its count in the `Respuestas` cell note.
  - **Roles from SF (Mau 12-11-2026):** each response is matched to its contact in `Contactos EFA` of the same school-program, by email, else by the first word of `First Name` + the first word of `Last Name` (one person only; names are downloaded for this and never written). **Regular programs** (people with several roles answer once, with the highest): a response in one of the person's SF roles counts in all of them, a lower role included. **EFA-EDI** (leaders all get the same questions; a leader who teaches an EDI grade answers as a teacher): a leader response counts in the person's SF leader roles instead of the one picked («Mover», Mau 13-11-2026 with the subdirecciones); a docente response that declares an EDI grade (`PAPEL_EDI` of the cohort) also counts in their SF leader roles; a response without a role counts in their SF roles. A person counts once per role. Note on `resp.`: "N personas cuentan aquí por su rol en Salesforce, aunque en la encuesta marcaron otro rol o ninguno: cada persona responde una vez."; on `Respuestas`: "N respuestas sin rol cuentan según el rol de la persona en Salesforce." (never why). The EFA-EDI consents table still counts every response without a role.
  - **`Ajustes EFA` tab of the portal Sheet (Mau 12-11-2026)**, optional, filled by the team: `RBD | Programa | Rol | Esperado | Motivo` (extra columns such as `Pedido por`, `Fecha` ignored). `Rol` = a tracker role → `esp.` = `Esperado` over SF, the automatic 1 and REL Cuadernillos, note "Esperado ajustado a N (en Salesforce: M): {Motivo}. Ajuste acordado en la pestaña Ajustes EFA."; `Rol` = an ASE grade → no teacher expected there: out of `Niveles sin docentes`, note on its `resp.` column. Unreadable rows are skipped. Kept in the Sheet, not in code, so the reasons (leaves…) never reach the public repo. Cloud Run picks a change up with the next snapshot (~2 min), no deploy.
  - `esp.` = `Contactos EFA` rows of that school-program with the role, as SF has them (repeats and contacts without email count; nothing removed here). **Exception (Mau 05-11-2026): `Director/a` and `Encargado/a` with no SF contact → `esp.` = 1** (every school has one; SF rules whenever it has any), noted on `esp.`: "Esperado automático: Salesforce no tiene {rol} vigente para esta implementación, así que se asume 1. Para que este comentario desaparezca, actualiza el contacto en SF." Counts in the summaries' Σ esp. too. Not applied without the `Contactos EFA` tab. **REL Cuadernillos (Mau 05-11-2026; the 15 SIP ones get the EFA): `Encargado/a` and `Mentor/a` `esp.` = 0, over SF and over the automatic 1**, noted on `esp.`: "Encargados y mentores no responden EFA."; any response in those roles is noted on `resp.` ("Encargados y mentores no responden EFA, pero hay N respuestas."). `%` blank there. `%` = `resp.` / `esp.` (blank when `esp.` is 0 or there is no contacts tab). `Contactos en SF (sin ajustes)` = contact rows of the school-program.
  - `Correo enviado` = `Correos EFA` `Enviado` date. `Ingresos desde la apertura` = `login` rows of the RBD since `efa_abre` (internal views never count; same on both program rows); `Último ingreso` = latest login. `Compartió la EFA` = distinct EFA share events of that program (`link, mensaje, WhatsApp, QR`).
  - ASE only: `Niveles sin docentes` = implemented grades with no docente; `<grade> resp.` = docentes who declared the grade (was `doc.` until 10-11-2026) (implemented ∪ declared, as the portal's accordion), `<grade> cursos` = SF CxN (context, never a denominator), `Fuera de lo registrado` for a declared grade outside SF.
  - Gray blocks: every other role (3 columns), then every other grade pair.
- **`Por JdP`** and **`Por programa`** (Mau 03-11-2026): **laid out like the 2025 tracker's `Resumen JdP` / `Resumen Programa`**, the team adds the colors. Rows 1–2 status lines, B3 title (`Resumen de respuestas por Jefe/a de Proyecto · EFA {year}` / `…por Programa y Modelo · EFA {year}`), then tables from column B, each preceded by a blank row (and its title in B in `Por programa`): header `<label> | Implementaciones | Impl. con al menos 1 respuesta | Respuestas | % Avance Director/a | % Avance Encargado/a | % Avance Mentor/a | % Avance Otros líderes | % Avance Docentes`, its rows, a `Total` row; a footnote at the end ("*% = respuestas del grupo ÷ contactos esperados en Salesforce…"). `Por JdP`: one table, one row per JdP (alphabetical; blank → `(sin Jefe/a de Proyecto)`) + `Total`. `Por programa`: `Implementaciones por grupo` (`ASE sin EDI`, `ASE EDI · cohorte 1 (2025)`, `ASE EDI · cohorte 2 (2026)` by `Año inicio`, `REL`; `REL EDI` if it ever appears; + `Total`), then `Implementaciones {grupo} por modelo` per group. Sums of `Resumen` rows; `Impl. con al menos 1 respuesta` = rows with Respuestas > 0; **`%` = Σ resp. ÷ Σ esp. of the group** (pooled, never an average of schools' %; blank without `Contactos EFA`), **capped at 100%** (Mau 05-11-2026; `Resumen` per school is not capped). In `Por JdP` a capped cell carries a note: "Se muestra 100%, pero el cálculo da {X}% ({resp.} respuestas de {rol} sobre {esp.} esperados): en N colegios hay más respuestas que contactos de Salesforce con ese rol." `Por programa` notes where to look, never whose it is (Mau 05-11-2026): "Se muestra 100%, pero el cálculo da {X}%. Hay N colegios con más respuestas que contactos de Salesforce con ese rol (de M Jefes/as de Proyecto); el detalle está en Resumen." `Por programa`, right after the group table: **`EFA-EDI: consentimientos por cohorte`** (Mau 03-11-2026, as 2025's `% No Consentimiento EDI`): `Cohorte | Implementaciones | Respuestas EFA-EDI | Consentimientos negativos | % de consentimientos negativos` (% in F), one row per EDI cohort + `Total EFA-EDI` when there are two; negative consent = EFA-EDI response without a role. Labeled explicitly there; notes elsewhere still never say why a response has no role. Writer formatting `{libre: true, pct, patron: '0.00%'}` (2 decimals, as in 2025): nothing frozen, every old format cleared and the % columns set once per layout (title row + % columns + pattern), never again, so the team's colors stay; a new JdP or modelo shifts the rows below it.
- **Notes**, all counts, never names. On the header row: what `Ingresos…`, `Contactos en SF (sin ajustes)` (source, "corrígelo en Salesforce", contacts without a school), `Respuestas` (dedup; responses not shown: Control, RBD outside SF, a program the school doesn't have), `Otros líderes` and the grade block mean (no note on the role block: Mau adds the "a response counts in every role it declares" note by hand, 03-11-2026). On data cells (several cases on one cell → one note, one line each):
  - `Respuestas`: N respuestas de P personas (more than one role) · repeat submissions dropped · `Cumplo todos los roles` / `Encargado/a y Mentor/a` counted in several roles · `Rol no reconocido «…»` · responses before `efa_abre` ("posibles pruebas") · no EFA link in Formularios.
  - `Respuestas`: "N respuestas sin rol: cuentan en Respuestas totales, pero no en la desagregación por rol." (+ "La encuesta siempre pide el rol: revísalas." outside EFA-EDI); same count on `Respuestas` of `Por JdP` / `Por programa` rows. **No note ever says why a response has no role** (Mau 03-11-2026: the implementation team must not read "no role in EDI = no consent"). `Correo enviado` blank in Cuadernillos ("se envía a mano").
  - Role `resp.`: above `esp.` ("N sobre lo esperado (esperado: E).") · responses with no SF contact for the role. `Docentes resp.` (ASE): "Docentes: D. En los niveles suman S: …" (several grades; no grade).
  - `Contactos en SF (sin ajustes)`: no contacts · same email repeated with the same role / once without a role / with different roles («…» y «…») · contacts without a role · same email in another school (RBD …). Each says to fix it in Salesforce.
  - Grade `cursos`: `Fuera de lo registrado` (N docentes declared it) · no CxN in SF.

- **`Destinatarios` (06-11-2026, Mau):** written by Cloud Run with the other tabs when `Encargados` exists. Rows 1–2 status lines, header row 3: `RBD | Colegio | Programas | Jefe/a de Proyecto | Correo JdP | Para | Nombres | CC | Clave | Cierre EFA | Fase EFA | Ajustes internos | Observaciones`, one row per school and JdP among the `Resumen` rows (programs with different JdPs → one row each). Para / Nombres = the school's encargados (first names); `Correo JdP` and CC (Coordinador/a, never the JdP or an encargado) from `correos_jdp`; Clave from `Contraseñas`; Cierre / Fase from `Config` (efa; during and after the extra week, Cierre = `efa_extension`, Fase = `extra` / `closed`; the drafts then say "La encuesta tiene una semana extra: sigue abierta hasta el …"). `Ajustes internos` = `SÍ` when someone at the school counts in a role they didn't mark (roles from SF): the progress draft then adds, after the intro, «Después de algunos ajustes internos, así vamos. En el portal no vas/van a ver estos ajustes: ahí cada respuesta aparece tal como la persona la declaró, sin cambios. Por eso algunos números de este resumen pueden no calzar exactamente con los del portal.» (Mau 12-11-2026; the script treats the column as optional). Observaciones: no JdP, no JdP email, no encargado, no clave. The whole team with access sees every clave (Mau 06-11-2026: JdPs already got them in CC).
- **Progress emails from each JdP (06-11-2026, Mau; like the EFS 2026 tracker's «Generar correo de seguimiento»):** the Sheet's own bound script (`gas-seguimiento/Code.js`, pushed with clasp from that folder; needs edit access to run) adds **Seguimiento → Generar correos de avance**: a window filtered by JdP (preselected by the runner's email, matched to `Correo JdP`), shows the tracker's update time, lists the JdP's schools (not ready ones disabled with the reason); «Crear borradores» builds each email **at click time** from `Resumen` (that moment's numbers) + `Destinatarios`, and creates one Gmail draft per school in the runner's account (`gmail.compose`; never sends). Email in the JdP's voice (first person, signed with the JdP's name + Fundación Trabün, no automatic-email footer): per program a table Rol | Respuestas | Esperadas | Avance for Director/a, Encargado/a, Mentor/a, Otros líderes, Docentes (% rounded, «—» without an expected; a role with nothing expected and no responses left out, one with responses kept; no traffic-light colors), what the expected count is and «avísame» if someone is missing or has left (the JdP updates SF), a reminder while open, the two portal items, RBD + clave with the EFA note; logo inline. Same layout as the portal's announcement emails (copied: `correoHtml_`).
### `Letras` (optional, manual; created by `prepararLetras()`; 04-11-2026)
`RBD | Nivel | Letras | ASE | REL`. A school's real class letters for a grade when they aren't A, B, C… from SF `CxN` (e.g. RBD 5992: I° medio «A, D»). `Letras`: letters separated by commas, spaces, «/» or «y», case-insensitive; `Nivel` as everywhere (sign, case and accents ignored); `ASE` / `REL`: checkboxes (Mau 04-11-2026: explicit for the team), the row applies to each program ticked, nothing ticked = not used. When a row applies, its letters are the grade's registered classes (others seen in responses stay «Curso no registrado») and the per-class estimate is SF `Alumnos` ÷ the number of letters; the grade's estimate and registration stay as SF says. A row that can't be read (unknown grade, no letters, RBD not a number) is skipped and that grade keeps the SF letters; a missing tab or wrong headers = SF letters everywhere; two rows for the same school, grade and program: the lower one wins. `prepararLetras()` (manual) creates the tab with the headers, a note on each, and 300 rows of checkboxes; never touches an existing tab. Read by `leerLetras_()`; the team tracker's `Por curso` follows it and its note names the tab.

### `Contactos EFA-EDI` and `SDC` (optional; EDI «Faltan por responder»; 17-11-2026)
- `Contactos EFA-EDI`: SF report through the Salesforce connector, contacts vigentes 2026 of treated ASE EDI implementations, same columns as `Contactos EFA` plus `Implementación: Modelo`, `Implementación: EDI`, `Año inicio ASE`, `Vigente 2026`, `Rol en el colegio` and **`RUT`**. Raw, like `SF`. Code.js reads `Nombre para formulario` (RBD), `Implementación: Record Type`, `First Name`, `Last Name`, `Rol en la Implementación…` (prefix), `Email`, `RUT`, `Vigente 2026` (a row explicitly not vigente is skipped); Cloud Run downloads only those (`COLS_CONTACTOS_EDI`).
- `SDC`: `RBD | Nombre | Apellido | Correo | Nivel | Letra | Nivel EDI | Cohorte`, header typed in row 1 and one formula in A2 that imports the SdC «Compilado» (seguimiento de clases ASE, one row per teacher × class) for the schools with an EDI cohort (`cohorte` 1 or 2 in the SdC). `Nivel EDI` (TRUE/FALSE, from the SdC's `nivel_edi`) says whether that row's grade is an EDI grade; only those rows are read. The formula holds the SdC Sheet ID, so it lives in the Sheet and `data/` (local), never in the repo.
- Missing `Contactos EFA-EDI` → no block. Missing `SDC` → leaders only. Emails and RUTs never leave the server.

### `Monitor` (written by `revisarConteos()`, Apps Script time trigger every minute; 04-11-2026)
Counts only, never names. Rows 1–2: last check time + recipients, how it works. From row 4: `Encuesta | Form | Respuestas ahora | Referencia | Estado`, one row per Form of `Respuestas Test` and `Respuestas EFA` (a row with a Form = one response; both imports already drop rows without a school), a `(pestaña)` row per tab (a `REVISAR` row or a formula error shown in A2) and a `Total`. `Referencia` = highest count confirmed. A Form below its reference, or a tab problem, on **5 checks in a row** (about 5 minutes; shorter blips are IMPORTRANGE reloading, and Cloud Run holds the previous copy meanwhile) sends one email (`[Portal] Bajaron las respuestas: …`, before → after); one more when it recovers. Columns G–K: the last 60 events, newest first. State in script properties (`monitor_estado`, `monitor_historial`), so editing the tab changes nothing. `reiniciarMonitor()` (manual) accepts the current counts, e.g. after deleting test responses. The trigger is created by hand in the editor (Activadores → `revisarConteos` → basado en tiempo → cada minuto) by whoever should send the emails; Cloud Run never reads this tab.

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
- **Dates** (`ms_()`): a Date cell, ISO-like text, or **a plain number read as a Sheets date serial** (a date cell that lost its date format; 20.000–100.000 only). Seen 19-10-2026: `Métricas` rows 07-10 → 16-10 held their timestamps as plain numbers, so the tracker showed no "Último ingreso" for 80 of 106 school-programs with logins.

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
  - Program `total` = responses after dedup. A person with two roles answered twice and counts twice; a docente with several grades counts once; a "Cumplo todos los roles" response is listed in Líderes and Docentes and counts once (so Σ section `r` can exceed `total`).
- **EFA sections:**
  - Role → section(s) + short label (29-10-2026, `ROLES_EFA`), by how the option starts (case, accents and a leading "Soy" ignored): `Director/a…` and `Equipo Directivo / Convivencia Escolar` (EDI) → Dirección; `Encargado/a…`, `Mentor/a…`, `Cumplo ambos roles…` (Encargado/a y Mentor/a), `Otro/a líder…` → Líderes educativos; `Docente…` / `Soy Docente…` (EDI) → Docentes; `Cumplo todos los roles…` (REL) → Líderes **and** Docentes. Labels: Director/a, Equipo Directivo / Convivencia Escolar, Encargado/a, Mentor/a, Encargado/a y Mentor/a, Encargado/a, Mentor/a y Docente, Otro/a líder, Docente. An option not in the list → Líderes, labeled with its text before the first comma. **No role** (`-`, SurveyMonkey's blank: EFA-EDI without consent ends before the role; or empty) → its own section `sinrol` «Sin rol declarado», between Líderes and Docentes (Mau 17-11-2026), only when it has people, no label, never says why; the portal adds a line saying their answer counts and they don't need to answer again (Mau 01-11-2026, built 17-11-2026; was Líderes labeled «-»).
  - ASE Docentes are grouped by grade: implemented ∪ declared, NT1–IV. A docente with several grades is listed under each but counted once. A docente with no valid grade goes in a `nivel: null` group.
  - ASE grade `cursos` = SF `CxN` if > 0, else `null` (also `null` for unregistered grades and the `nivel: null` group). Shown only inside the open grade as context ("En este nivel, hay N cursos con el programa."), never as a denominator: one teacher may cover every class.
  - REL Docentes: one flat list.
- **EDI «Faltan por responder» (Mau 17-11-2026; `pendientesEdi_()`):** treated ASE EDI programs (not Control), only in phase `open` or `extra`, when `Contactos EFA-EDI` has the school or `SDC` does.
  - Expected people: SF contacts with a leader role (Director/a, Encargado/a, Mentor/a, Otro; combinations with Docente included) + teachers of EDI grades in `SDC` (`Nivel EDI` TRUE), joined to their SF contact when there is one. SF docentes outside EDI grades and contacts without a role are not expected. Repeated SF rows of one person (same RUT or email) are one person; a RUT joins only if the given names don't contradict it (17-11-2026: SF had two teachers with one RUT); a leader who also teaches stays a leader.
  - A person counts as answered when any EFA response of that school-program (any role, with or without consent) matches by RUT (`RUN` column; equal, another check digit, or one digit more or less), by email, or by name: a given name and a surname in common (words of 3+ letters; in words of 5+ letters one letter changed, added, dropped or two neighbours swapped), only when exactly one person fits and their RUTs don't contradict it.
  - Who answered stays exactly as before («Ya respondieron»); a respondent outside the list is never flagged.
  - **Reminder email to each pending person** (Mau 17-11-2026, Apps Script only; `prepararCorreosFaltan()` → `enviarCorreoPruebaFaltan()` → `enviarCorreosFaltan()`, tab `Correos Faltan`): the same people, recomputed at each step (whoever answers before the send is skipped). Sent from the account that runs it, display name «Mauricio de Trabün», replies to that account. One email per person; several addresses go together only when sure: an address whose record joined by its own row, RUT or email, plus one joined only by name if it is a near copy of another (a typo, ≤ 2 edits) or the person's only one; any other goes to «No se envía a».
  - Leader label from SF: Director/a; Encargado/a y Mentor/a; Encargado/a; Mentor/a; Otro/a líder. Order as `ORDEN_ROLES`, then surname. Teachers by EDI grade (canonical order), each with their letters from `SDC`; a teacher in two grades is listed in both and counted once.
- **Phases:** computed on the server in `America/Santiago`.
  - `pre` before the `abre` date, `open` through the end of the `cierra` day; then `extra` through the end of the `extension` day when `Config` has one, `closed` after that (or right after `cierra` without one).
  - `diasRestantes` = calendar days to `cierra` (`open`) or to `extension` (`extra`); `null` otherwise. `extension` (ISO) is in the object only when set.
  - Phase `extra` in the portal: band "**Semana extra** · abierta hasta el {extension} · cierra en N días" ("cierra mañana", last day "**Semana extra** · **cierra hoy**"); note (EFA) "¡Es muy importante para nosotros escuchar las voces de quienes viven nuestro programa en las escuelas! Por eso, extendimos el plazo de la encuesta hasta el {extension con día}. Los links siguen funcionando: puedes volver a compartirlos con quienes aún no responden." (Test: "Extendimos el plazo del Test de Estudiantes hasta el {extension con día}…"); share section kept; EFA message opens "La Encuesta de Fin de Año del {programa} tiene una semana extra: estará disponible hasta el {extension con día}. Si aún no la has respondido, este es el momento." Once closed after an extension, dates read `extension` ("Cerrada el 20 nov").
  - If `Config` dates are missing, `fase` is `null` (login still works).
- **Contact:** `contacto_edi` if the school's ASE row has EDI = TRUE, otherwise `contacto_general`.
- **Degradation:** login depends only on `Contraseñas` + `SF`. If one response source fails, that survey gets `ok: false` and the rest still renders.
- **Volume:**
  - Launch with the summary built on each login.
  - Before launch, measure on staging with ~70.000 fictional student rows.
  - Have `Precalculo` running (a trigger every ~10 min) before volume peaks (end of October).

## 4. API
**Request:** `POST /exec`, header `Content-Type: text/plain`, body `{"rbd":"12345","clave":"abc123"}`. Refreshes (the "Actualizar" button and the 5-min auto-refresh) add `"refresco":true`: same response, but not logged in `Métricas`. The "Actualizar" button also adds `"fresco":true`: the Cloud Run backend then re-reads the Sheet before answering if its copy is older than 15 s (at most one read every 30 s); Apps Script ignores it.

**Usage event:** same request plus `"evento"` (and `"programa":"ase"|"rel"` when it concerns one card). Same clave check and throttle as a login; on success it appends one `Métricas` row and answers `{"ok":true}` without building the panel. An `evento` outside the fixed list (§1 `Métricas`) or a bad `programa` → `{"ok":false,"error":"evento"}`, no row. Sent with `navigator.sendBeacon` (text/plain), response ignored.

**Short EFA link (29-10-2026):** body `{"corto":"12885-REL Consolidado","encuesta":"efa"}` from `docs/e/index.html`, same rules against the `efa` rows (separators, spaces and case ignored; Control never matches). Without `encuesta` the body is a Test short link, as before.

**Short Test link:** body `{"corto":"12885-REL_5-8"}` (`<RBD>-<Form>`, Form compared ignoring case and accents), no clave, no throttle, not logged → `{"ok":true,"link":"<full per-school SurveyMonkey link>"}` only if that RBD is in SF with a program that matches that `test` row of `Formularios` (same matching as the panel) and the row has a `Link`; otherwise `{"ok":false,"error":"link"}`. Used by `docs/t/index.html` (`portal.fundaciontrabun.cl/t/?12885-REL_5-8`), which redirects to the link. It returns what the link itself carries (RBD, school name, comuna). It does reveal whether an RBD is a partner school, accepted (school names are public; claves are untouched). **Renaming a `test` Form breaks the short links already printed or shared.**

**Health check:** `GET /exec` → `{"ok":true,"v":1}`. It never returns data.

**Error:** `{"ok":false,"error":"credenciales"|"bloqueado"|"servidor"}`. The frontend owns the wording, and `credenciales` shows "RBD o clave incorrectos".

**Success:**
```json
{
  "ok": true, "v": 1,
  "generado": "2026-10-20T14:03:00-03:00",
  "colegio": { "rbd": "12345", "nombre": "Colegio Ficticio", "comuna": "Comuna Ficticia" },
  "contacto": "evaluacion@fundaciontrabun.cl",
  "aviso": "",
  "studentId": "nombre",
  "encuestas": {
    "test": { "abre": "2026-10-13", "cierra": "2026-11-20", "fase": "open", "diasRestantes": 31 },
    "efa":  { "abre": "2026-11-02", "cierra": "2026-11-13", "fase": "pre",  "diasRestantes": null }
  },
  "programas": [{
    "programa": "ase",
    "modelo": "Semi-Intensivo", "jefeProyecto": "Nombre Ficticio", "coordinador": null,
    "edi": false,
    "cohorte": null,              // EDI only: ASE "Año inicio" (2025 / 2026), for the EFA share message
    "nivelesImplementados": ["1° básico", "2° básico", "…", "8° básico"],
    "test": {
      "ok": true,
      "nivelesTest": ["4° básico", "…", "8° básico"],
      "nivelesPapel": [],
      "habilitado": false,
      "links": [
        { "form": "ASE_4-5",  "desde": "4° básico", "hasta": "5° básico", "link": "https://…" },
        { "form": "ASE_6-IV", "desde": "6° básico", "hasta": "IV° medio", "link": "https://…" }
      ],
      "resumen": { "r": 212, "rConEst": 208, "est": 300 },
      "niveles": [{
        "nivel": "4° básico", "registrado": true, "est": 60, "r": 41,
        "cursos": [
          { "letra": "A", "registrado": true, "r": 21, "est": 30,
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
        { "id": "sinrol",    "r": 1, "personas": [{ "nombre": "Ana Rojas", "rol": null }] },  // only when someone answered without a role
        { "id": "docentes",  "r": 8,
          "niveles": [{ "nivel": "6° básico", "registrado": true, "cursos": 3, "r": 2, "personas": [] }] }
      ],
      "pendientes": {               // EDI treated programs only, phase open/extra, when the lists have the school
        "total": 3,                 // people (a teacher in two grades counts once)
        "lideres": [{ "nombre": "Rosa Castillo Vera", "rol": "Encargado/a y Mentor/a" }],
        "docentes": [{ "nivel": "5° básico", "personas": [{ "nombre": "Luis Herrera", "letras": ["A"] }] }]
      }
    }
  }]
}
```

Notes:
- **`efa.ventana`** (EFA-EDI, Config `efa_edi_extension`): same shape as `encuestas.efa`, plus `"sinCierre": true` when open with no end date (`diasRestantes: null`, no `extension`). The page uses it instead of `encuestas.efa` for that program's band, notes, share section and message, and the «Faltan por responder» block.
- **Course in `numero` mode:**
  `{ "letra": "A", "registrado": true, "r": 26, "est": 38, "tope": 38, "numeros": [1, 2, 4, 14, 14, 35], "sinNumero": 1 }`
- **Course `est`** (both modes, 07-10-2026): `round(SF Alumnos ÷ CxN)` for the grade, an average per class; only for letters registered in SF and when both values are > 0, else `null` (unregistered letters, the no-letter bucket, grades missing Alumnos or CxN). Shown in the class card as "r / ~est".
- **REL `docentes`** carries `personas` (a flat list) instead of `niveles`; each person has `niveles` (declared grades, canonical order, may be `[]`), shown after the role ("Docente · 5° a 8° básico").
- **`ok: false`** on a survey omits `resumen`/`niveles`/`secciones`, but keeps `links` and `nivelesTest`.
- **A school in `Contraseñas` but not in `SF`** gets `"programas": []`.
- **Not sent:** emails, claves. (Modelo, Jefe/a de Proyecto and Coordinador/a are sent since 05-10-2026 for the band pills, as in EFS.)
- **Share UI:** one tray row per link, labeled with its grade range. The share message lists each link with its range.

## 5. Exceptions coded

Every rule that treats some schools, programs or roles differently from the general logic, in one place. **Whenever an exception is added to the code, add its row here** (and a tracker note on the affected cell when it changes a number the team sees). "Where" names the constant or function to edit.

### Who sees what in the portal
| Exception | Where | Effect | Decided |
|---|---|---|---|
| EFA-EDI stays open after the general close | `panel_()` / `panelPrograma_()` (`efa.ventana`), Config `efa_edi_extension` | Treated ASE EDI programs get their own EFA window (open, «Faltan por responder» kept) while every other program's EFA and every Test close as usual (closed phase as designed: final data, names still shown). EDI controls never (no EFA). | Mau 20-11-2026 |
| Control programs: no EFA | `formulariosDe_()`, `panelPrograma_()` | No EFA links and no EFA responses shown, EDI controls included (a response sent by mistake is ignored, so the tab never appears). | Mau 29-10 / 30-10-2026 |
| EDI grades on paper | `PAPEL_EDI` | ASE EDI cohort 2025 → 5°–8° básico, 2026 → 4°–7° básico (∩ implemented, minus grades with an online form): fixed rows «Test en papel · a cargo de la Agencia Focus», never data. | Mau 05-10-2026 |
| No online Test grade → no Test links | `panelPrograma_()`, `Sin Test` tab (`Habilitar`) | A school-program whose grades have no online form sees no Test links, unless ticked in `Sin Test`. | Mau 07-10-2026 |
| `Formularios` `Sostenedor` filter | `aplica_()` | A row with `Sostenedor` applies only to programs whose SF sostenedor contains it: REL Cuadernillos EFA → only the 15 SIP schools. | Mau 30-10-2026 |
| Real class letters | `Letras` tab, `leerLetras_()` / `cursos_()` | Replaces A, B, C… from SF CxN for the rows listed (e.g. RBD 5992 I° medio A, D); estimate split among them. | Mau 04-11-2026 |
| EDI contact | `panel_()` (`contacto_edi`) | ASE EDI schools see `consultas_edi@…` instead of `evaluacion@…`. | 05-10-2026 |
| EDI wording | `ESTUDIO_EDI` (backend + frontend) | EDI treated schools: «Toma unos 20 minutos» and the impact-study paragraph by cohort in the EFA messages and kickoff email. | Mau 29-10-2026 |
| Internal team view | `RE_INTERNO`, `login_()` | `<RBD>trabun` + the school's clave opens its panel as `interno`; rows logged `_interno`, never counted as the school's use. | Mau 29-10-2026 |
| Test submissions | `normRbd_()` | RBD 0 is rejected, so test responses with RBD 0 never show. | Mau 30-10-2026 |
| Empty tabs hidden | `testVacio()`, `tieneEfa()` (frontend) | Test tab hidden when no program of the school has Test and the card has EFA; EFA tab hidden until it has a link or a response. | Mau 29-10 / 06-10-2026 |
| Response-drop guard | `protegerRespuestas()` (`cloudrun/app.js`) | A school whose responses drop in a new snapshot keeps its previous ones for up to 30 min / 3 reads. | Mau 04-11-2026 |
| EFA «Sin rol declarado» | `rolEfa_()`, `bloqueEfa_()`, `SECCIONES_EFA` (frontend) | A response whose role is `-` or empty (EFA-EDI without consent) is listed in its own section «Sin rol declarado» (between Líderes and Docentes), not in Líderes; the section exists only when it has people. | Mau 01-11-2026 (built 17-11-2026) |
| EDI «Faltan por responder» | `pendientesEdi_()`, `bloqueFaltan()` (frontend) | Treated ASE EDI programs only, while the EFA is open or in its extra week: block above «Ya respondieron» with SF leaders + SdC teachers of EDI grades who don't appear among the responses (§3). Regular programs, REL and EDI controls never get it. | Mau 17-11-2026 |

### Announcement emails
| Exception | Where | Effect | Decided |
|---|---|---|---|
| Test: Control and no-Test programs left out | `programasConTest_()` | Not announced (`Habilitar` counts as Test). | 07-10-2026 |
| Test: Bien Público | `prepararCorreos_()` | A Bien Público program isn't mentioned; a school with only those is unticked. | Mau |
| Test: SIP schools | `prepararCorreos_()` | Unticked by default (joint email to be defined). | Mau |
| EFA: Cuadernillos by hand | `programasConEfa_()` | REL Cuadernillos left out of the kickoff email (sent manually). Bien Público and SIP go like the rest. | Mau 30-10-2026 |
| EFA: «the same clave we sent on…» | `correoDe_()`, `testEnviado_()` | Only when every recipient was in the Test email's `Para`; otherwise the plain wording. | Mau 30-10-2026 |

### Team trackers
| Exception | Where | Effect | Decided |
|---|---|---|---|
| Test tracker rows | `seguimiento_()` | Programs with no Test grade (paper only or none) and Control programs without responses get no row. | 19-10-2026 |
| EFA tracker rows | `seguimientoEfa_()` | Control programs and programs with no EFA link and no responses get no row. | 03-11-2026 |
| Expected 1 when SF has none | `SEG_ESPERADO_MINIMO` | Director/a and Encargado/a: expected 1 when SF has no contact with that role (note «Esperado automático…»). | Mau 05-11-2026 |
| REL Cuadernillos leaders | `SEG_SIN_LIDERES_CUADERNILLOS` | Encargado/a and Mentor/a expected 0 whatever SF says (they don't answer the EFA). | Mau 05-11-2026 |
| **Expected adjusted by hand** | `Ajustes EFA` tab of the portal Sheet (not in code: the reasons stay private) | Leaves, vacancies and agreed exceptions per school-program and role, or an ASE grade with no teacher expected; each row carries its reason, shown in the cell note. First rows (12-11-2026): 13, incl. 8625 and 24407 REL Director/a 0 (were `SEG_ESPERADO_FIJO`, 10-11-2026). | Mau 10/12-11-2026 |
| **Roles from SF** | `seguimientoEfa_()` | A response counts in the respondent's SF roles: regular programs, all their roles when they answered one of them; EFA-EDI, their SF leader roles instead of the one picked (Mau 13-11-2026), also as leader when a docente declares an EDI grade, and their SF roles when there is no role. | Mau 12-11-2026 |
| Summary % capped | `seguimientoEfa_()` (Por JdP, Por programa) | Shown at most 100%, with a note on the real %. | Mau 05-11-2026 |
| No-role responses | `seguimientoEfa_()` | EFA-EDI without consent (role `-`): count in Respuestas, not in any role; only the count, never why. | Mau 03-11-2026 |
| Progress email CC | `seguimientoEfa_()` (`Destinatarios`) | CC = Coordinador/a, never the JdP who sends it; a school with two JdPs gets one row per JdP. | Mau 06-11-2026 |

### Data issues outside the code (fix at the source)
- RBD 149 (a real non-partner school) has 9 EFA test responses from a teammate: delete them in SurveyMonkey.
- 9 people (7 cases) got another school's EFA link: the invitations file took `rbd/colegio/comuna` from the contact's account instead of the Implementación.
