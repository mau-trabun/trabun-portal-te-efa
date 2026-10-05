/* ============================================================================
   Trabün — Organic "wave" system  (React, no external deps)
   ----------------------------------------------------------------------------
   Drop this file into your project and render the components below.
   Everything here is self-contained: colors, wave paths, and components.

   THE GOLDEN RULE behind the look:
   "orgánico en el chrome, rígido en el contenido" — organic wavy shapes only
   frame things (headers, login background, footer). Anything showing DATA stays
   in straight rectangular cards. Never put a wave behind a data table/card.

   ⚠️  DO NOT regenerate the wave shapes with Math.sin() or symmetric curves.
       The hand-tuned, ASYMMETRIC bezier paths in WAVE_PATHS are what make this
       feel brand-authentic instead of "default CSS wave". Use them verbatim.
   ========================================================================== */

/* Trabün palette (only these — never invent colors) */
const C = {
  red:     "#b51a2a",  // Rojo Trabün (primary)
  redDark: "#9c1624",
  amber:   "#dc911b",  // Naranjo  → Programa ASE
  celeste: "#6bacc4",  // Celeste  → Programa Religión
  lime:    "#a2c037",
  yellow:  "#fcb203",
  navy:    "#151b29",  // Tinta
  paper:   "#f5f5f5",  // Papel (soft neutral bg)
  white:   "#ffffff",
};

/* ----------------------------------------------------------------------------
   1) WAVE PATHS — the heart of it. A 1440×100 viewBox. Each path traces a wavy
   TOP edge and then floods down to y=100, so the path is a solid block whose
   top border is wavy. The control points are intentionally irregular.
   -------------------------------------------------------------------------- */
const WAVE_PATHS = {
  soft: "M0,38 C240,86 470,4 720,34 C980,66 1180,96 1440,42 L1440,100 L0,100 Z",
  mid:  "M0,56 C210,14 430,92 710,56 C1000,18 1200,82 1440,44 L1440,100 L0,100 Z",
  drip: "M0,26 C150,72 290,74 430,46 C560,22 650,72 790,60 C930,49 1010,16 1170,46 C1290,68 1360,52 1440,34 L1440,100 L0,100 Z",
};

/* ----------------------------------------------------------------------------
   2) WaveDivider — one wavy boundary between two solid color bands.
   THE BLEED TRICK: container background = color ABOVE the wave; path fill =
   color BELOW the wave. The wavy line becomes the seam between them.

   Three things that BREAK it if omitted:
     • preserveAspectRatio="none"  → lets the 1440×100 viewBox stretch to any
       width (without it the wave stays centered & squished).
     • display:block + lineHeight:0 → kills inline-SVG whitespace, otherwise you
       get ~4px hairline gaps/seams between bands.
     • fill={bottom} (NOT the same as the container bg).
   -------------------------------------------------------------------------- */
function WaveDivider({ top, bottom, height = 64, variant = "soft", flip, style }) {
  return (
    <div style={{ background: top, lineHeight: 0, ...style }}>
      <svg
        viewBox="0 0 1440 100"
        preserveAspectRatio="none"
        style={{ display: "block", width: "100%", height, transform: flip ? "scaleY(-1)" : undefined }}
      >
        <path d={WAVE_PATHS[variant]} fill={bottom} />
      </svg>
    </div>
  );
}

/* ----------------------------------------------------------------------------
   3) HeaderWave — the colored ribbon under the page header.
   It is NOT a single wave: it's a stack of dividers + thin solid bands. That
   layering (and using a different `variant` per divider) is what gives depth.

   Default scheme "Programas" = celeste on top + naranjo below: carries BOTH
   program colors at once, so it favors neither program.
   Pass scheme={{ a, b }} to recolor. Always anchor a or b on a predominant
   color (red / navy / paper) — never a single program color alone.
   -------------------------------------------------------------------------- */
function HeaderWave({ level = "audaz", scheme }) {
  const a = (scheme && scheme.a) || C.celeste;
  const b = (scheme && scheme.b) || C.amber;
  const { paper, white } = C;

  if (level === "audaz") {
    return (
      <div style={{ lineHeight: 0 }}>
        <WaveDivider top={white} bottom={a} variant="mid"  height={26} />
        <div style={{ height: 10, background: a }} />
        <WaveDivider top={a}     bottom={b} variant="soft" height={22} />
        <div style={{ height: 8,  background: b }} />
        <WaveDivider top={b}     bottom={paper} variant="drip" height={40} />
      </div>
    );
  }
  if (level === "equilibrado") {
    return (
      <div style={{ lineHeight: 0 }}>
        <WaveDivider top={white} bottom={a} variant="soft" height={24} />
        <div style={{ height: 8, background: a }} />
        <WaveDivider top={a}     bottom={b} variant="mid"  height={20} />
        <div style={{ height: 6, background: b }} />
        <WaveDivider top={b}     bottom={paper} variant="soft" height={40} />
      </div>
    );
  }
  // sutil
  return (
    <div style={{ lineHeight: 0 }}>
      <div style={{ height: 4, background: a }} />
      <WaveDivider top={white} bottom={paper} variant="soft" height={40} />
    </div>
  );
}

/* Alternative ribbon schemes (pass as `scheme` prop). Each anchored on a
   predominant color so it never reads as "one program":
     PROGRAMAS:       { a: C.celeste, b: C.amber }   // default
     ROJO + TINTA:    { a: C.red,     b: C.navy }
     TONAL ROJO:      { a: C.red,     b: C.redDark }
     ROJO + AMARILLO: { a: C.red,     b: C.yellow }                          */

/* ----------------------------------------------------------------------------
   4) LoginWaveBg — full-bleed cascading wave background for the login screen.
   Absolutely positioned (inset:0) BEHIND the login card. Use level="equilibrado"
   on the access screen (our locked choice). The cascade = solid band → divider
   → solid band, each divider a different variant so it never looks repetitive.
   -------------------------------------------------------------------------- */
function LoginWaveBg({ level = "equilibrado" }) {
  const band = (bg, grow, h) => ({ background: bg, flex: grow ? "1 1 0" : `0 0 ${h}px` });
  let stack;

  if (level === "audaz") {
    stack = (
      <>
        <div style={band(C.amber, true)} />
        <WaveDivider top={C.amber}   bottom={C.celeste} variant="mid"  height={70} />
        <div style={band(C.celeste, false, 70)} />
        <WaveDivider top={C.celeste} bottom={C.red}     variant="soft" height={70} />
        <div style={band(C.red, false, 70)} />
        <WaveDivider top={C.red}     bottom={C.navy}    variant="drip" height={64} />
        <div style={band(C.navy, false, 90)} />
      </>
    );
  } else if (level === "equilibrado") {
    stack = (
      <>
        <div style={band(C.paper, true)} />
        <WaveDivider top={C.paper} bottom={C.amber}   variant="mid"  height={72} />
        <div style={band(C.amber, false, 64)} />
        <WaveDivider top={C.amber} bottom={C.celeste} variant="soft" height={70} />
        <div style={band(C.celeste, false, 150)} />
      </>
    );
  } else {
    stack = (
      <>
        <div style={band(C.paper, true)} />
        <WaveDivider top={C.paper} bottom={C.celeste} variant="soft" height={88} />
        <div style={band(C.celeste, false, 70)} />
      </>
    );
  }

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", zIndex: 0 }}>
      {stack}
    </div>
  );
}

/* ----------------------------------------------------------------------------
   5) FooterWave — navy footer rises into the page in irregular drips.
   Put this directly above your footer. marginBottom:-1 hides the seam.
   -------------------------------------------------------------------------- */
function FooterWave({ content = C.paper }) {
  return <WaveDivider top={content} bottom={C.navy} variant="drip" height={60} style={{ marginBottom: -1 }} />;
}

/* ----------------------------------------------------------------------------
   6) CornerBlob — soft organic shape that bleeds from a card's top-right corner.
   Decorative only; keep it inside the header strip, never over data.
   Parent must be position:relative + overflow:hidden.
   -------------------------------------------------------------------------- */
function CornerBlob({ color, size = 150 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 160 160" aria-hidden="true"
      style={{ position: "absolute", top: 0, right: 0, pointerEvents: "none" }}>
      <path d="M160 0 L160 92 C150 70 120 64 96 52 C70 39 44 26 44 0 Z" fill={color} opacity="0.16" />
      <path d="M160 0 L160 60 C150 46 128 44 108 34 C86 23 74 14 78 0 Z" fill={color} opacity="0.95" />
    </svg>
  );
}

/* ----------------------------------------------------------------------------
   7) Mascot — decorative blob character used on the login screen.
   NOTE: this is a *placeholder* in the spirit of the brand. For an authentic
   brand stamp, prefer the real brushy isotipo PNG shipped in /assets. Render
   the Mascot peeking over the top-right corner of the login card with a slight
   rotation + drop-shadow (see HANDOFF.md).
   -------------------------------------------------------------------------- */
function Mascot({ color = C.celeste, size = 96, arm, style }) {
  return (
    <svg width={size} viewBox="0 0 110 124" style={style} aria-hidden="true">
      <circle cx="55" cy="9" r="6" fill={color} />
      <rect x="53" y="12" width="4" height="12" rx="2" fill={color} />
      <path d="M55 18 C80 18 96 38 96 64 C96 98 79 116 55 116 C31 116 14 98 14 64 C14 38 30 18 55 18 Z" fill={color} />
      {arm && <path d="M92 60 C104 50 110 56 106 66 C103 74 96 74 90 70 Z" fill={color} />}
      <circle cx="43" cy="60" r="12" fill="#fff" />
      <circle cx="71" cy="60" r="12" fill="#fff" />
      <circle cx="45" cy="62" r="5.5" fill={C.navy} />
      <circle cx="69" cy="62" r="5.5" fill={C.navy} />
      <circle cx="47" cy="60" r="1.8" fill="#fff" />
      <circle cx="71" cy="60" r="1.8" fill="#fff" />
      <circle cx="33" cy="78" r="5" fill="#fff" opacity="0.28" />
      <circle cx="77" cy="78" r="5" fill="#fff" opacity="0.28" />
      <path d="M46 82 Q55 92 64 82" stroke={C.navy} strokeWidth="3.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/* If you use ES modules, replace this with `export { ... }`.
   If you load via <script type="text/babel">, this exposes them globally. */
if (typeof window !== "undefined") {
  Object.assign(window, { WaveDivider, HeaderWave, LoginWaveBg, FooterWave, CornerBlob, Mascot, WAVE_PATHS, TRABUN_COLORS: C });
}
