import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  cssValuesEqual,
  encodeCssValue,
  type PathPoint,
} from "../../../shared/index.js";

import { useOverlaySession } from "../context.js";
import { COLORS, FONT, HANDLES, KNOB, PATH_SURFACE, STROKE } from "../theme.js";
import { SurfaceContextMenu } from "./shared/context-menu.js";
import { useCanvasDrawer, useRestingNodeRect } from "./shared/hooks.js";
import type { SurfaceProps } from "./shared/props.js";
import { HoverChip } from "../toolbox.js";

const MIN_ANCHORS = 2;

interface Pt {
  x: number;
  y: number;
}

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface StopHover {
  kind: "add" | "remove";
  x: number;
  y: number;
}

function parseCssColor(value: string): Rgba | null {
  const match = value.match(
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i,
  );
  if (match === null) return null;
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] === undefined ? 1 : Number(match[4]),
  };
}

function compositedBackground(node: Element): Rgba {
  let background: Rgba = { r: 255, g: 255, b: 255, a: 1 };
  const layers: Rgba[] = [];
  for (
    let current: Element | null = node;
    current !== null;
    current = current.parentElement
  ) {
    const color = parseCssColor(
      window.getComputedStyle(current).backgroundColor,
    );
    if (color !== null && color.a > 0) layers.push(color);
  }
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]!;
    background = {
      r: layer.r * layer.a + background.r * (1 - layer.a),
      g: layer.g * layer.a + background.g * (1 - layer.a),
      b: layer.b * layer.a + background.b * (1 - layer.a),
      a: 1,
    };
  }
  return background;
}

function relativeLuminance(background: Rgba): number {
  const linear = (channel: number): number => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * linear(background.r) +
    0.7152 * linear(background.g) +
    0.0722 * linear(background.b)
  );
}

// Resolve translucent element backgrounds through their ancestors, then use
// the foreground with the stronger WCAG contrast. Images and gradients fall
// back to the page's composited background colour.
export function pathContrastColor(node: Element): "#000000" | "#ffffff" {
  const luminance = relativeLuminance(compositedBackground(node));
  return luminance > 0.179 ? "#000000" : "#ffffff";
}

// Element-relative → screen. `rect` is the element's viewport rect.
export function toScreen(pt: Pt, rect: DOMRect): Pt {
  return { x: rect.left + pt.x, y: rect.top + pt.y };
}

export function fromScreen(screen: Pt, rect: DOMRect): Pt {
  return { x: screen.x - rect.left, y: screen.y - rect.top };
}

// CSS offset-path coordinates are resolved against the moving element's
// containing block, which is often a stationary wrapper registered with
// MotionWorks. Resolve that host automatically so the canvas guide and the
// browser's actual path share an origin. Custom JS-driven paths have no CSS
// consumer and intentionally fall back to the registered element.
export function pathCoordinateNode(
  node: HTMLElement,
  path: PathPoint[],
): HTMLElement {
  const expected = encodeCssValue("path", path, "");
  const candidates = [
    node,
    ...Array.from(node.querySelectorAll<HTMLElement>("*")),
  ];
  for (const candidate of candidates) {
    const cssPath = getComputedStyle(candidate).getPropertyValue("offset-path");
    if (!cssValuesEqual("path", cssPath, expected)) continue;
    if (candidate.offsetParent instanceof HTMLElement)
      return candidate.offsetParent;
  }
  return node;
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// The segment ENDING at path[i] curves when its end point carries control
// points. Missing controls degenerate onto the segment's endpoints — the
// same fallback the canvas renderer uses — so a half-defined segment still
// evaluates as a valid cubic.
export function segmentControls(
  start: PathPoint,
  end: PathPoint,
): { c1: Pt; c2: Pt } | null {
  if (end.cp1 === undefined && end.cp2 === undefined) return null;
  return {
    c1: end.cp1 ?? { x: start.x, y: start.y },
    c2: end.cp2 ?? { x: end.x, y: end.y },
  };
}

export function bezierPoint(p0: Pt, c1: Pt, c2: Pt, p1: Pt, t: number): Pt {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * c1.x + c * c2.x + d * p1.x,
    y: a * p0.y + b * c1.y + c * c2.y + d * p1.y,
  };
}

export interface PathHit {
  // Index of the segment's END point in the path array (segment runs from
  // segEnd - 1 to segEnd).
  segEnd: number;
  t: number;
  point: Pt;
  dist: number;
}

// Closest position on the path to `local` (element-relative coords).
// Straight segments project exactly; curved segments sample the cubic.
export function closestOnPath(path: PathPoint[], local: Pt): PathHit {
  let best: PathHit = {
    segEnd: 1,
    t: 0,
    point: { x: path[0]!.x, y: path[0]!.y },
    dist: Infinity,
  };
  for (let i = 1; i < path.length; i++) {
    const start = path[i - 1]!;
    const end = path[i]!;
    const controls = segmentControls(start, end);
    if (controls === null) {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const len2 = dx * dx + dy * dy;
      const t =
        len2 === 0
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                ((local.x - start.x) * dx + (local.y - start.y) * dy) / len2,
              ),
            );
      const point = lerp(start, end, t);
      const dist = Math.hypot(local.x - point.x, local.y - point.y);
      if (dist < best.dist) best = { segEnd: i, t, point, dist };
      continue;
    }
    const samples = PATH_SURFACE.samplesPerSegment;
    for (let j = 0; j <= samples; j++) {
      const t = j / samples;
      const point = bezierPoint(start, controls.c1, controls.c2, end, t);
      const dist = Math.hypot(local.x - point.x, local.y - point.y);
      if (dist < best.dist) best = { segEnd: i, t, point, dist };
    }
  }
  return best;
}

// Insert a new anchor at the closest point on the path to `screenPt`.
// Straight segments get a plain point at the projected position; curved
// segments are split with de Casteljau so the curve's shape is preserved
// exactly — the new anchor and its neighbours all receive the subdivided
// control points.
export function insertAnchorAt(
  path: PathPoint[],
  screenPt: Pt,
  rect: DOMRect,
): PathPoint[] {
  const local = fromScreen(screenPt, rect);
  if (path.length < 2) return [...path, local];
  const hit = closestOnPath(path, local);
  const start = path[hit.segEnd - 1]!;
  const end = path[hit.segEnd]!;
  const controls = segmentControls(start, end);
  const next = [...path];
  if (controls === null) {
    next.splice(hit.segEnd, 0, { x: hit.point.x, y: hit.point.y });
    return next;
  }
  const t = hit.t;
  const q1 = lerp(start, controls.c1, t);
  const q2 = lerp(controls.c1, controls.c2, t);
  const q3 = lerp(controls.c2, end, t);
  const r1 = lerp(q1, q2, t);
  const r2 = lerp(q2, q3, t);
  const s = lerp(r1, r2, t);
  next[hit.segEnd] = { ...end, cp1: r2, cp2: q3 };
  next.splice(hit.segEnd, 0, { x: s.x, y: s.y, cp1: q1, cp2: r1 });
  return next;
}

// Remove an anchor, merging its two segments. The merged segment keeps the
// removed point's arrival control and the follower's own approach control —
// a close approximation of the joined curve without refitting.
export function removeAnchorAt(path: PathPoint[], index: number): PathPoint[] {
  if (path.length <= MIN_ANCHORS) return path;
  const next = path.filter((_, i) => i !== index);
  if (index === 0) {
    // The new first point has no incoming segment; orphaned controls would
    // silently re-curve the next segment if the anchor is ever re-added.
    const first = next[0]!;
    next[0] = { x: first.x, y: first.y };
  } else if (index < path.length - 1) {
    const removed = path[index]!;
    const follower = next[index]!;
    const merged: PathPoint = { x: follower.x, y: follower.y };
    if (removed.cp1 !== undefined) merged.cp1 = removed.cp1;
    if (follower.cp2 !== undefined) merged.cp2 = follower.cp2;
    next[index] = merged;
  }
  return next;
}

// Move an anchor, carrying its attached bezier handles along: the anchor's
// own approach control (cp2 of the same point) and the next segment's
// departure control (cp1 of the following point).
export function translateAnchor(
  path: PathPoint[],
  index: number,
  dx: number,
  dy: number,
): PathPoint[] {
  return path.map((pt, i) => {
    if (i === index) {
      const moved: PathPoint = { ...pt, x: pt.x + dx, y: pt.y + dy };
      if (pt.cp2 !== undefined)
        moved.cp2 = { x: pt.cp2.x + dx, y: pt.cp2.y + dy };
      return moved;
    }
    if (i === index + 1 && pt.cp1 !== undefined) {
      return { ...pt, cp1: { x: pt.cp1.x + dx, y: pt.cp1.y + dy } };
    }
    return pt;
  });
}

// Give a straight segment editable curvature: seed both control points on
// the segment at 1/3 and 2/3 so the curve starts out identical to the line
// and the designer pulls the shape from there.
export function materializeHandles(
  path: PathPoint[],
  segEnd: number,
): PathPoint[] {
  const start = path[segEnd - 1];
  const end = path[segEnd];
  if (start === undefined || end === undefined) return path;
  return path.map((pt, i) =>
    i === segEnd
      ? { ...pt, cp1: lerp(start, end, 1 / 3), cp2: lerp(start, end, 2 / 3) }
      : pt,
  );
}

interface Props extends SurfaceProps<PathPoint[]> {}

export function PathSurface({
  effectId,
  paramKey,
  param,
  liveValue,
  node,
}: Props): React.JSX.Element | null {
  const session = useOverlaySession();
  const coordinateNode = useMemo(
    () => pathCoordinateNode(node, liveValue),
    [node, liveValue],
  );
  const rect = useRestingNodeRect(coordinateNode);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [stopHover, setStopHover] = useState<StopHover | null>(null);
  const rectRef = useRef(rect);
  rectRef.current = rect;
  const liveRef = useRef(liveValue);
  liveRef.current = liveValue;
  const draggingAnchorRef = useRef(false);

  const path = liveValue;
  const [contrastColor, setContrastColor] = useState<"#000000" | "#ffffff">(
    () => pathContrastColor(node),
  );
  const knobFillId = useId();
  const knobShadowId = useId();
  const knobMaterial =
    contrastColor === "#ffffff"
      ? KNOB
      : {
          fillTop: KNOB.inverse.fillTop,
          fillBottom: KNOB.inverse.fillBottom,
          shadow: KNOB.inverse.shadow,
        };

  useEffect(() => {
    let raf = 0;
    let lastSample = 0;
    const sample = (time: number): void => {
      // Re-read the editing container at 10fps so class/theme changes are
      // reflected without tying contrast to the elements beneath anchors.
      if (time - lastSample >= 100) {
        lastSample = time;
        const next = pathContrastColor(node);
        setContrastColor((current) => (current === next ? current : next));
      }
      raf = requestAnimationFrame(sample);
    };
    raf = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(raf);
  }, [node]);

  const commit = useCallback(
    (next: PathPoint[]): void => {
      session.manipulate(effectId, paramKey, next);
    },
    [effectId, paramKey, session],
  );

  const draw = useMemo(() => {
    return (ctx: CanvasRenderingContext2D): void => {
      const r = rectRef.current;
      const p = liveRef.current;
      if (r === null || p.length < 2) return;
      ctx.save();
      ctx.beginPath();
      const first = toScreen(p[0]!, r);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < p.length; i++) {
        const cur = p[i]!;
        const scr = toScreen(cur, r);
        const controls = segmentControls(p[i - 1]!, cur);
        if (controls !== null) {
          const c1 = toScreen(controls.c1, r);
          const c2 = toScreen(controls.c2, r);
          ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, scr.x, scr.y);
        } else {
          ctx.lineTo(scr.x, scr.y);
        }
      }
      ctx.strokeStyle = contrastColor;
      ctx.lineWidth = PATH_SURFACE.strokeWidth;
      ctx.stroke();
      ctx.restore();
    };
  }, [contrastColor]);
  useCanvasDrawer(draw);

  const startAnchorDrag = useCallback(
    (index: number) => (event: React.PointerEvent<SVGCircleElement>) => {
      event.preventDefault();
      event.stopPropagation();
      draggingAnchorRef.current = true;
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      // The drag mutates a working copy rather than re-reading liveRef on
      // every move — commits round-trip through the diff store and a React
      // render, so liveRef can lag a pointermove behind.
      let working = liveRef.current;
      const move = (ev: PointerEvent): void => {
        const r = rectRef.current;
        if (r === null) return;
        const local = fromScreen({ x: ev.clientX, y: ev.clientY }, r);
        const cur = working[index];
        if (cur === undefined) return;
        working = translateAnchor(
          working,
          index,
          local.x - cur.x,
          local.y - cur.y,
        );
        commit(working);
      };
      const up = (): void => {
        draggingAnchorRef.current = false;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        try {
          target.releasePointerCapture(event.pointerId);
        } catch {
          // pointer already released
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [commit],
  );

  // Drags a bezier control point. `initial` (when set) is committed first —
  // the stub-drag path materializes handles on a straight segment and then
  // keeps dragging the grabbed one in the same gesture.
  const startHandleDrag = useCallback(
    (index: number, which: "cp1" | "cp2", initial?: PathPoint[]) =>
      (event: React.PointerEvent<SVGCircleElement>) => {
        event.preventDefault();
        event.stopPropagation();
        const target = event.currentTarget;
        target.setPointerCapture(event.pointerId);
        let working = initial ?? liveRef.current;
        if (initial !== undefined) commit(initial);
        const move = (ev: PointerEvent): void => {
          const r = rectRef.current;
          if (r === null) return;
          const local = fromScreen({ x: ev.clientX, y: ev.clientY }, r);
          working = working.map((pt, i) =>
            i === index ? { ...pt, [which]: local } : pt,
          );
          commit(working);
        };
        const up = (): void => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          try {
            target.releasePointerCapture(event.pointerId);
          } catch {
            // pointer already released
          }
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      },
    [commit],
  );

  const onPathClick = useCallback(
    (event: React.MouseEvent<SVGRectElement>) => {
      const r = rectRef.current;
      if (r === null) return;
      const local = fromScreen({ x: event.clientX, y: event.clientY }, r);
      if (
        closestOnPath(liveRef.current, local).dist > PATH_SURFACE.trackHoverPx
      )
        return;
      commit(
        insertAnchorAt(
          liveRef.current,
          { x: event.clientX, y: event.clientY },
          r,
        ),
      );
    },
    [commit],
  );

  const onPathHover = useCallback(
    (event: React.PointerEvent<SVGRectElement>) => {
      const r = rectRef.current;
      if (r === null) return;
      const local = fromScreen({ x: event.clientX, y: event.clientY }, r);
      const overTrack =
        closestOnPath(liveRef.current, local).dist <= PATH_SURFACE.trackHoverPx;
      setStopHover(
        overTrack ? { kind: "add", x: event.clientX, y: event.clientY } : null,
      );
    },
    [],
  );

  const removeAnchor = useCallback(
    (index: number) => {
      commit(removeAnchorAt(liveRef.current, index));
    },
    [commit],
  );

  if (rect === null) return null;

  // The add-anchor click target hugs the curve's actual extent (anchors and
  // control points included) — paths routinely run far outside the element's
  // own box.
  const pad = PATH_SURFACE.clickPad;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pt of path) {
    for (const p of [pt, pt.cp1, pt.cp2]) {
      if (p === undefined) continue;
      const s = toScreen(p, rect);
      minX = Math.min(minX, s.x);
      minY = Math.min(minY, s.y);
      maxX = Math.max(maxX, s.x);
      maxY = Math.max(maxY, s.y);
    }
  }

  return (
    <>
      <defs>
        <linearGradient id={knobFillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.45" stopColor={knobMaterial.fillTop} />
          <stop offset="1" stopColor={knobMaterial.fillBottom} />
        </linearGradient>
        <filter id={knobShadowId} x="-80%" y="-80%" width="260%" height="260%">
          <feDropShadow
            dx={knobMaterial.shadow.dx}
            dy={knobMaterial.shadow.dy}
            stdDeviation={knobMaterial.shadow.blur}
            floodColor={knobMaterial.shadow.color}
          />
        </filter>
      </defs>
      {path.length >= 2 && (
        <rect
          x={minX - pad}
          y={minY - pad}
          width={maxX - minX + pad * 2}
          height={maxY - minY + pad * 2}
          fill="rgba(94, 234, 212, 0.001)"
          stroke="none"
          pointerEvents="all"
          style={{ cursor: "crosshair" }}
          onClick={onPathClick}
          onPointerMove={onPathHover}
          onPointerLeave={() => setStopHover(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMenu({ x: e.clientX, y: e.clientY });
          }}
        />
      )}
      {/* Segment controls: stems + handles on curved segments, faint
          pull-stubs on straight ones. Rendered before the anchors so anchor
          hit areas win where they overlap. */}
      {path.map((pt, i) => {
        if (i === 0) return null;
        const start = path[i - 1]!;
        const controls = segmentControls(start, pt);
        if (controls === null) {
          return (
            <g key={`seg-${i}`}>
              {[
                { which: "cp1" as const, at: lerp(start, pt, 1 / 3) },
                { which: "cp2" as const, at: lerp(start, pt, 2 / 3) },
              ].map(({ which, at }) => {
                const s = toScreen(at, rect);
                return (
                  <g key={which}>
                    <circle
                      cx={s.x}
                      cy={s.y}
                      r={HANDLES.hitRadius}
                      fill="rgba(94, 234, 212, 0.001)"
                      stroke="none"
                      pointerEvents="all"
                      style={{ cursor: "grab" }}
                      onPointerEnter={() => setStopHover(null)}
                      onPointerDown={startHandleDrag(
                        i,
                        which,
                        materializeHandles(path, i),
                      )}
                    />
                    <circle
                      cx={s.x}
                      cy={s.y}
                      r={HANDLES.bezierRadius}
                      fill={`url(#${knobFillId})`}
                      stroke="none"
                      filter={`url(#${knobShadowId})`}
                      pointerEvents="none"
                    />
                  </g>
                );
              })}
            </g>
          );
        }
        const anchor1 = toScreen(start, rect);
        const anchor2 = toScreen(pt, rect);
        const c1 = toScreen(controls.c1, rect);
        const c2 = toScreen(controls.c2, rect);
        return (
          <g key={`seg-${i}`}>
            {[
              { which: "cp1" as const, from: anchor1, at: c1 },
              { which: "cp2" as const, from: anchor2, at: c2 },
            ].map(({ which, from, at }) => (
              <g key={which}>
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={at.x}
                  y2={at.y}
                  stroke={contrastColor}
                  strokeWidth={STROKE.secondary}
                  strokeDasharray={PATH_SURFACE.handleLineDash}
                  opacity={PATH_SURFACE.handleLineOpacity}
                  pointerEvents="none"
                />
                <circle
                  cx={at.x}
                  cy={at.y}
                  r={HANDLES.hitRadius}
                  fill="rgba(94, 234, 212, 0.001)"
                  stroke="none"
                  pointerEvents="all"
                  style={{ cursor: "grab" }}
                  onPointerEnter={() => setStopHover(null)}
                  onPointerDown={startHandleDrag(i, which)}
                />
                <circle
                  cx={at.x}
                  cy={at.y}
                  r={HANDLES.bezierRadius}
                  fill={`url(#${knobFillId})`}
                  stroke="none"
                  filter={`url(#${knobShadowId})`}
                  pointerEvents="none"
                />
              </g>
            ))}
          </g>
        );
      })}
      {path.map((pt, i) => {
        const s = toScreen(pt, rect);
        return (
          <g key={i}>
            <circle
              cx={s.x}
              cy={s.y}
              r={HANDLES.hitRadius}
              fill="rgba(94, 234, 212, 0.001)"
              stroke="none"
              pointerEvents="all"
              style={{ cursor: "grab" }}
              onPointerEnter={(e) => {
                if (path.length > MIN_ANCHORS) {
                  setStopHover({ kind: "remove", x: e.clientX, y: e.clientY });
                }
              }}
              onPointerMove={(e) => {
                if (!draggingAnchorRef.current && path.length > MIN_ANCHORS) {
                  setStopHover({ kind: "remove", x: e.clientX, y: e.clientY });
                }
              }}
              onPointerLeave={() => setStopHover(null)}
              onPointerDown={(e) => {
                setStopHover(null);
                startAnchorDrag(i)(e);
              }}
              onDoubleClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                removeAnchor(i);
              }}
            />
            <circle
              cx={s.x}
              cy={s.y}
              r={HANDLES.anchorRadius}
              fill={`url(#${knobFillId})`}
              stroke="none"
              filter={`url(#${knobShadowId})`}
              pointerEvents="none"
            />
          </g>
        );
      })}
      {stopHover !== null ? (
        <text
          x={stopHover.x}
          y={stopHover.y}
          fill={contrastColor}
          fontFamily={FONT.family}
          fontSize={18}
          fontWeight={600}
          textAnchor="middle"
          dominantBaseline="central"
          pointerEvents="none"
        >
          {stopHover.kind === "add" ? "+" : "−"}
        </text>
      ) : null}
      {stopHover !== null
        ? createPortal(
            <HoverChip
              label={stopHover.kind === "add" ? "Add stop" : "Remove stop"}
              hint={stopHover.kind === "add" ? "Click" : "Double-click"}
              x={stopHover.x}
              y={stopHover.y}
            />,
            document.body,
          )
        : null}
      <foreignObject
        x={rect.left}
        y={rect.bottom + 24}
        width={rect.width + 320}
        height={28}
        style={{ overflow: "visible", pointerEvents: "none" }}
      >
        <div
          style={{
            fontFamily: FONT.family,
            fontSize: FONT.sizeSmall,
            color: COLORS.neutralInkMuted,
          }}
        >
          Drag anchors · pull ○ to bend · click curve to add · double-click
          anchor to remove
        </div>
      </foreignObject>
      {menu !== null && (
        <foreignObject
          x={0}
          y={0}
          width={window.innerWidth}
          height={window.innerHeight}
          style={{ overflow: "visible", pointerEvents: "none" }}
        >
          <SurfaceContextMenu
            x={menu.x}
            y={menu.y}
            currentType={param.type}
            effectId={effectId}
            paramKey={paramKey}
            onEnterExactValue={() => setMenu(null)}
            onClose={() => setMenu(null)}
          />
        </foreignObject>
      )}
    </>
  );
}
