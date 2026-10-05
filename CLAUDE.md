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
  - `/exec` URLs must not contain `/u/N/`.
  - Access: "Cualquier usuario" (Workspace domain policy).
- **Design spec:** `/design` (Claude Design handoff). `README.md` = screens + business rules + tokens. `datos-portal.js` = behavioral reference with edge cases. `trabun-organic.jsx` = wave paths, **copy verbatim**. The `.dc.html` prototypes run on Claude Design's runtime and are reference only, not code to reuse.
- Do NOT use React or a build step. Port the design into vanilla JS on top of the existing `index.html`.

## Repo layout (local: /Users/mauricioaburto/trabun-portal-te-efa — outside iCloud/Drive sync, keep it that way)
```
/docs     site (GitHub Pages source)
/gas      Code.gs, appsscript.json, .clasp.json
/design   Claude Design handoff package (read-only reference)
/data     local SF snapshots — GITIGNORED, never commit
CLAUDE.md
```

## Data rules (non-negotiable)
- **Never commit real data.** `/data` is gitignored. The repo is public. Test mocks in code must be fictional (like `datos-portal.js`).
- **Never modify raw sheet data.** Normalization is display-layer only (e.g. `formatNombre()` at render time).
- The `SF` tab is fed by the Salesforce connector (daily refresh) and **must stay raw**. No formula columns next to it. **Build all keys in GAS** (normalized RBD + program from record type), never from a sheet formula. (Lesson: RBD 4898 lost all responses in EFS because the key formula wasn't dragged down to new SF rows.)
- Response tabs currently hold **fake rows using real RBDs** for testing. At launch they are cleared completely and replaced by import formulas. Do not design anything that depends on those fake rows.
- Never write `e.parameter` or the clave to logs.

## Sheet (new 2026 Sheet)
- `SF`: connector output. One row per school × program. Columns (expected): RBD, record type, modelo, JDP, Nombre para formulario (`Comuna - Nombre - RBD`), 14 × CxN, 14 × Estudiantes x Nivel, EDI flag. **Confirm actual columns against `/data` snapshot.**
- `Contraseñas`: rbd | clave (copied from EFS; new schools added manually).
- `Config`: dates per survey (open/close), links per program × survey, `studentId` mode, `incluirPruebas` if needed. To be defined in the data contract.
- Response tabs (Estudiantes, EFA): headers defined by the data contract.
- `Métricas`: append-only login log (see below).

## Business rules
Carried from EFS (keep):
- Login: unified error "RBD o clave incorrectos" (no RBD enumeration). Per-RBD throttle 8 attempts / 900 s via CacheService. Data scoped to the logged-in RBD only. Emails never leave the server; only names are returned.
- **Degradation:** login depends only on `Contraseñas` + `SF`. If responses fail to load, the user still gets in and sees a clear message. If links are missing, the share card simply doesn't render.
- **Union rule:** grades/classes shown = registered (SF) ∪ self-declared by respondents. Out-of-range answers count in totals. Neutral flag only ("Fuera de lo registrado", "Curso no registrado…"). Never "probable error", no red, no alert icons.
- Exact-match grade tokens (`NIVELES.indexOf`), never substring (I°/II°/III° medio trap).
- All respondent-controlled strings escaped via `esc()` or `.textContent`.

New for 2026:
- **EFA dedup key = email + rol** within RBD+programa, keep the most recent submission. A person can legitimately hold two roles (e.g. docente + mentor/a) and appears in both sections. **Section counts = responses in that role; program total ("N resp.") = unique people by email.**
- **Students: no dedup** (no email). Every answer listed as submitted.
- Student survey fields: programa, colegio, nivel, letra, nombre and/or número de lista. The form filters schools by region first; school option text is `Comuna - Nombre - RBD` (parse RBD from it).
- Test availability: ASE 4° básico → IV° medio; REL 5° básico → IV° medio. Estudiantes view = (implemented ∩ test-available) ∪ seen in responses.
- Class letters: derived from SF course count per grade (count 3 → A, B, C) ∪ letters seen in responses.
- Estimates: `est` from SF Estudiantes x Nivel. Grade % = r / est, may exceed 100% (flag "{r−est} sobre lo estimado", bar capped). No estimate → "Sin estimado", count only. Program % = Σr / Σest over grades with an estimate.
- **EFA has no %**, counts only (except EDI, see open decisions).
- EFA role categories are a fixed list (new list pending), mapped to Dirección / Líderes educativos / Docentes like `ROLES_LIDER` in EFS.
- **ASE docentes grouped by grade** (accordion). **REL docentes = flat list** (one REL teacher often covers all classrooms). Intentional.
- Survey phases (pre / open / closed) computed from `Config` dates. **Never hardcode dates or "faltan N días" in copy.**
- Links: one per program × survey for now, from `Config`.
- Footer contact: `evaluacion@fundaciontrabun.cl`; **EDI schools: `consultas_edi@fundaciontrabun.cl`** (driven by the SF EDI flag).

## Built in from day one (EFS backlog)
- Clave via **POST**, not GET query string. GAS has no OPTIONS/preflight handling: send `fetch` with `Content-Type: text/plain` and a JSON body, parse in `doPost`.
- OAuth scope: `https://www.googleapis.com/auth/spreadsheets.currentonly` in `appsscript.json` (not full `spreadsheets`). Must still allow writing `Métricas` in the bound sheet.
- `Métricas`: on **successful login only**, append `timestamp, rbd, programas, responsesOk`. Never clave, IP or names.
- `formatNombre()` for display (all-caps → title case, keeps particles de/del/la…, hyphens/apostrophes; cannot restore accents).
- Aggregation written as a pure function `rbd → payload`, so a time-driven precompute/cache can wrap it later if student volume makes logins slow.

## Status
- [ ] Data contract (sheet tabs + JSON shape) ← **next**
- [ ] Backend skeleton on staging deployment
- [ ] Frontend shell from EFS `index.html` → program card with synced folder tabs
- [ ] Estudiantes block (accordion 4a, classes, search, edge cases)
- [ ] Phases by date + share modal + real QR
- [ ] EFA block
- [ ] Mobile
- [ ] Launch (before 13-10): clear test rows, paste formulas, check column alignment, promote prod, move domain

## Open decisions
- `studentId`: "nombre" | "numero" (decision due ~06/07-10). Build both behind a config flag.
- New EFA role category list (to map into the three sections).
- **EDI base list for EFA:** identifier (must be email), whether schools see pending names or only "X de Y" (support vs. control framing), whether old EDI portal code is reusable. Respondents outside the list always shown, counted in total, not in denominator.
- Possible migration of the student survey to SurveyMonkey for per-school links.
