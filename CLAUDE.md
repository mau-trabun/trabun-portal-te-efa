# CLAUDE.md — Portal de Seguimiento 2026 · Fundación Trabün

Read this first, every session. Update the **Status** and **Open decisions** sections when something changes.

## Who / how to work
- Owner: Mau, Impact Evaluation Lead (economist). Works with Claude in English; **all user-facing content in Chilean Spanish** (tuteo, no anglicisms, 1.234,56 number format, DD-MM-YYYY).
- Terse, direct, no preamble. Show reasoning when it matters, push back when warranted, commit to best guesses and state assumptions.
- Minimal, scoped changes. Complete ready-to-deploy files. Run `node --check` on every JS file (extract inline `<script>` from HTML to check) before proposing a push.
- **Ask before every `git push` and every `clasp deploy`.** The site is public and used by schools.

## What this is
Static portal where Chilean schools log in (RBD + 6-char clave) and see **who in their community has responded** to two surveys, per program. Supportive follow-up tool, not control. Never shows answers, only participation.

- **Programs:** ASE (Naranjo `#dc911b`) and REL / Religión (Celeste `#6bacc4`). A school can have one or both; each program always carries both surveys.
- **Surveys:**
  - **Test de Estudiantes** (new): 13-10-2026 → 20-11-2026. Source: Google Forms (possible later migration to SurveyMonkey for per-school links).
  - **EFA · Docentes y líderes** (evolution of the EFS 2026 portal): 02-11-2026 → 13-11-2026, probable extension to 20-11. Source: SurveyMonkey.
- Predecessor: EFS 2026 portal, repo `mau-trabun`, tag `efs-2026-final`. **Never modify that repo.** Its `index.html` is the starting base in `/docs`.

## Architecture
- **Frontend:** single `docs/index.html`, vanilla JS, all images base64-inlined, served by GitHub Pages from `main` / `/docs`.
  - Staging: `mau-trabun.github.io/trabun-portal-te-efa` (no custom domain).
  - Production: `portal.fundaciontrabun.cl` (domain moved from the old repo at launch).
- **Backend:** Google Apps Script bound to the new 2026 Sheet, code in `/gas`, managed with `clasp`. JSON API.
  - Two deployments: `staging` and `prod`, each with its own `/exec` URL. Update in place with `clasp deploy -i <deploymentId> -d "<desc>"` (keeps the URL). Saving/pushing code does NOT change what `/exec` serves until a deploy.
  - **staging** (created 05-10-2026; version 6 = REL docentes carry declared grades; v5 = EFA grades carry `cursos` (CxN); v4 = EFA total = responses; v3 = band pills + refresh flag; v2 = ms timing + probarPanel): ID `AKfycbyFDY66nTGtuUhG6XOrXa4w_ct1EY5zAQnSOg6Ar-Egofle4K2nDVqFrSl7ovSj1OPyRg`, URL `https://script.google.com/macros/s/AKfycbyFDY66nTGtuUhG6XOrXa4w_ct1EY5zAQnSOg6Ar-Egofle4K2nDVqFrSl7ovSj1OPyRg/exec`
  - **prod**: not created yet (at launch).
  - Known platform issue (seen 05-10-2026, ~04:30): Apps Script latency 2–35 s and intermittent 404 on the `googleusercontent.com/macros/echo` hop, even for `doGet` (no Sheet access) and on the EFS backend too. Not our code. Frontend retries up to 2× when the reply isn't JSON, 40 s timeout per attempt. Re-measure in daytime and before launch.
  - Claude Code's auto-mode classifier blocks `clasp deploy` even after approval in chat: Mau runs deploys himself (`source ~/.nvm/nvm.sh && clasp deploy -i <id> -d "<desc>"`), or adds a permission rule. `clasp push` needs `--force` when `appsscript.json` changed (non-interactive shell).
  - `/exec` URLs must not contain `/u/N/`.
  - Access: "Cualquier usuario" (Workspace domain policy).
- **Design spec:** `/design` (Claude Design handoff). `README.md` = screens + business rules + tokens. `datos-portal.js` = behavioral reference with edge cases. `trabun-organic.jsx` = wave paths, **copy verbatim**. The `.dc.html` prototypes run on Claude Design's runtime and are reference only, not code to reuse.
- Do NOT use React or a build step. Port the design into vanilla JS on top of the existing `index.html`.

## Repo layout (local: /Users/mauricioaburto/trabun-portal-te-efa — outside iCloud/Drive sync, keep it that way)
```
/docs     site (GitHub Pages source)
/gas      Code.js, appsscript.json (clasp rootDir)
/design   Claude Design handoff package (read-only reference)
/data     local SF snapshots — GITIGNORED, never commit
.clasp.json   scriptId + rootDir "gas" (clasp 3 writes it at repo root; no secrets, safe to commit)
CLAUDE.md
CONTRACT.md   data contract: sheet tabs, normalization, derivation rules, JSON API
/test         local harness for gas/Code.js and cloudrun/ (mocks, fictional data only)
/cloudrun     Cloud Run API: runs gas/Code.js unchanged (app.js shims, sheets.js, server.js, deploy.sh)
```
- Run all `clasp` commands from the repo root. Auth lives in `~/.clasprc.json`, never in the repo.
- clasp 3 stores `.gs` files locally as `.js`. Remote file was cloned as `Código.js` (Spanish editor default); rename to `Code.js` when writing the backend. `clasp push` replaces all remote files with local ones, so the old `Código` is removed, not duplicated.
- Node comes from nvm (`~/.nvm`, loaded in `~/.zprofile`). In a non-login shell, prefix with `source ~/.nvm/nvm.sh &&`.

## Data rules (non-negotiable)
- **Never commit real data.** `/data` is gitignored. The repo is public. Test mocks in code must be fictional (like `datos-portal.js`).
- **Never modify raw sheet data.** Normalization is display-layer only (e.g. `formatNombre()` at render time).
- The `SF` tab is fed by the Salesforce connector (daily refresh) and **must stay raw**. No formula columns next to it. **Build all keys in GAS** (normalized RBD + program from record type), never from a sheet formula. (Lesson: RBD 4898 lost all responses in EFS because the key formula wasn't dragged down to new SF rows.)
- Response tabs (`Respuestas Test`, `Respuestas EFA`) have contract headers written by `configurarHojas()` (05-10-2026) and no data yet. Fake rows for staging come from `generarDatosPrueba()` (fictional people for one real school per case, picked from SF at run time; EFA emails all `@ejemplo.invalid`; refuses to run if the tabs already have rows). At launch Mau deletes every row below the header and pastes the import formulas. Do not design anything that depends on fake rows.
- Never write `e.parameter` or the clave to logs.

## Sheet (new 2026 Sheet) — full spec in `CONTRACT.md`
- Tabs: `SF`, `Contraseñas`, `Config`, `Formularios`, `Respuestas Test`, `Respuestas EFA`, `Métricas` (later `Precalculo`). Columns found by header, never by position.
- `SF` is clean (helper columns `RBD+Programa` and `contraseña` removed 05-10-2026).
- `Nuevas` is Mau's auxiliary clave generator (volatile `RANDBETWEEN`). **Nothing may read or reference it.**
- Response tabs follow the EFS pattern: typed header row + stacked `{QUERY(IMPORTRANGE())}` with a `Form` label column. Import identification columns only, never answers.

## Business rules
Carried from EFS (keep):
- Login: unified error "RBD o clave incorrectos" (no RBD enumeration). Per-RBD throttle 8 attempts / 900 s via CacheService. Data scoped to the logged-in RBD only. Emails never leave the server; only names are returned.
- **Degradation:** login depends only on `Contraseñas` + `SF`. If responses fail to load, the user still gets in and sees a clear message. If links are missing, the share card simply doesn't render.
- **Union rule:** grades/classes shown = registered (SF) ∪ self-declared by respondents. Out-of-range answers count in totals. Neutral flag only ("Fuera de lo registrado", "Curso no registrado…"). Never "probable error", no red, no alert icons.
- Exact-match grade tokens (`NIVELES.indexOf`), never substring (I°/II°/III° medio trap).
- All respondent-controlled strings escaped via `esc()` or `.textContent`.

New for 2026:
- **EFA dedup key = email + rol** within RBD+programa, keep the most recent submission. Any combination of roles is legitimate; a person appears once per role. **Section counts = responses in that role; program total ("N resp.") = responses after dedup = Σ sections** (two roles = two responses, changed 05-10-2026; was unique emails). A docente with several grades is listed under each grade but counts once.
- **Students: no dedup** (no email). Every answer listed as submitted.
- Student survey: 7 Google Forms (ASE_4-5, ASE_6-IV, ASE_EDI_4, ASE_EDI_I-IV, ASE_EDI_8-IV, REL_5-8, REL_I-IV), each pre-filtered to its program's schools. Fields: nombres + apellidos or número de lista (mandatory, per `student_id` mode), nivel (mandatory), letra, colegio (one column per region; option text `Comuna - Nombre - RBD`, parse RBD from it).
- Test availability comes from the `Formularios` tab (program × EDI × año inicio → grade band + link), not a fixed rule. EDI grades without a form are surveyed on paper (RCT) by Agencia Focus: hardcoded `PAPEL_EDI` (cohort 2025 → 5°–8°, 2026 → 4°–7°, ∩ implemented), sent as `test.nivelesPapel` and shown as fixed, non-expandable rows "Test en papel · a cargo de la Agencia Focus" in grade order (Mau 05-10-2026), never with data. Estudiantes view = (implemented ∩ test grades) ∪ seen in responses; tab shown even if the intersection is empty.
- Students sorted by apellidos (`nombre` mode). `numero` mode: per class, grid 1…tope with answered numbers highlighted, `tope = max(highest answered, round(Alumnos/CxN))`.
- Class letters: derived from SF course count per grade (count 3 → A, B, C) ∪ letters seen in responses.
- Estimates: `est` from SF Estudiantes x Nivel. Grade % = r / est, may exceed 100% (flag "{r−est} sobre lo estimado", bar capped). No estimate → "Sin estimado", count only. Program % = Σr / Σest over grades with an estimate.
- **EFA has no %**, counts only (except EDI, see open decisions).
- EFA role categories are a fixed list (new list pending), mapped to Dirección / Líderes educativos / Docentes like `ROLES_LIDER` in EFS.
- **ASE docentes grouped by grade** (accordion). **REL docentes = flat list** (one REL teacher often covers all classrooms). Intentional.
- Survey phases (pre / open / closed) computed from `Config` dates. **Never hardcode dates or day counts in copy.** Band line (no survey name, each date once): pre "Abre el 13 oct · disponible hasta el 20 nov"; open "Abierta hasta el 20 nov · cierra en N días" / "· cierra mañana"; last day "Abierta · cierra hoy"; closed "Cerrada el 20 nov". Never "faltan N días" (read like days until opening). Shown with a calendar icon, Mulish 600 14px full white, dates and days left in bold (nowrap), full width under the title row (Mau 05-10-2026: it read as an afterthought; no pill).
- Links: from `Formularios`, up to 2 per program × survey. Share tray and message show one row per link, labeled with its grade range (approved deviation from the design's single link).
- Footer contact: `evaluacion@fundaciontrabun.cl`; **EDI schools: `consultas_edi@fundaciontrabun.cl`** (driven by the SF EDI flag).

## Built in from day one (EFS backlog)
- Clave via **POST**, not GET query string. GAS has no OPTIONS/preflight handling: send `fetch` with `Content-Type: text/plain` and a JSON body, parse in `doPost`.
- OAuth scope: `https://www.googleapis.com/auth/spreadsheets.currentonly` in `appsscript.json` (not full `spreadsheets`). Must still allow writing `Métricas` in the bound sheet.
- `Métricas`: on **successful login only**, append `timestamp, rbd, programas, testOk, efaOk`. Never clave, IP or names.
- `formatNombre()` for display (all-caps → title case, keeps particles de/del/la…, hyphens/apostrophes; cannot restore accents).
- Aggregation written as a pure function `rbd → payload`, so a time-driven precompute can wrap it. Plan: launch computing at login; load-test staging with ~70k fictional student rows; `Precalculo` tab (trigger ~10 min) live before end of October.

## Testing (no real claves needed)
- `node test/run.js`: backend checks on `gas/Code.js` with mocked Apps Script services and fictional data (44 checks). `node test/gen.js`: `generarDatosPrueba()` (11). `node test/cloudrun.js`: Cloud Run service vs the Apps Script harness, same fixture (22: identical payloads, throttle, Métricas, degradation, fresh read on Actualizar, CORS). Run all three after any backend change.
- Frontend preview: `.claude/launch.json` serves `docs/` on `localhost:8765`. Render any state by calling `mostrarPanel(payload)` in the console with a fictional payload shaped like CONTRACT.md §4 (examples in `test/run.js`). Real logins on staging need a real clave: Mau types it, never Claude.
- Manual functions in the Apps Script editor: `configurarHojas()`, `generarDatosPrueba()`, `revisarFormularios()`, `probarPanel()` (counts only, no names).

## Pending on Mau's side (as of 05-10-2026)
- **New claves for all schools**: the old (deleted) repo was public with the Sheet export, so the 292 claves must be treated as exposed. Offered: `generarClavesNuevas()` writing to a new tab (secure random, no 0/o/1/l), Mau swaps into `Contraseñas`, JDPs distribute. Not built yet: waiting for Mau's go.
- EFS deployment still accepts the same claves: consider archiving it (Mau's call; never touch that repo).
- `Formularios`: real Test links; EFA rows (suggested block: one per programa × modelo with `EDI = NO` for ASE, plus `EFA_EDI` with `EDI = SÍ`); then run `revisarFormularios()`. Open: Cuadernillos ASE and Piloto gratuito EFA forms.
- `Config`: dates were moved earlier for staging tests; restore before launch (also in the launch checklist). `student_id` still blank (defaults to `nombre`).
- Type `ms` in `Métricas!F1` (header for the temporary timing column).
- Re-measure Apps Script latency in daytime (browser console shows total vs server ms after each login).

## Status
- [x] Data contract (sheet tabs + JSON shape) → `CONTRACT.md`
- [x] Backend on staging deployment (login, panel, Métricas, `revisarFormularios()`, `generarDatosPrueba()`; tested locally with mocks + live health/credenciales check)
- [x] Run `generarDatosPrueba()` on the live Sheet (6 schools, 928 test + 65 EFA rows)
- [x] Frontend shell: login (POST, retry, timeout), panel, program cards with synced folder tabs, band, phase notes, summaries. Deviations: program cards stacked full width, one per row (README says side by side; up to 5 classes per grade don't fit in half-width cards), content column 960px instead of 1160 (one card per row at 1160 was too wide; class cards 3 per row; footer stays 1160 so its text sits outside the cards), inactive survey tab behind the card (only the active one merges into the band; card border drawn as a 1px box-shadow ring so the band starts at the tab's x), wave seams covered by a 2px `::after` strip in `--abajo` (the color below; paths untouched), "Cerrar sesión" is an outlined button like "Actualizar" ("Salir" ≤600px), "2026" tag hidden <400px. **From EFS (Mau's choice, 05-10-2026):** band title is the full program name ("Aprendizaje Socioemocional" / "Religión Católica"; tabs and meta line keep "ASE" / "Religión") + pills modelo / Jefe/a de Proyecto / Coordinador/a; "Actualizar" button + "Actualizado hace N" + auto-refresh every 5 min only while the tab is visible (clave kept in memory only; refreshes send `refresco:true` and are not logged in Métricas). No explanatory box. Preview: `.claude/launch.json` → `python3 -m http.server` on `docs/`
- [x] Estudiantes block: search (accent/case/apostrophe-insensitive, every typed word in any order; exact number in `numero` mode), grade accordion (all collapsed at start, several can be open, neutral flags, bar capped), class sub-cards (desktop: all side by side; **mobile ≤600px: class selector pills "A 28 · B 24…" inside the open grade, one class shown at a time**, default first, choice kept across refreshes; Mau 05-10-2026) (24 chips + "Ver todas", "Sin identificar", "Curso no registrado…"), `numero` mode grid 1…tope with answered highlighted and ×N repeats, `formatNombre()` at render. `nombre` mode shows **"Apellidos, Nombres"** (chips, search results, per-class list; Mau 05-10-2026), no comma if one part is blank. Per-class "Copiar lista" + "WhatsApp" (only if the class has responses) for that class's teacher: header (survey · program · class), "Avance al {fecha}: N respuestas", names who answered (`nombre`) or answered numbers + "Aún no aparecen (hasta el {tope})" (`numero`), unidentified count, and the grade's form link. UI state survives tab switches and refreshes. Deviation: count column 100px (README's 78px doesn't fit "29 respuestas"); mobile 74px with "N resp."
- [x] Phases + share: **always-visible share section** at the end of each survey block (Mau's choice: replaces the design's tray + "Recordar" modal; EFS showed it inline too). Links labeled by grade range (only forms touching the school's grades) + Copiar; message built from Config dates, always shown in full; "Incluir avance por nivel" for the open Test, **off by default** (opt-in: first share is the link; per-grade numbers can read as comparison); Copiar mensaje; WhatsApp (filled, WhatsApp green); no red inside the section (ink primary button, switch in program color); secondary actions (Copiar, Copiar lista, WhatsApp, Descargar QR) are small outlined icon buttons `.btn-mini`, not underlined text (underline read as a link, not an action); real QR per link, downloaded PNG 1024 px with caption (survey · program + grades). Hidden when closed or no link. Only http(s) links render.
- [x] **No summary lines in either block** (Mau 05-10-2026): Test's "N respuestas de ~E…" + "Niveles con Test…" and EFA's "Niveles implementados" removed as redundant with the band pill and the rows. Kept: phase notes, load error, "Este programa no tiene niveles registrados con Test de Estudiantes." Before opening, the Test pill shows "~E / ESTUDIANTES ESTIMADOS".
- [x] EFA block: Counts always written out ("11 respuestas", never "resp."); band pill for counts = "N respuestas" + small caps "EN ESTE PROGRAMA" (as in EFS; also Test without estimate). **Test with estimate: "110 / ~191" + "RESPUESTAS / ESTIMADOS", no % anywhere** (tab too; Mau 05-10-2026). Pill always beside the title as in EFS; on phones (≤600px) title 20px + pill 16px and the Test caption wraps to two lines, so "Socioemocional" + "1.110 / ~1.191" or "123 respuestas" fit at 375px; sections Dirección / Líderes educativos / Docentes with a count pill (program dot, "N respuestas"; zero = gray "Sin respuestas aún", no extra empty text; as in EFS) + people (name via `formatNombre()`, short role). **Sections always stacked with dividers, even at full width** (deviation from README's 3 columns; as in EFS, Mau 05-10-2026: flows with the vertical accordions). REL Docentes = flat list, each with the grades they declared after the role ("Docente · 5° a 8° básico", `textoNiveles()`); ASE Docentes = grade accordion (all collapsed), open grade lists people in a grid. "Fuera de lo registrado" flag, `nivel: null` → "Sin nivel declarado". Open grade shows "Según los datos de implementación, hay N cursos que implementan el programa en este nivel." (SF CxN, field `cursos`; as in EFS; context only, never "1 de 3": one teacher may cover every class). Neutral note when grade counts exceed the Docentes count (docente in several grades). Pre phase: no lists. Open grades survive tab switches and refreshes. Not built: search, per-section copy, EDI base list ("X de Y", open decision)
- [ ] Mobile ← **next**
- [ ] Launch (before 13-10): restore real `Config` dates (test_abre 13-10-2026, efa_abre 02-11-2026; may be moved earlier for staging tests), delete all fake rows (check none with `@ejemplo.invalid` remain), paste formulas, check column alignment, run `revisarFormularios()`, promote prod, move domain

## Open decisions
- `studentId`: "nombre" | "numero" (decision due ~06/07-10). Build both behind a config flag.
- New EFA role category list (to map into the three sections).
- EFA forms and links: likely one SurveyMonkey survey per programa × modelo as in EFS, plus **EFA-EDI** (modelo-independent, treated EDI schools only; one form, or two split by cohort via `Año inicio`). Regular ASE EFA rows then need `EDI = NO`. Open: Cuadernillos ASE and Piloto gratuito have no EFS-era form. Mau fills `Formularios` in the live Sheet and says "Formularios is final"; then run `revisarFormularios()` (built with the backend skeleton) to check coverage per school.
- SF completeness: Mau is asking for missing Alumnos/CxN on non-Control schools to be filled before launch.
- **EDI base list for EFA:** identifier (must be email), whether schools see pending names or only "X de Y" (support vs. control framing), whether old EDI portal code is reusable. Respondents outside the list always shown, counted in total, not in denominator.
- Possible migration of the student survey to SurveyMonkey for per-school links.
- **Timing instrumentation is temporary** (added 05-10-2026 to diagnose slow logins). Remove it once the latency question is settled; Mau asked not to keep extra work in a backend that's already slow. Pieces: `res.ms` + the `console.log('login ok · datos …')` in `login_()`, the 6th value (`ms`) in `registrarMetrica_()` + the `ms` column in `Métricas` and in `HEADERS`, the `console.info('Ingreso: …')` in `docs/index.html`, the `ms` notes in `CONTRACT.md`. `probarPanel()` has no runtime cost (manual only) but can go too. Rule: never add per-login Sheet reads/writes for diagnostics.
- **Cloud Run (in progress, decided 05-10-2026)** after measuring Apps Script: **15,4 s total / 3,9 s server and 51,5 s total / 4,4 s server** (daytime) → Google overhead 11–47 s that no Apps Script-side caching can fix.
  - `/cloudrun` runs **`gas/Code.js` unchanged** in Node (`vm` + shims for SpreadsheetApp read/appendRow, CacheService, Utilities.formatDate, ContentService), so there is one source of business logic. `deploy.sh` copies `gas/Code.js` into the build (gitignored). No npm dependencies.
  - Data: in-memory snapshot of the Sheet via Sheets API (service account `portal-api@<project>`, auth from the metadata server, no key files). `cargarDatos_()` built once per snapshot; login = clave check + `panel_()` (~2 ms with 70.000 fictional student rows; processing the snapshot ~0,2 s + download). Stale after 3 min → refresh behind; older than 10 min → wait for fresh. Cloud Scheduler `POST /refrescar` every 2 min keeps data fresh and the instance warm (≥30 s between reads). **"Actualizar" button sends `fresco:true`: waits for a re-read if the copy is >15 s old** (Mau 05-10-2026: an encargado who just saw someone answer must see it; IMPORTRANGE's own delay is outside our control). Auto-refresh and logins use the copy. Dates: cell is a Date when SERIAL_NUMBER gives a number and FORMATTED_STRING gives a string (not done for `Respuestas Test`, no date read there); process TZ America/Santiago.
  - `Métricas` row appended after the reply (Sheets API append, USER_ENTERED). Throttle in memory: `max-instances 1`. CORS only for `ORIGENES` (staging github.io + portal domain). Same JSON API; frontend only changes `API_URL`.
  - GCP project in the `fundaciontrabun.cl` org, billing linked, Mau is Owner (ID in memory, not in the repo). Region `southamerica-west1`. Sheet ID only as env var at deploy.
  - **Staging live 05-10-2026:** `https://portal-api-staging-975999694722.southamerica-west1.run.app` (service `portal-api-staging`). Checked: health ok, reads the Sheet (fake RBD → credenciales), CORS for github.io, 0,04–0,13 s per request warm, 0,86 s first request incl. snapshot. Frontend `API_URL` points here; Apps Script `/exec` kept as commented fallback.
  - Redeploy after backend changes (Cloud Shell): `cd ~/trabun-portal-te-efa && git pull && SHEET_ID=<id> bash cloudrun/deploy.sh staging`.
  - Pending: Scheduler job (every 2 min, daytime), real-login measurement, prod service + domain at launch. Apps Script stays for the manual functions.
