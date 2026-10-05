# Handoff: Portal de Seguimiento 2026 (Fundación Trabün)

## Overview
A web portal where a school logs in (RBD + clave) and tracks participation in two Trabün surveys, per program:

- **Test de Estudiantes**: students, 13 oct – 20 nov 2026.
- **EFA · Docentes y líderes** (Encuesta de Fin de Año): Dirección, líderes educativos and docentes, 2 – 20 nov 2026.

A school can have **ASE**, **Religión** or **both**. Each program the school has **always comes with both surveys**. So the panel shows 1 or 2 program cards, and each card switches between its two surveys.

This version replaces the 2025 portal (which only tracked teachers and leaders). The visual base (waves, header ribbon, login with mascot) is the approved design from the previous handoff and is included here unchanged (`trabun-organic.jsx`, `TYPOGRAPHY.md`).

## About the design files
The files in `prototipo/` are **design references built in HTML**: working prototypes that show the intended look and behavior. They are **not production code**. Rebuild them in the target stack (if none exists, React + a small API is a good fit) using its own patterns. Open `prototipo/Portal Seguimiento 2026.dc.html` in a browser to click through it. The Tweaks shown in the editor are for review only; in production they come from real data. Note: the prototype also loads a design-system stylesheet that isn't bundled here. It only adds tokens, so the page still renders.

## Fidelity
**High fidelity.** Colors, type, spacing, wave paths and interactions are final. Recreate them exactly.

---

## 1. Core principle
**"Orgánico en el chrome, rígido en el contenido."** Waves only appear in the header ribbon, login background, program-card header band and footer. Anything showing data sits in straight rectangular cards. Use the wave paths in `trabun-organic.jsx` **verbatim**. Never regenerate them with sine curves.

## 2. Screens

### 2.1 Login
- Full-height Papel `#f5f5f5` background with the `LoginWaveBg level="equilibrado"` cascade behind the card: paper (flex 1) → wave `mid` 72px → naranjo band 64px → wave `soft` 70px → celeste band 150px.
- Card wrapper: `position:relative; z-index:1; max-width:420px`.
- **Mascot** (`assets/mascota.png`) peeks from behind the card's top-right corner. Wrapper `position:absolute; z-index:0; top:-94px; right:10px; filter:drop-shadow(0 10px 16px rgba(21,27,41,.16))`. Image `width:150px; transform:rotate(3deg)`. Mobile: `112px / top -70px / right 8px`. **The card must be `position:relative; z-index:1`**, otherwise the mascot renders on top of it.
- Card: white, radius 22, shadow `0 18px 44px rgba(21,27,41,.16)`, padding `40px 38px` (mobile `32px 24px`), centered text, gap 18.
  - Logo `logo-official.png`, height 76.
  - H1 "Portal de Seguimiento 2026" (Mulish 800, 25px).
  - "Ingresa con el RBD y la clave de tu establecimiento." (Lato 14, `#3a4050`).
  - Fields "RBD" and "Clave" (labels Mulish 600 13; inputs Lato 15, padding 11×14, border `1px #d9d9dc`, radius 8, focus border `#b51a2a`).
  - Button "Ingresar": full-width pill, `#b51a2a`, hover `#9c1624`, press `translateY(1px)`, Mulish 700 15.
  - Footnote "¿No tienes la clave? Pídela a tu Jefe de Proyecto Trabün." (Lato 12.5, `#5b6070`).

### 2.2 Panel
Top to bottom:
1. **Nav bar** (white, padding `12px 32px`, mobile `10px 16px`): logo 44px (mobile 36), "Portal de Seguimiento" (Mulish 800 15.5), tag "2026" (Mulish 700 12, color `#b51a2a`, bg `rgba(181,26,42,.1)`, pill). Right side: "Cerrar sesión" (Mulish 700 13, hover red), which returns to login.
2. **Header ribbon** `HeaderWave level="audaz"`, default "Programas" scheme (celeste over naranjo): white→celeste `mid` 26px, celeste band 10px, celeste→naranjo `soft` 22px, naranjo band 8px, naranjo→papel `drip` 40px.
3. **Content** (max-width 1160, centered, padding `8px 40px`, mobile `6px 16px`, gap 28):
   - Eyebrow "ESTABLECIMIENTO" (Mulish 700 11, uppercase, tracking .14em, `#5b6070`).
   - School name, Mulish 800 38px (mobile 28), **ink `#151b29`, not red**.
   - "RBD 12345 · ASE y Religión" (or "· ASE" / "· Religión"), Mulish 700 12 `#5b6070`.
   - **Program cards grid**: two programs → `repeat(auto-fit, minmax(min(100%,540px), 1fr))`, gap 24 (they stack when narrow). One program → a single full-width card. Mobile → always one column.
4. **Footer**: `FooterWave` (papel→navy `drip` 60px, margin-top 56), then a navy `#151b29` footer. Left: `isotipo-white.png` 40px + "Fundación Trabün" (Mulish 800 15 white) / "Portal de Seguimiento 2026" (13). Right: "¿Dudas? Contacta a tu Jefe de Proyecto Trabün." Text color `rgba(255,255,255,.75)`.

### 2.3 Program card (folder tabs + card)
The survey tabs **sit directly on the card's top edge** (folder tabs). The active tab takes the program color and merges into the colored header band.

- **Tab row**: flex, gap 4, `flex-wrap:nowrap`, `margin-bottom:-1px`, z-index 2.
  - Each tab: padding `10px 14px 11px 12px`, radius `14px 14px 0 0`. Active bg = program color (ASE `#dc911b`, Religión `#6bacc4`); inactive bg `#e4e4e7`. Background transition 240ms `cubic-bezier(0.2,0.8,0.2,1)`.
  - Content: icon (Lucide `backpack` for Estudiantes, `users` for EFA, 15px, stroke 2) + label (Mulish 800 13) + status (Mulish 700 12.5, opacity .85). Text is white when active, `#5b6070` when inactive. **No pill or chip inside the tab.**
  - Labels: "Test de Estudiantes" / "EFA · Docentes y líderes". On mobile they shorten to "Estudiantes" / "EFA" and the status is hidden.
  - Status: before the survey opens, its opening date ("13 oct" / "2 nov"). Otherwise Estudiantes shows a % and EFA shows "N resp.".
  - **Both cards' tabs are synced**: one shared `activeSurvey` state.
- **Card**: white, radius `0 16px 16px 16px` (top-left square, where the tab joins), border `1px #e7e7ea`, shadow `0 1px 3px rgba(21,27,41,.08)`, overflow hidden.
  - **Header band**: program color, padding `18px 26px 14px` (mobile `16px 18px 12px`). Top-right light flare: radial gradient from white at .22 → .07 at 50% → 0, in a 320×170 SVG anchored top-right.
    - Eyebrow "PROGRAMA", then title "ASE" / "Religión" (Mulish 800 23 white), then "Aprendizaje Socioemocional" / "Programa de Religión" (Lato 13, white .92).
    - Survey line (12.5, white .92): `{Survey name} · {dates} · {status}`, e.g. "Test de Estudiantes · 13 oct – 20 nov · Abierta · faltan 15 días".
    - Right side: a pill (Mulish 800 18 white, bg `rgba(255,255,255,.2)`) showing the Estudiantes %, or "N resp." for EFA, or "—" before opening.
  - **Wave**: `WaveDivider top={programColor} bottom="#fff" variant="drip" height={56}`.
  - **Body**: padding `6px 26px 26px` (mobile `4px 16px 18px`), holds the survey block (§2.4 or §2.5).

### 2.4 Survey block: Test de Estudiantes
Vertical stack, gap 14:
1. **Status note** (only before opening or after closing): tray `#f6f4ef`, border `#e7e7ea`, radius 12, calendar icon.
   - Before opening: "Test de Estudiantes abre el 13 de octubre. Ya puedes compartir el link: se activará ese día."
   - After closing: "Test de Estudiantes cerró el 20 de noviembre. Esta es la participación final."
2. **Summary**: "{r} respuestas de ~{est} estudiantes estimados" (Mulish 700 14). Below it, "Niveles con Test de Estudiantes: 4° a 8° básico" (12, `#5b6070`).
3. **Search** (hidden before opening): pill input, white, border `#d9d9dc`, search icon. Placeholder "Buscar estudiante", or "Buscar por número de lista" in list-number mode. Matching ignores case and accents. In list-number mode the typed number must match exactly. While there is a query, the accordion is replaced by a results list (identifier + class); if empty: "Ninguna respuesta coincide con "…"."
4. **Grade accordion** (approved option "4a"): white box, border `#e7e7ea`, radius 12, rows separated by 1px lines.
   - Row grid: `minmax(96px,150px) | 1fr | 78px | 14px`, padding `11px 14px`, hover `#fafafa`.
   - Columns: grade label (Mulish 700 14) with an optional flag line underneath (Mulish 700 11.5 `#5b6070`) · bar (8px, track `#eef0f2`, fill = program color, width = `min(r, est) / est`, so it **never exceeds 100%**) · "{r} / ~{est}" (Mulish 800 13) · chevron that rotates 90° when open (240ms).
   - Several rows can be open at once; the first one starts open.
   - **Open row** → a grid of class sub-cards (`auto-fill, minmax(230px,1fr)`, gap 8). Each sub-card: `#f6f4ef` background, radius 10, label "6° básico A" + "{n} respuestas", then chips of the people who answered (white, border `#e7e7ea`, Mulish 600 12, pill). It shows the first 24 chips, then "Ver todas (n)" / "Ver menos". Empty class: "Aún sin respuestas."
   - Chip text: the name as typed, or "N° {list number}". Blank answers show as "Sin identificar" in gray. **No duplicate detection:** every answer is listed exactly as submitted.
5. **Share tray** (hidden after closing): `#f6f4ef` box with a program-color dot, the link in monospace 13 (ellipsis), "Copiar" (red text, changes to "Copiado" for 1.6s), and a red pill button "Recordar" while open or "Compartir" before opening. The button opens the share modal (§2.6).

### 2.5 Survey block: EFA · Docentes y líderes
Same note, summary ("{n} respuestas") and share tray as §2.4. No search.
- Sections **Dirección**, **Líderes educativos**, **Docentes**, each with a heading (Mulish 700 15) and its count (Mulish 800 13).
  - In a narrow card, sections are separated by 1px `#e7e7ea` dividers with 16px margin.
  - In a full-width single-program card, the three sections sit in 3 columns (gap 36) instead.
- People rows: name (Mulish 600 14) + role (Lato 12 `#5b6070`). **Only people who answered are listed** (there is no base list of who should answer).
- **ASE Docentes** are grouped by grade in an accordion: row = grade + count + chevron, all collapsed by default. **Religión Docentes** is a single flat list with no grades.

### 2.6 Share modal
- Overlay `rgba(21,27,41,.55)`; clicking the overlay closes it. Dialog: white, radius 16, max-width 560 (mobile 360), padding 26, shadow `0 24px 60px rgba(21,27,41,.28)`.
- Header: program dot + eyebrow "PROGRAMA ASE", title "Recordar: Test de Estudiantes" (or "Compartir: …" before opening), a subtitle for the audience, and a "×" close button.
- **Link** field + "Copiar" (outline red pill).
- **Mensaje**: a pre-written text in a tray (`white-space:pre-wrap`).
  - Test de Estudiantes, while open: a toggle "Incluir avance por nivel" (on by default) appends a list "• 4° básico: 21 de ~60" for each grade.
  - EFA: no toggle.
  - Exact copy is in the prototype's `renderVals` (`sh.msg`).
- Buttons: "Copiar mensaje" (red pill, changes to "Mensaje copiado") and "Enviar por WhatsApp" (outline pill linking to `https://wa.me/?text=<urlencoded message>`).
- **QR** block: a 96px QR code + "Para proyectar en la sala o imprimir en la sala de profesores." + "Descargar QR". It is a placeholder in the prototype; generate a real QR code.

---

## 3. Business rules (important)

### 3.1 Grades
- Grades in order: NT1, NT2, 1°–8° básico, I°–IV° medio.
- **Test availability:** ASE from 4° básico to IV° medio; Religión from 5° básico to IV° medio. Students can only pick available grades.
- **EFA availability:** NT1 to IV° medio.
- Each school implements each program in a specific set of grades (e.g. ASE in 1°–8° básico).
- **Estudiantes shows** the grades the school implements that also have the test available.
- **EFA ASE Docentes shows** the grades the school implements.

### 3.2 Union rule (base list + what respondents declare)
Always show the **union** of what the school has registered and what respondents say about themselves:
- **Grade outside what's registered** (e.g. a student picks IV° medio but the school only implements up to 8° básico; or a teacher declares I° medio): add a row at the end of the accordion with the neutral flag "Fuera de lo registrado". It has no estimate, so it shows only its count and an empty bar at 35% opacity. **No warning or comment.** This is often legitimate.
- **Class letter that doesn't exist** (e.g. 6° básico C when only A and B exist): show its sub-card normally, with the gray line "Curso no registrado. Si este curso existe, avísale a tu Jefe de Proyecto para agregarlo."
- **Never** label anything as "probable error". Don't show alert icons or red to schools.
- These answers **count in all totals**.

### 3.3 Estimates and percentages
- Students: there is **no student list**, only an **estimated enrollment per grade** (`est`). Grade % = `r / est` and can exceed 100%. When it does, the flag reads "{r − est} sobre lo estimado" and the bar stays capped at full. A grade without an estimate shows "{r} respuestas", no bar, and the flag "Sin estimado".
- The program % in the band and tab = Σr / Σest over grades that have an estimate.
- EFA: no base list, so **no percentage**, only counts ("N resp.").
- Some schools *do* have an EFA base list. That case is **not designed yet**: ask before building it.

### 3.4 Identifying students
Legislation may prevent asking for names. Support both modes with a per-deployment config `studentId: "nombre" | "numero"`. In number mode, chips read "N° 14", the search uses list number, and results are sorted by number.

### 3.5 Survey phases (from today's date)
| Phase | Tab status | Band | Body |
|---|---|---|---|
| Not open yet (`pre`) | open date | "Abre el 13 oct", pill "—" | note "abre el…", estimates only ("~60"), no search, tray shows "Compartir" |
| Open (`open`) | % or "N resp." | "Abierta · faltan N días" | normal, tray shows "Recordar" |
| Closed (`closed`) | final % or "N resp." | "Cerrada el 20 nov" | note "cerró el…", no tray |

Dates: Test 13 oct – 20 nov; EFA 2 – 20 nov (2026). Keep them configurable.

### 3.6 Links
One link per program × survey (up to 4): `trabun.cl/test/ase/{RBD}`, `trabun.cl/test/rel/{RBD}`, `trabun.cl/efa/ase/{RBD}`, `trabun.cl/efa/rel/{RBD}`. These URL patterns are placeholders; use the real survey URLs.

---

## 4. Suggested data model
```ts
School { rbd: string; name: string; programs: ProgramConfig[] }
ProgramConfig {
  program: "ase" | "rel";
  implementedGrades: Grade[];                  // e.g. 1° a 8° básico
  courses: Record<Grade, string[]>;            // registered letters, e.g. {"6° básico": ["A","B"]}
  studentEstimate: Record<Grade, number|null>; // estimated enrollment per grade
  links: { est: string; efa: string };
}
StudentResponse { program; grade: Grade; letter: string; name?: string; listNumber?: number; submittedAt }
EfaResponse { program; role: "direccion"|"lider"|"docente"; name: string; cargo: string; grade?: Grade /* ASE docentes */; submittedAt }
SurveyWindow { kind: "est"|"efa"; opens: Date; closes: Date }
```
Derived views:
- Estudiantes: grades = (implemented ∩ test-available) ∪ grades seen in responses.
- Classes per grade = registered letters ∪ letters seen.
- EFA ASE Docentes grades = implemented ∪ grades declared.

The prototype's `prototipo/datos-portal.js` builds this shape with fake data (`students()`, `efa()`, `summary()`, `scope()`, `phase()`, `statusLabel()`). Use it as a behavioral reference.

## 5. State
- `screen`: login | panel
- `activeSurvey`: "est" | "efa" (shared by both cards)
- Per survey block: open accordion rows (set), the search query, and "Ver todas" expansions per class
- Share modal: `{program, kind} | null`, the `includeProgress` toggle, and "copied" feedback flags (1.6s)

## 6. Responsive
- Breakpoint around 600px: mobile layout (nav and padding reduced, h1 28px, cards in one column, short tab labels with no status, mobile mascot values).
- Wider than 600px: two cards side by side when there's room (minimum 540px each), otherwise stacked.
- Tap targets: at least 44px on mobile.

## 7. Design tokens
| Token | Hex | Use |
|---|---|---|
| Rojo Trabün | `#b51a2a` | buttons, links, focus |
| Rojo oscuro | `#9c1624` | hover/press |
| Tinta | `#151b29` | text, footer |
| Papel | `#f5f5f5` | page background |
| Naranjo | `#dc911b` | ASE |
| Celeste | `#6bacc4` | Religión |
| Verde limón | `#a2c037` | (accent, unused here) |
| Tray | `#f6f4ef` | resource / class sub-cards |
| Border | `#e7e7ea` (cards), `#d9d9dc` (inputs) | |
| Muted text | `#5b6070`, `#3a4050` | |
| Bar track | `#eef0f2` | |
| Inactive tab | `#e4e4e7` | |

- Radii: 8 (inputs), 10 (class sub-cards), 12 (trays, accordion), 14 (tab tops), 16 (cards, modal), 22 (login card), 999 (pills).
- Shadows: card `0 1px 3px rgba(21,27,41,.08)`; login card `0 18px 44px rgba(21,27,41,.16)`; modal `0 24px 60px rgba(21,27,41,.28)`.
- Motion: 120ms hover, 240ms state changes, easing `cubic-bezier(0.2,0.8,0.2,1)`. No bounce.
- Type: **Mulish** for headings, labels, numbers, buttons; **Lato** for sentences; monospace for links. Details in `TYPOGRAPHY.md`. No emoji.

## 8. Assets
- `assets/logo-official.png`: full logo (nav, login).
- `assets/mascota.png`: login mascot, 1080×1080 transparent.
- `assets/isotipo-white.png`: footer.
- `assets/isotipo-red.png`: light backgrounds (unused here).
- Icons: Lucide (`backpack`, `users`, `search`, `calendar`, `chevron-right`), stroke 2.

## 9. Files
- `prototipo/Portal Seguimiento 2026.dc.html`: login, panel, cards, share modal, footer.
- `prototipo/Encuesta Programa.dc.html`: the survey block (Estudiantes / EFA) used inside each card.
- `prototipo/datos-portal.js`: fake data and business rules.
- `trabun-organic.jsx`: wave components and exact SVG paths (`WaveDivider`, `HeaderWave`, `LoginWaveBg`, `FooterWave`).
- `TYPOGRAPHY.md`: font reference.
