import { useCallback, useMemo, useRef, useState } from "react";

import { getBridge } from "../../bridge.js";
import { useOverlaySession } from "../context.js";
import { COLORS, FONT, PANEL, STAGGER_SURFACE, STROKE } from "../theme.js";
import { NumericEditor, SurfaceContextMenu } from "./shared/context-menu.js";
import { useNodeRect } from "./shared/hooks.js";
import type { SurfaceProps } from "./shared/props.js";

// When the designer drags the gap between two adjacent ghosts, scale the
// delays of every subsequent ghost by the ratio of new/old gap.
export function scaleSubsequentDelays(
  delays: number[],
  gapIndex: number,
  newGap: number,
): number[] {
  if (gapIndex < 0 || gapIndex >= delays.length - 1) return delays;
  const currentGap = delays[gapIndex + 1]! - delays[gapIndex]!;
  if (currentGap === 0) return delays;
  const ratio = newGap / currentGap;
  const result = [...delays];
  const anchor = result[gapIndex]!;
  for (let i = gapIndex + 1; i < result.length; i++) {
    const offset = result[i]! - anchor;
    result[i] = anchor + offset * ratio;
  }
  // Enforce monotonic ordering.
  for (let i = 1; i < result.length; i++) {
    if (result[i]! < result[i - 1]!) result[i] = result[i - 1]!;
  }
  return result;
}

interface Props extends SurfaceProps<number> {
  effectName: string;
}

// Groups every registered effect with the same `name` and treats their
// stored `stagger` param values as a sequence of delays. This makes the
// stagger surface a cross-element interaction — dragging updates each
// participating registration.
export function StaggerSurface({
  effectId,
  paramKey,
  param,
  liveValue,
  node,
  effectName,
}: Props): React.JSX.Element | null {
  const session = useOverlaySession();
  const rect = useNodeRect(node);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const rectRef = useRef(rect);
  rectRef.current = rect;

  // All effects sharing this name, ordered so that our current effect is
  // rendered as one of the ghosts (index looked up below).
  const group = useMemo(() => {
    const effects = session.state
      .getAllEffects()
      .filter((e) => e.name === effectName)
      .map((e) => {
        const staggerParam = e.params[paramKey];
        const diff = session.diffs.getDiff(e.id)[paramKey];
        const delay =
          diff !== undefined && typeof diff.to === "number"
            ? diff.to
            : typeof staggerParam?.value === "number"
              ? staggerParam.value
              : 0;
        return { id: e.id, delay, node: getBridge().getNode(e.id) ?? null };
      })
      .sort((a, b) => a.delay - b.delay);
    return effects;
  }, [effectName, paramKey, session, liveValue]);

  const commitDelays = useCallback(
    (nextDelays: number[]): void => {
      group.forEach((entry, i) => {
        const value = nextDelays[i];
        if (value !== undefined) {
          session.manipulate(
            entry.id,
            paramKey,
            Math.max(STAGGER_SURFACE.minDelayMs, Math.round(value)),
          );
        }
      });
    },
    [group, paramKey, session],
  );

  const startGhostDrag = useCallback(
    (index: number) => (event: React.PointerEvent<SVGRectElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      const startX = event.clientX;
      const initialDelays = group.map((g) => g.delay);
      const startDelay = initialDelays[index] ?? 0;
      const move = (ev: PointerEvent): void => {
        const dx = ev.clientX - startX;
        const dDelay = dx / STAGGER_SURFACE.pxPerMs;
        const nextDelays = [...initialDelays];
        nextDelays[index] = Math.max(
          STAGGER_SURFACE.minDelayMs,
          startDelay + dDelay,
        );
        commitDelays(nextDelays);
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
    [commitDelays, group],
  );

  const startGapDrag = useCallback(
    (gapIndex: number) => (event: React.PointerEvent<SVGRectElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      const initialDelays = group.map((g) => g.delay);
      const currentGap =
        initialDelays[gapIndex + 1]! - initialDelays[gapIndex]!;
      const startX = event.clientX;
      const move = (ev: PointerEvent): void => {
        const dx = ev.clientX - startX;
        const newGap = Math.max(1, currentGap + dx / STAGGER_SURFACE.pxPerMs);
        const scaled = scaleSubsequentDelays(initialDelays, gapIndex, newGap);
        commitDelays(scaled);
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
    [commitDelays, group],
  );

  const submitEdit = useCallback(
    (raw: string) => {
      const n = Number(raw);
      if (Number.isFinite(n)) {
        session.manipulate(
          effectId,
          paramKey,
          Math.max(STAGGER_SURFACE.minDelayMs, Math.round(n)),
        );
      }
      setEditing(false);
    },
    [effectId, paramKey, session],
  );

  if (rect === null || group.length === 0) return null;

  // Anchor the timeline below the currently-selected element.
  const timelineY = rect.bottom + STAGGER_SURFACE.timelineMarginTop;
  const timelineLeft = rect.left;
  const totalDuration = Math.max(...group.map((g) => g.delay)) + 200;
  const timelineWidth = Math.max(
    rect.width,
    totalDuration * STAGGER_SURFACE.pxPerMs,
  );

  return (
    <>
      <line
        x1={timelineLeft}
        y1={timelineY + STAGGER_SURFACE.timelineHeight / 2}
        x2={timelineLeft + timelineWidth}
        y2={timelineY + STAGGER_SURFACE.timelineHeight / 2}
        stroke={COLORS.panelBorder}
        strokeWidth={STROKE.secondary}
        pointerEvents="none"
      />
      {group.map((entry, i) => {
        const x = timelineLeft + entry.delay * STAGGER_SURFACE.pxPerMs;
        const y =
          timelineY +
          (STAGGER_SURFACE.timelineHeight - STAGGER_SURFACE.ghostHeight) / 2;
        const isSelf = entry.id === effectId;
        return (
          <g key={entry.id}>
            <rect
              x={x - STAGGER_SURFACE.ghostWidth / 2}
              y={y}
              width={STAGGER_SURFACE.ghostWidth}
              height={STAGGER_SURFACE.ghostHeight}
              rx={6}
              fill={isSelf ? COLORS.accentFaint : COLORS.panelHairline}
              stroke={isSelf ? COLORS.accent : COLORS.panelBorder}
              strokeWidth={STROKE.secondary}
              pointerEvents="all"
              style={{ cursor: "ew-resize" }}
              onPointerDown={startGhostDrag(i)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenu({ x: e.clientX, y: e.clientY });
              }}
            />
            <text
              x={x}
              y={y + STAGGER_SURFACE.ghostHeight / 2 + 5}
              fill={COLORS.neutralInk}
              fontFamily={FONT.mono}
              fontSize={FONT.sizeSmall}
              textAnchor="middle"
              pointerEvents="none"
            >
              {String(i + 1)}
            </text>
            <text
              x={x}
              y={y + STAGGER_SURFACE.ghostHeight + 14}
              fill={COLORS.neutralInkMuted}
              fontFamily={FONT.mono}
              fontSize={FONT.sizeLabel}
              textAnchor="middle"
              pointerEvents="none"
            >
              {String(Math.round(entry.delay))}ms
            </text>
          </g>
        );
      })}
      {group.slice(0, -1).map((entry, i) => {
        const next = group[i + 1]!;
        const gapMid =
          timelineLeft +
          ((entry.delay + next.delay) / 2) * STAGGER_SURFACE.pxPerMs;
        const y = timelineY + STAGGER_SURFACE.timelineHeight / 2;
        return (
          <rect
            key={`gap-${String(i)}`}
            x={gapMid - 4}
            y={y - 12}
            width={8}
            height={24}
            fill="rgba(232, 121, 249, 0.001)"
            pointerEvents="all"
            style={{ cursor: "ew-resize" }}
            onPointerDown={startGapDrag(i)}
          />
        );
      })}
      {editing && (
        <foreignObject
          x={rect.left + rect.width + 12}
          y={rect.top}
          width={160}
          height={30}
          style={{ overflow: "visible" }}
        >
          <NumericEditor
            initial={liveValue}
            step={1}
            onSubmit={submitEdit}
            onCancel={() => setEditing(false)}
          />
        </foreignObject>
      )}
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
            onEnterExactValue={() => {
              setMenu(null);
              setEditing(true);
            }}
            onClose={() => setMenu(null)}
          />
        </foreignObject>
      )}
      <foreignObject
        x={timelineLeft}
        y={timelineY + STAGGER_SURFACE.timelineHeight + 20}
        width={timelineWidth + 100}
        height={20}
        style={{ overflow: "visible", pointerEvents: "none" }}
      >
        <div
          style={{
            fontFamily: FONT.family,
            fontSize: FONT.sizeSmall,
            color: COLORS.neutralInkMuted,
            padding: "2px 6px",
            background: COLORS.panelBg,
            border: `1px solid ${COLORS.panelBorder}`,
            borderRadius: PANEL.radius,
            display: "inline-block",
          }}
        >
          {String(group.length)} elements · drag a ghost to shift · drag a gap
          to scale
        </div>
      </foreignObject>
    </>
  );
}
