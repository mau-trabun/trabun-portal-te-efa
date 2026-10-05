# Trabün Portal — Typography Reference

The whole UI runs on **two families** (plus monospace for one detail). The clean
feel comes from keeping them strictly separated: **Mulish** for anything
structural/labeling at heavy weights, **Lato** for sentences.

## Load (Google Fonts)
```html
<link href="https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700;900&family=Mulish:wght@400;500;600;700;800;900&family=Raleway:wght@400;500;600;700;800&display=swap" rel="stylesheet">
```

```css
:root {
  --font-head: "Mulish", system-ui, sans-serif;   /* headings + UI labels (Filson Pro substitute) */
  --font-body: "Lato",   system-ui, sans-serif;   /* body copy */
  --font-mono: ui-monospace, monospace;           /* code-like strings only */
}
```

- **Mulish** is the brand-sans substitute for **Filson Pro** (the real brand sans — swap in the `.otf` if you have it).
- **Raleway** is an acceptable alternate heading face (same role) — swap `--font-head` if preferred.
- **Aurea Ultra** is the brand's *ceremonial display* face (covers, pull quotes). It is **not** used in this UI — only Mulish + Lato. Reach for it only on hero/cover moments.

## Where each font goes

| Section / element | Font | Weight | Size |
|---|---|---|---|
| Header logo lockup ("Portal de Seguimiento") | Mulish | 800 | ~15.5px |
| "EFS 2026" tag, RBD | Mulish | 700 | 12px |
| Eyebrows ("ESTABLECIMIENTO", "PROGRAMA") | Mulish | 700, uppercase, `letter-spacing:.14em` | 11px |
| School name (h1) | Mulish | 800 | 38px |
| Program title (h3) | Mulish | 800 | 23px |
| Section labels ("Dirección", "Docentes") | Mulish | 700 | 15px |
| % pill number / grade chips ("23/36") | Mulish | 800 | 13–18px |
| Person names | Mulish | 600 | 14px |
| Buttons ("Ingresar", "Actualizar") | Mulish | 700 | 14–15px |
| Form labels ("RBD", "Clave") | Mulish | 600 | 13px |
| Login welcome (h1) | Mulish | 800 | 25px |
| **Body paragraphs** (info note, descriptions) | **Lato** | 400 | 13.5–14.5px |
| Person roles, "clases" metadata, captions | Lato | 400 | 12–12.5px |
| Survey URL string | monospace | 400 | 13.5px |

## Rules of thumb
- **Mulish** for anything structural/labeling: titles, eyebrows, numbers, buttons, names, chips. Heavy weights (600–800).
- **Lato** for sentences and metadata. Regular 400.
- Sentence case everywhere **except eyebrows** (uppercase, tracked `.14em`).
- Headings: `line-height: 1.15`, `letter-spacing: -0.01em`. Body: `line-height: 1.5`.
- No emoji.
