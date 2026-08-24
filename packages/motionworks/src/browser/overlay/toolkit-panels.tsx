import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { MotionWorksParam, ParameterType } from "../../shared/index.js";

import { ColorSwatch } from "./color-picker.js";
import { useOverlaySession } from "./context.js";
import { translateAnchor } from "./surfaces/path.js";
import { SurfaceContextMenu } from "./surfaces/shared/context-menu.js";
import { COLORS, FONT, GLASS } from "./theme.js";

// One parameter as the toolkit panel sees it: the schema param plus the
// live (possibly manipulated, uncommitted) value.
export interface PanelParamEntry {
  paramKey: string;
  param: MotionWorksParam;
  liveValue: unknown;
}

interface PanelProps {
  type: ParameterType;
  label: string;
  effectId: string;
  entries: PanelParamEntry[];
}

export interface SliderBounds {
  min: number;
  max: number;
  step: number;
}

// Fallback ranges per type for schemas that omit min/max. Exported for tests.
const TYPE_RANGES: Record<ParameterType, { min: number; max: number }> = {
  "spatial-radius": { min: 0, max: 400 },
  "spatial-strength": { min: 0, max: 2 },
  "temporal-decay": { min: 0, max: 1 },
  "temporal-response": { min: 0, max: 1 },
  "spring-response": { min: 0, max: 1 }, // unused — spring uses SPRING_SURFACE ranges
  gradient: { min: 0, max: 1 },
  path: { min: 0, max: 1 },
  stagger: { min: 0, max: 600 },
  duration: { min: 0, max: 2000 },
  "easing-curve": { min: 0, max: 1 }, // unused — curve editor is not a slider
  scalar: { min: 0, max: 1 },
};

export function sliderBoundsFor(
  param: MotionWorksParam,
  type: ParameterType,
): SliderBounds {
  const base = TYPE_RANGES[type];
  let min = param.min ?? base.min;
  let max = param.max ?? base.max;
  if (!(min < max)) {
    min = base.min;
    max = base.max;
  }
  return { min, max, step: stepForRange(max - min) };
}

export function stepForRange(range: number): number {
  if (range <= 2) return 0.01;
  if (range <= 20) return 0.1;
  return 1;
}

export function roundToStep(value: number, step: number): number {
  const inv = 1 / step;
  return Math.round(value * inv) / inv;
}

// A type's section inside the toolkit: one row (or row group) per parameter
// of that type on the selected effect. All edits flow through
// session.manipulate — same live-update path the old on-element surfaces used.
const PANEL_IN_CSS = `
@keyframes ms-editor-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
`;

export function ToolkitTypePanel({
  type,
  label,
  effectId,
  entries,
}: PanelProps): React.JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "6px 10px 8px",
        // Adopt the chip's width (never dictate it) so editors fill the bar.
        width: 0,
        minWidth: "100%",
        boxSizing: "border-box",
        // Same gooey entrance as the family tool panels: content rises and
        // fades in while the chip's own morph stretches to fit.
        // Content stays geometrically still — the chip's gooey growth is
        // the only motion, revealing it at exactly its own speed. Opacity
        // rides along on the same clock.
        animation: "ms-editor-in 360ms cubic-bezier(0.32, 1.12, 0.35, 1)",
      }}
    >
      <style data-motionworks-overlay-style="">{PANEL_IN_CSS}</style>
      {label !== "" ? (
        <span
          style={{
            fontSize: FONT.sizeLabel,
            letterSpacing: 0.08,
            textTransform: "uppercase",
            color: "rgba(255, 255, 255, 0.45)",
            fontFamily: FONT.family,
          }}
        >
          {label}
        </span>
      ) : null}
      {entries.map((entry) => (
        <PanelParam
          key={entry.paramKey}
          type={type}
          effectId={effectId}
          entry={entry}
        />
      ))}
    </div>
  );
}

function PanelParam({
  type,
  effectId,
  entry,
}: {
  type: ParameterType;
  effectId: string;
  entry: PanelParamEntry;
}): React.JSX.Element | null {
  // Only the on-canvas / non-scalar editors reach this panel (gradient,
  // easing curve, path). Numeric and spring params are edited in the family
  // slider panel; their armable rows here were never mounted, so they and the
  // dead cursor tool they depended on have been removed (P0-2).
  switch (type) {
    case "gradient":
      return <GradientRows effectId={effectId} entry={entry} />;
    case "path":
      return <PathRows effectId={effectId} entry={entry} />;
    case "easing-curve":
      return <EasingCurveRow effectId={effectId} entry={entry} />;
    default:
      return null;
  }
}

// ── Shared row scaffolding ────────────────────────────────────────────────

function RowLabel({
  text,
  effectId,
  paramKey,
  currentType,
  onEnterExactValue,
}: {
  text: string;
  effectId: string;
  paramKey: string;
  currentType: ParameterType;
  onEnterExactValue: () => void;
}): React.JSX.Element {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <span
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        title={text}
        style={{
          width: 84,
          flexShrink: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: FONT.sizeSmall,
          color: "rgba(255, 255, 255, 0.82)",
          fontFamily: FONT.family,
          cursor: "context-menu",
        }}
      >
        {text}
      </span>
      {menu !== null && (
        <SurfaceContextMenu
          x={menu.x}
          y={menu.y}
          currentType={currentType}
          effectId={effectId}
          paramKey={paramKey}
          onEnterExactValue={() => {
            setMenu(null);
            onEnterExactValue();
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}

const numberInputStyle: React.CSSProperties = {
  width: 52,
  flexShrink: 0,
  padding: "2px 4px",
  borderRadius: 4,
  border: "1px solid rgba(255, 255, 255, 0.14)",
  background: "rgba(255, 255, 255, 0.06)",
  color: COLORS.neutralInk,
  fontFamily: FONT.mono,
  fontSize: FONT.sizeSmall,
  outline: "none",
};

const rangeInputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 60,
  accentColor: COLORS.accent,
  cursor: "pointer",
  margin: 0,
};

interface GradientStop {
  stop: number;
  color: string;
}

function isGradientValue(v: unknown): v is GradientStop[] {
  return (
    Array.isArray(v) &&
    v.every(
      (s) =>
        typeof s === "object" &&
        s !== null &&
        typeof (s as GradientStop).stop === "number",
    )
  );
}

function GradientRows({
  effectId,
  entry,
}: {
  effectId: string;
  entry: PanelParamEntry;
}): React.JSX.Element | null {
  const session = useOverlaySession();
  if (!isGradientValue(entry.liveValue)) return null;
  const stops = entry.liveValue;
  const commit = (next: GradientStop[]): void => {
    session.manipulate(effectId, entry.paramKey, next);
  };
  const setStop = (index: number, patch: Partial<GradientStop>): void => {
    commit(stops.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <RowLabel
        text={entry.param.label ?? entry.paramKey}
        effectId={effectId}
        paramKey={entry.paramKey}
        currentType="gradient"
        onEnterExactValue={() => {}}
      />
      {stops.map((stop, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ColorSwatch
            color={stop.color}
            onChange={(hex) => setStop(i, { color: hex })}
            ariaLabel={`Stop ${String(i + 1)} color`}
          />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={stop.stop}
            onChange={(e) => setStop(i, { stop: Number(e.target.value) })}
            aria-label={`Stop ${String(i + 1)} position`}
            style={rangeInputStyle}
          />
          <button
            type="button"
            aria-label={`Remove stop ${String(i + 1)}`}
            disabled={stops.length <= 2}
            onClick={() => commit(stops.filter((_, j) => j !== i))}
            style={{
              width: 18,
              height: 18,
              flexShrink: 0,
              border: "none",
              borderRadius: 4,
              background: "transparent",
              color:
                stops.length <= 2
                  ? "rgba(255,255,255,0.2)"
                  : "rgba(255,255,255,0.6)",
              cursor: stops.length <= 2 ? "default" : "pointer",
              fontSize: 12,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          const last = stops[stops.length - 1];
          commit([...stops, { stop: 1, color: last?.color ?? "#ffffff" }]);
        }}
        style={{
          alignSelf: "flex-start",
          border: "1px solid rgba(255, 255, 255, 0.14)",
          borderRadius: 4,
          background: "transparent",
          color: "rgba(255, 255, 255, 0.7)",
          fontSize: FONT.sizeLabel,
          fontFamily: FONT.family,
          padding: "2px 8px",
          cursor: "pointer",
        }}
      >
        + add stop
      </button>
    </div>
  );
}

// ── Easing curve editor ───────────────────────────────────────────────────

interface EasingValue {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function isEasingValue(v: unknown): v is EasingValue {
  return (
    typeof v === "object" &&
    v !== null &&
    ["x1", "y1", "x2", "y2"].every(
      (k) => typeof (v as Record<string, unknown>)[k] === "number",
    )
  );
}

const EASING_PRESETS: { name: string; value: EasingValue }[] = [
  { name: "linear", value: { x1: 0, y1: 0, x2: 1, y2: 1 } },
  { name: "ease", value: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 } },
  { name: "in", value: { x1: 0.42, y1: 0, x2: 1, y2: 1 } },
  { name: "out", value: { x1: 0, y1: 0, x2: 0.58, y2: 1 } },
  { name: "in-out", value: { x1: 0.42, y1: 0, x2: 0.58, y2: 1 } },
  { name: "back", value: { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 } },
];

const CURVE_H = 120;
// y may overshoot [0,1] (back/anticipate curves); pad vertically so the
// handles remain reachable.
const CURVE_Y_MIN = -0.6;
const CURVE_Y_MAX = 1.6;

function curveToPx(
  x: number,
  y: number,
  w: number,
): { px: number; py: number } {
  return {
    px: x * w,
    py: CURVE_H - ((y - CURVE_Y_MIN) / (CURVE_Y_MAX - CURVE_Y_MIN)) * CURVE_H,
  };
}

function pxToCurve(
  px: number,
  py: number,
  w: number,
): { x: number; y: number } {
  const x = Math.min(1, Math.max(0, px / w));
  const y =
    CURVE_Y_MIN + ((CURVE_H - py) / CURVE_H) * (CURVE_Y_MAX - CURVE_Y_MIN);
  return {
    x: Math.round(x * 100) / 100,
    y: Math.round(Math.min(CURVE_Y_MAX, Math.max(CURVE_Y_MIN, y)) * 100) / 100,
  };
}

// Mini preset thumbnail geometry. Each tile normalizes its own y-range so
// standard curves use the full height (dramatic, readable character) while
// overshooting curves like "back" scale to include their excursion —
// every thumbnail shows its true personality, not a compressed middle band.
const TILE_W = 46;
const TILE_H = 30;
// Normalize by the CURVE's actual sampled extent — not the control points,
// whose y can sit far beyond where the curve ever reaches. This keeps
// overshoot humps (back) at true visual size instead of shrinking them
// into an ease lookalike.
function tileMapper(
  v: EasingValue,
): (x: number, y: number) => { px: number; py: number } {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const mt = 1 - t;
    const y = 3 * mt * mt * t * v.y1 + 3 * mt * t * t * v.y2 + t * t * t;
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  lo -= 0.07;
  hi += 0.07;
  return (x, y) => ({
    px: 3 + x * (TILE_W - 6),
    py: TILE_H - 2.5 - ((y - lo) / (hi - lo)) * (TILE_H - 5),
  });
}

function EasingCurveRow({
  effectId,
  entry,
}: {
  effectId: string;
  entry: PanelParamEntry;
}): React.JSX.Element | null {
  const session = useOverlaySession();
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Canvas width tracks the panel, so the graph always fills the bar.
  const [width, setWidth] = useState(280);
  // Ref so the drag closure always merges into the LATEST curve, not the one
  // captured at pointerdown. Declared before the early return (rules of hooks).
  const curveRef = useRef<EasingValue>({ x1: 0, y1: 0, x2: 1, y2: 1 });
  // Tears down an in-flight handle drag's window listeners if the editor
  // unmounts before pointerup (P2-10).
  const dragCleanupRef = useRef<() => void>(() => undefined);
  useEffect(() => () => dragCleanupRef.current(), []);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (el === null) return;
    const measure = (): void => {
      setWidth(Math.max(220, el.clientWidth));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  if (!isEasingValue(entry.liveValue)) return null;
  const curve = entry.liveValue;
  curveRef.current = curve;
  const commit = (next: EasingValue): void => {
    session.manipulate(effectId, entry.paramKey, next);
  };

  const start = curveToPx(0, 0, width);
  const end = curveToPx(1, 1, width);
  const p1 = curveToPx(curve.x1, curve.y1, width);
  const p2 = curveToPx(curve.x2, curve.y2, width);

  const dragHandle =
    (which: 1 | 2) => (event: React.PointerEvent<SVGCircleElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const svg = svgRef.current;
      if (svg === null) return;
      const move = (ev: PointerEvent): void => {
        const rect = svg.getBoundingClientRect();
        const { x, y } = pxToCurve(
          ev.clientX - rect.left,
          ev.clientY - rect.top,
          rect.width,
        );
        commit(
          which === 1
            ? { ...curveRef.current, x1: x, y1: y }
            : { ...curveRef.current, x2: x, y2: y },
        );
      };
      const up = (): void => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        dragCleanupRef.current = () => undefined;
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      dragCleanupRef.current = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
    };

  const matchesPreset = (preset: EasingValue): boolean =>
    Math.abs(curve.x1 - preset.x1) < 0.01 &&
    Math.abs(curve.y1 - preset.y1) < 0.01 &&
    Math.abs(curve.x2 - preset.x2) < 0.01 &&
    Math.abs(curve.y2 - preset.y2) < 0.01;

  return (
    <div
      ref={wrapRef}
      style={{ display: "flex", flexDirection: "column", gap: 6 }}
    >
      <svg
        ref={svgRef}
        width={width}
        height={CURVE_H}
        style={{
          background: "rgba(255, 255, 255, 0.04)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          borderRadius: 8,
          overflow: "visible",
          touchAction: "none",
        }}
      >
        {/* value 0 / value 1 gridlines */}
        <line
          x1={0}
          y1={curveToPx(0, 0, width).py}
          x2={width}
          y2={curveToPx(0, 0, width).py}
          stroke="rgba(255,255,255,0.14)"
          strokeDasharray="3 3"
        />
        <line
          x1={0}
          y1={curveToPx(0, 1, width).py}
          x2={width}
          y2={curveToPx(0, 1, width).py}
          stroke="rgba(255,255,255,0.14)"
          strokeDasharray="3 3"
        />
        {/* handle stems */}
        <line
          x1={start.px}
          y1={start.py}
          x2={p1.px}
          y2={p1.py}
          stroke="rgba(255,255,255,0.35)"
        />
        <line
          x1={end.px}
          y1={end.py}
          x2={p2.px}
          y2={p2.py}
          stroke="rgba(255,255,255,0.35)"
        />
        {/* the curve */}
        <path
          d={`M ${String(start.px)} ${String(start.py)} C ${String(p1.px)} ${String(p1.py)}, ${String(p2.px)} ${String(p2.py)}, ${String(end.px)} ${String(end.py)}`}
          fill="none"
          stroke={COLORS.accent}
          strokeWidth={1.8}
        />
        {/* draggable control points */}
        {[
          { p: p1, which: 1 as const },
          { p: p2, which: 2 as const },
        ].map(({ p, which }) => (
          <g key={which}>
            <circle
              cx={p.px}
              cy={p.py}
              r={12}
              fill="rgba(255,255,255,0.001)"
              style={{ cursor: "grab" }}
              onPointerDown={dragHandle(which)}
            />
            <circle
              cx={p.px}
              cy={p.py}
              r={4.5}
              fill={COLORS.accent}
              pointerEvents="none"
            />
          </g>
        ))}
      </svg>
      {/* Preset curves as mini-graph tiles: pick a curve by seeing it. The
          row never wraps — tiles flex to share whatever width the panel has
          (which shifts as timing verbs like play come and go), so they stay a
          single row from the narrowest panel to the widest. */}
      <div
        style={{ display: "flex", gap: 4, flexWrap: "nowrap", width: "100%" }}
      >
        {EASING_PRESETS.map((preset) => {
          const tp = tileMapper(preset.value);
          const t0 = tp(0, 0);
          const t3 = tp(1, 1);
          const t1 = tp(preset.value.x1, preset.value.y1);
          const t2 = tp(preset.value.x2, preset.value.y2);
          const active = matchesPreset(preset.value);
          return (
            <button
              key={preset.name}
              type="button"
              aria-pressed={active}
              onClick={() => commit(preset.value)}
              style={{
                flex: "1 1 0",
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 1,
                padding: "3px 2px 2px",
                border: `1px solid ${active ? "rgba(255, 255, 255, 0.5)" : GLASS.hairline}`,
                borderRadius: 6,
                background: active ? GLASS.fillActive : GLASS.fill,
                cursor: "pointer",
                transition: "background 120ms ease, border-color 120ms ease",
              }}
            >
              <svg
                width="100%"
                height={TILE_H}
                viewBox={`0 0 ${String(TILE_W)} ${String(TILE_H)}`}
                preserveAspectRatio="none"
                style={{ display: "block", maxWidth: "100%" }}
              >
                {/* end-level line: overshoot visibly crosses it */}
                <line
                  x1={2}
                  y1={tp(0, 1).py}
                  x2={TILE_W - 2}
                  y2={tp(0, 1).py}
                  stroke="rgba(255, 255, 255, 0.18)"
                  strokeDasharray="2 2.5"
                />
                <path
                  d={`M ${String(t0.px)} ${String(t0.py)} C ${String(t1.px)} ${String(t1.py)}, ${String(t2.px)} ${String(t2.py)}, ${String(t3.px)} ${String(t3.py)}`}
                  fill="none"
                  stroke={
                    active ? "rgb(255, 255, 255)" : "rgba(255, 255, 255, 0.68)"
                  }
                  strokeWidth={1.7}
                  strokeLinecap="round"
                />
              </svg>
              <span
                style={{
                  fontSize: 8,
                  fontFamily: FONT.family,
                  color: active
                    ? "rgba(255, 255, 255, 0.95)"
                    : "rgba(255, 255, 255, 0.55)",
                  letterSpacing: 0.03,
                  maxWidth: "100%",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {preset.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface PathPoint {
  x: number;
  y: number;
}

function isPathValue(v: unknown): v is PathPoint[] {
  return (
    Array.isArray(v) &&
    v.every(
      (p) =>
        typeof p === "object" &&
        p !== null &&
        typeof (p as PathPoint).x === "number" &&
        typeof (p as PathPoint).y === "number",
    )
  );
}

function PathRows({
  effectId,
  entry,
}: {
  effectId: string;
  entry: PanelParamEntry;
}): React.JSX.Element | null {
  const session = useOverlaySession();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  if (!isPathValue(entry.liveValue)) return null;
  const points = entry.liveValue;
  // Route through translateAnchor so a numeric nudge carries the anchor's
  // bezier handles with it, exactly like dragging the anchor on the canvas.
  const setPoint = (index: number, patch: Partial<PathPoint>): void => {
    const cur = points[index];
    if (cur === undefined) return;
    const dx = (patch.x ?? cur.x) - cur.x;
    const dy = (patch.y ?? cur.y) - cur.y;
    session.manipulate(
      effectId,
      entry.paramKey,
      translateAnchor(points, index, dx, dy),
    );
  };
  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      style={{ display: "flex", flexDirection: "column", gap: 6 }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "6px 12px",
        }}
      >
        {points.map((point, i) => (
          <div
            key={i}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <span
              style={{
                width: 20,
                flexShrink: 0,
                fontSize: FONT.sizeLabel,
                color: "rgba(255, 255, 255, 0.5)",
                fontFamily: FONT.mono,
              }}
            >
              P{i + 1}
            </span>
            <PathAxisInput
              label={`P${String(i + 1)} x`}
              value={point.x}
              onChange={(x) => setPoint(i, { x })}
            />
            <PathAxisInput
              label={`P${String(i + 1)} y`}
              value={point.y}
              onChange={(y) => setPoint(i, { y })}
            />
          </div>
        ))}
      </div>
      {menu !== null && (
        <SurfaceContextMenu
          x={menu.x}
          y={menu.y}
          currentType="path"
          effectId={effectId}
          paramKey={entry.paramKey}
          onEnterExactValue={() => setMenu(null)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function PathAxisInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string): void => {
    const n = Number(raw);
    if (Number.isFinite(n)) onChange(n);
    setDraft(null);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      value={draft ?? String(Math.round(value))}
      onFocus={(e) => {
        setDraft(String(value));
        e.target.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
        if (e.key === "Escape") setDraft(null);
      }}
      style={{
        ...numberInputStyle,
        width: "100%",
        minWidth: 0,
        flex: 1,
        borderRadius: 6,
        background: GLASS.fill,
        border: `1px solid ${GLASS.hairline}`,
      }}
    />
  );
}
