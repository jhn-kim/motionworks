// Central palette + interaction tunables for every manipulation surface.
// A design pass over this file changes the whole overlay's look and feel;
// no other surface module should own a colour or a pixel constant.

// The overlay is strictly grayscale — it must never compete with the
// product's own colors. Hierarchy comes from brightness and opacity alone.
export const COLORS = {
  // Primary accent — every surface stroke, handle fill, and selection highlight.
  accent: "rgb(250, 250, 250)",
  accentSoft: "rgba(250, 250, 250, 0.85)",
  accentFaint: "rgba(250, 250, 250, 0.32)",
  accentGhost: "rgba(250, 250, 250, 0.14)",
  // Secondary accent (used sparingly — spring stiffness handle, gradient nib).
  accentAlt: "rgb(170, 170, 170)",
  accentAltSoft: "rgba(170, 170, 170, 0.7)",
  // Warning tone — validation flags, stale prompts.
  warn: "rgb(212, 212, 212)",
  warnSoft: "rgba(212, 212, 212, 0.4)",
  warnGhost: "rgba(212, 212, 212, 0.12)",
  // Error tone — reserved for hard failures.
  error: "rgb(255, 255, 255)",
  errorSoft: "rgba(255, 255, 255, 0.4)",
  errorGhost: "rgba(255, 255, 255, 0.12)",
  // Neutral surfaces — panels, tooltips, gaps.
  neutralInk: "rgb(245, 245, 245)",
  neutralInkMuted: "rgba(245, 245, 245, 0.66)",
  panelBg: "rgba(18, 18, 18, 0.94)",
  panelBorder: "rgba(163, 163, 163, 0.35)",
  panelHairline: "rgba(163, 163, 163, 0.18)",
  ghost: "rgba(163, 163, 163, 0.55)",
  // Dark under-stroke drawn beneath light overlay linework so it stays
  // visible over light app backgrounds (the light stroke handles dark ones).
  casing: "rgba(17, 17, 17, 0.55)",
};

// The slider-knob material (see .ms-slider thumb in family-panel), reused by
// draggable canvas handles: white with a soft drop shadow and a slightly
// shaded bottom edge standing in for the knob's inset shadow. The shadow is
// what guarantees contrast on white app backgrounds.
export const KNOB = {
  fillTop: "#ffffff",
  fillBottom: "#e2e2e2",
  rim: "rgba(0, 0, 0, 0.25)",
  shadow: { dx: 0, dy: 1.5, blur: 1.2, color: "rgba(0, 0, 0, 0.3)" },
  inverse: {
    fillTop: "#000000",
    fillBottom: "#1d1d1d",
    shadow: { dx: 0, dy: 1.5, blur: 1.2, color: "rgba(255, 255, 255, 0.3)" },
  },
};

// Frosted-glass material for the toolkit chrome (chip, launcher, cursor
// counter, hover chips). One tint for every surface: a light neutral smoke
// that stays legible over both light and dark apps because the blur +
// saturation carry the context through.
export const GLASS = {
  background: "rgba(12, 12, 16, 0.48)",
  backdrop: "blur(28px) saturate(160%)",
  border: "1px solid rgba(255, 255, 255, 0.16)",
  shadow:
    "0 12px 32px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.10)",
  radiusLarge: 16,
  radiusSmall: 10,
  // Interactive fills inside a glass surface.
  fill: "rgba(255, 255, 255, 0.08)",
  fillHover: "rgba(255, 255, 255, 0.14)",
  fillActive: "rgba(255, 255, 255, 0.26)",
  hairline: "rgba(255, 255, 255, 0.2)",
  // Scrollable regions inside glass panels. The UA default thumb is too
  // dark to read against the smoke; track stays invisible.
  scrollbarColor: "rgba(255, 255, 255, 0.3) transparent",
} as const;

export const STROKE = {
  primary: 1.5,
  secondary: 1,
  dashed: "4 4",
  chunky: 2,
};

export const HIGHLIGHT = {
  // Breathing room between an element's bounding box and the highlight
  // outline (px) — the outline frames the element rather than hugging it.
  offset: 3,
};

export const HANDLES = {
  // Visible circle radius of a discrete SVG handle.
  visibleRadius: 5,
  // Hit-area radius — larger than the visible dot so pointerdown is forgiving.
  hitRadius: 12,
  // Small anchor for paths / gradient stops.
  anchorRadius: 6,
  // Bezier control-point radius (a bit smaller than the anchor).
  bezierRadius: 4,
};

export const FONT = {
  family: "ui-sans-serif, -apple-system, system-ui, sans-serif",
  mono: "ui-monospace, monospace",
  sizeSmall: 11,
  sizeBody: 12,
  sizeLabel: 10,
  sizeStrong: 13,
};

export const PANEL = {
  padding: 12,
  radius: 8,
  gap: 8,
  minWidth: 240,
  shadow: "0 10px 30px rgba(0, 0, 0, 0.4)",
};

// ── Per-surface interaction tunables ─────────────────────────────────────

export const RADIUS_SURFACE = {
  // Minimum radius that a designer can drag to — below this the handle is
  // unusable. Overridden by `param.min` when that is greater.
  minHandlePx: 8,
};

export const STRENGTH_SURFACE = {
  // Distance from element centre at which the value reaches param.max.
  // Dragging further clamps.
  maxDragDistance: 80,
  // Length of a full-strength arrow in pixels (0-length at strength 0).
  arrowMaxLength: 60,
  // Number of arrows radiating from the centre.
  arrowCount: 8,
  // How wide the arrow head is.
  arrowHeadWidth: 6,
  arrowHeadLength: 8,
};

export const DECAY_SURFACE = {
  // Cap on the position history buffer. ~2s at 60fps.
  historyCap: 120,
  // How trail length maps to the parameter value. The base trail length
  // (in pixels) at value=1 vs value=0.
  minTrailPx: 4,
  maxTrailPx: 220,
  // Dot spacing for the tapered trail.
  dotStepPx: 4,
  // Minimum motion magnitude (in px between frames) that counts as "moving".
  motionThreshold: 0.5,
  // How long the element must be stationary (ms) before the fallback prompt
  // is shown.
  stationaryPromptMs: 500,
};

export const RESPONSE_SURFACE = {
  // Gap-to-value mapping is non-linear: small changes at low gaps matter more.
  // At the low end, value≈1/(1 + gapCurveScale * gap^gapCurveExponent).
  gapCurveScale: 0.02,
  gapCurveExponent: 1.4,
  // Maximum ghost lag distance drawn in pixels (visual cap; the underlying
  // value is still exposed).
  maxGhostLagPx: 140,
  // Trigger fallback rendering after this many ms without a cursor over the
  // element.
  stationaryPromptMs: 500,
};

export const SPRING_SURFACE = {
  // Maximum displacement the designer can drag the element (px). The spring
  // sim always animates back to origin (0, 0).
  maxPullPx: 220,
  // Cap on stiffness/damping so the sim stays visually meaningful.
  stiffnessRange: { min: 40, max: 800, default: 240 },
  dampingRange: { min: 2, max: 60, default: 20 },
  massRange: { min: 0.4, max: 4, default: 1 },
  // Axis handle offsets from the element centre (px).
  stiffnessHandleOffset: 120,
  dampingHandleOffset: 90,
};

export const GRADIENT_SURFACE = {
  // Fallback bar (below the element) dimensions.
  barHeight: 24,
  barMarginTop: 12,
  // Stop nib.
  stopRadius: 8,
  stopBorderPx: 2,
};

export const PATH_SURFACE = {
  // Anchor + bezier handle sizes come from HANDLES. Only path-specific
  // colours / stroke widths belong here.
  strokeWidth: 2,
  handleLineDash: "2 3",
  handleLineOpacity: 0.65,
  // Sampling density when hit-testing a curved segment for click-to-add.
  samplesPerSegment: 24,
  // Padding around the curve's bounding box for the add-anchor click target.
  clickPad: 40,
  // Cursor affordance only appears when the pointer is actually over the
  // visible curve, rather than anywhere inside its generous click bounds.
  trackHoverPx: 8,
};

export const STAGGER_SURFACE = {
  // Timeline strip (below the group).
  timelineHeight: 72,
  timelineMarginTop: 16,
  // Ghost width for a stagger frame (each element's silhouette).
  ghostWidth: 44,
  ghostHeight: 44,
  // Number of pixels per millisecond on the axis.
  pxPerMs: 0.35,
  // Minimum delay between two frames after a drag.
  minDelayMs: 0,
};

export const SCRUBBER = {
  height: 40,
  padding: 12,
  bottomOffset: 16,
  handleRadius: 8,
  // Total duration when the effect hasn't opted in to a specific range.
  defaultDurationMs: 2000,
};

// Reserved keys the overlay writes into update() calls.
export const RESERVED_KEYS = {
  scrub: "__motionworksScrub",
  active: "__motionworksActive",
  // Replay button: value is a fresh timestamp each press so update() always
  // sees a change. Effects with capabilities.replay re-run their entrance.
  replay: "__motionworksReplay",
};

// Surface capability flag on a schema. When true, the scrubber is shown for
// the effect; otherwise it stays hidden (effects that don't handle the
// reserved key would just be frozen at value=0). See ARCHITECTURE.md note in
// the phase-5 handoff — this is an addition to the existing schema and is
// documented here in code.
export const CAPABILITIES = {
  scrub: "motionworks:supports-scrub",
};

// Numeric editor styling (right-click "Enter exact value…").
export const NUMERIC_EDITOR = {
  width: 100,
  padding: "4px 6px",
  radius: 4,
};

// Custom colour picker popover (color-picker.tsx) — replaces the unstylable
// OS-native <input type="color"> dialog. Shared by the toolkit gradient rows
// and the on-canvas gradient surface.
export const COLOR_PICKER = {
  width: 188,
  svHeight: 120,
  hueHeight: 12,
  thumbRadius: 7,
  swatchSize: 22,
  swatchRadius: 5,
  padding: 10,
  gap: 8,
  // Gap between a swatch button and the popover it anchors.
  offsetY: 6,
};

// Context menu styling.
export const CONTEXT_MENU = {
  itemPadding: "6px 10px",
  itemHoverBg: "rgba(255, 255, 255, 0.1)",
  submenuIndent: 4,
  radius: 6,
  minWidth: 180,
  shadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
};
