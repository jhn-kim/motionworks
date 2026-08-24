import { useEffect, useState } from "react";

import { COLORS, FONT, HIGHLIGHT } from "./theme.js";

interface Props {
  node: HTMLElement | null;
  color: string;
  label?: string;
  // Optional overrides merged onto the outer (fixed-positioned) box — used by
  // the activation reveal to drive its staggered opacity/scale entrance.
  // Applied to the fixed element itself so scale transforms don't create a
  // containing block that would displace the box. Defaults leave hover and
  // selection highlights unchanged.
  style?: React.CSSProperties;
}

// Absolutely-positioned bordered div that tracks a node's bounding rect
// each animation frame. Never blocks pointer events. Optional label renders
// as a small chip above the outline (or top-inside if the element is near
// the top of the viewport).
export function NodeHighlight({
  node,
  color,
  label,
  style,
}: Props): React.JSX.Element | null {
  const [rect, setRect] = useState<DOMRect | null>(() =>
    node !== null ? node.getBoundingClientRect() : null,
  );

  useEffect(() => {
    if (node === null) {
      setRect(null);
      return;
    }
    let cancelled = false;
    let raf = 0;
    const tick = (): void => {
      if (cancelled) return;
      const next = node.getBoundingClientRect();
      // Only commit when the rect actually moved. Returning the same reference
      // makes React bail out, so a still element no longer forces a re-render
      // (and a downstream overlay repaint) on every single frame (P1-5).
      setRect((prev) =>
        prev !== null &&
        prev.left === next.left &&
        prev.top === next.top &&
        prev.width === next.width &&
        prev.height === next.height
          ? prev
          : next,
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [node]);

  if (rect === null) return null;
  const labelFitsAbove = rect.top - HIGHLIGHT.offset > 28;
  return (
    <div
      style={{
        position: "fixed",
        left: rect.left - HIGHLIGHT.offset,
        top: rect.top - HIGHLIGHT.offset,
        width: rect.width + HIGHLIGHT.offset * 2,
        height: rect.height + HIGHLIGHT.offset * 2,
        pointerEvents: "none",
        boxSizing: "border-box",
        transition: "none",
        // Sit above the canvas/svg drawing layers (9997/9998) so hover and
        // selection chips are never buried by the overlay; still below the
        // picker/context-menu modals (10000+). Overridable via `style`.
        zIndex: 9999,
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          border: `1.5px solid ${color}`,
          borderRadius: 4,
          // Dark rim just outside the light border keeps the (grayscale)
          // highlight legible on light and dark app backgrounds alike.
          boxShadow: "0 0 0 1.5px rgba(0, 0, 0, 0.55)",
          boxSizing: "border-box",
        }}
      />
      {label !== undefined && label !== "" ? (
        <span
          style={{
            position: "absolute",
            left: 0,
            ...(labelFitsAbove
              ? { bottom: "100%", marginBottom: 4 }
              : { top: 4, marginLeft: 4 }),
            padding: "3px 7px",
            background: "rgba(15, 17, 17, 0.96)",
            // The border ties the chip to the outline stroke; the text stays
            // full-strength ink so it reads even when the stroke is a faint
            // hover tint.
            color: COLORS.neutralInk,
            border: `1px solid ${color}`,
            borderRadius: 5,
            fontSize: FONT.sizeLabel,
            lineHeight: 1.2,
            fontFamily: FONT.family,
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
}
