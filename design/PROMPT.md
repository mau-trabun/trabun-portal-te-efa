# Starter prompt (paste into a new Claude chat and attach this whole folder)

I'm building the **Portal de Seguimiento 2026** for Fundación Trabün: a web page where schools log in and track participation in two surveys (Test de Estudiantes and EFA · Docentes y líderes), for the ASE and/or Religión programs. The design is finished and approved. I need working code.

Everything is in the attached folder:
- `README.md`: the full spec (screens, business rules, data model, tokens). Read it first, end to end.
- `prototipo/`: working HTML prototypes of the approved design. Open `Portal Seguimiento 2026.dc.html` to see the behavior.
- `trabun-organic.jsx`: wave components with the exact SVG paths.
- `TYPOGRAPHY.md`: fonts and sizes.
- `assets/`: logo, isotipos, mascot.

Rules:
1. Copy the wave SVG paths and the mascot offsets **verbatim**. Don't redraw or "improve" anything.
2. "Orgánico en el chrome, rígido en el contenido": waves only in the ribbon, login, card header band and footer. Data stays in straight cards.
3. Follow the business rules in README §3 exactly. In particular: the union of registered and self-declared grades and classes, no "probable error" labels, no duplicate detection, students identified by name **or** list number (configurable), and EFA shown as counts only.
4. Use only the palette and fonts in the spec (Mulish + Lato). No emoji.
5. If something is unclear or conflicts with my stack, ask before deviating.

My stack / where this will run: **[fill in: e.g. React + Vite, Next.js, Google Apps Script, plain HTML + a Google Sheet as the data source…]**
Where the data comes from: **[fill in: e.g. Google Forms → Sheets, Salesforce, a database…]**

Work in this order and show me each step before moving on:
1. Data layer: the types from README §4 plus a mock that matches `prototipo/datos-portal.js`.
2. Tokens, fonts, wave components.
3. Login screen (wave background + mascot behind the card).
4. Panel shell (nav, ribbon, school header, footer).
5. Program card with folder tabs, synced across cards.
6. Test de Estudiantes block: grade accordion, classes, search, edge cases.
7. EFA block (ASE docentes by grade, Religión flat).
8. Share modal (copy link, copy message, WhatsApp, real QR).
9. Survey phases by date, then responsive/mobile.

Start by reading `README.md` and telling me in a few lines how you'll structure the code.
