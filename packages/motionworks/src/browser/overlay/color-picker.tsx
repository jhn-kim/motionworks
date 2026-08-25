import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { COLOR_PICKER, COLORS, FONT, GLASS, KNOB } from "./theme.js";

// Custom colour picker shared by the toolkit gradient rows and the on-canvas
// gradient surface. The OS-native <input type="color"> dialog cannot be
// styled, so the popover reimplements the picking model (HSV area + hue
// strip + hex field) in the overlay's glass chrome. Portaled to the body:
// the glass chip's backdrop-filter makes it the containing block for fixed
// descendants, which would trap and clip the popover inside the toolbar.

interface Hsv {
  h: number; // 0–360
  s: number; // 0–1
  v: number; // 0–1
}

function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number): number => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const toHex = (x: number): string =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(f(5))}${toHex(f(3))}${toHex(f(1))}`;
}

function rgbToHsv(r: number, g: number, b: number): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

// Best-effort conversion of any CSS colour to #rrggbb. Non-hex syntax is
// resolved through a scratch canvas so named colours and rgb() both work.
function cssToHex(color: string): string {
  const s = color.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    return `#${s[1]!}${s[1]!}${s[2]!}${s[2]!}${s[3]!}${s[3]!}`.toLowerCase();
  }
  if (typeof document === "undefined") return "#ffffff";
  const ctx = document.createElement("canvas").getContext("2d");
  if (ctx === null) return "#ffffff";
  ctx.fillStyle = color;
  const normalized = ctx.fillStyle;
  return /^#[0-9a-fA-F]{6}$/.test(normalized)
    ? normalized.toLowerCase()
    : "#ffffff";
}

function hexToHsv(hex: string): Hsv {
  const n = cssToHex(hex);
  return rgbToHsv(
    parseInt(n.slice(1, 3), 16),
    parseInt(n.slice(3, 5), 16),
    parseInt(n.slice(5, 7), 16),
  );
}

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

const HUE_GRADIENT =
  "linear-gradient(to right, #f00, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00)";

// Ring-style position thumb: reads over any colour underneath.
const thumbStyle = (left: string, top: string): React.CSSProperties => ({
  position: "absolute",
  left,
  top,
  width: COLOR_PICKER.thumbRadius * 2,
  height: COLOR_PICKER.thumbRadius * 2,
  marginLeft: -COLOR_PICKER.thumbRadius,
  marginTop: -COLOR_PICKER.thumbRadius,
  borderRadius: "50%",
  border: "2px solid #ffffff",
  boxShadow: `0 0 0 1px ${KNOB.rim}, inset 0 0 0 1px ${KNOB.rim}, 0 1.5px 4px rgba(0, 0, 0, 0.25)`,
  pointerEvents: "none",
});

interface PickerProps {
  x: number;
  y: number;
  color: string;
  onChange: (hex: string) => void;
  onClose: () => void;
  // Pointerdowns inside this element don't count as outside-clicks. Lets an
  // anchor button toggle the popover instead of close-then-reopen racing.
  ignoreRef?: React.RefObject<HTMLElement | null>;
  // When set, the popover opens with its bottom edge at `y` instead of its
  // top edge — used to flip above an anchor near the bottom of the viewport
  // so the picker never covers the toolbar chip beneath it.
  openUpward?: boolean;
}

export function ColorPickerPopover({
  x,
  y,
  color,
  onChange,
  onClose,
  ignoreRef,
  openUpward,
}: PickerProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(color));
  const [hexField, setHexField] = useState(() => cssToHex(color));
  const [hexFocused, setHexFocused] = useState(false);
  const dragCleanupRef = useRef<() => void>(() => undefined);
  // The last hex this picker emitted — distinguishes our own change echoing
  // back through props from an external change (another surface, writeback).
  const lastEmitted = useRef(cssToHex(color));

  useEffect(() => () => dragCleanupRef.current(), []);

  useEffect(() => {
    const incoming = cssToHex(color);
    if (incoming === lastEmitted.current) return;
    lastEmitted.current = incoming;
    setHsv(hexToHsv(incoming));
    if (!hexFocused) setHexField(incoming);
  }, [color, hexFocused]);

  useEffect(() => {
    const onDocDown = (event: PointerEvent): void => {
      if (ref.current === null) return;
      if (!(event.target instanceof Node)) return;
      if (ref.current.contains(event.target)) return;
      if (ignoreRef?.current?.contains(event.target) === true) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDocDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, ignoreRef]);

  const emit = (next: Hsv): void => {
    setHsv(next);
    const hex = hsvToHex(next);
    lastEmitted.current = hex;
    if (!hexFocused) setHexField(hex);
    onChange(hex);
  };

  const dragArea =
    (apply: (fx: number, fy: number) => void) =>
    (event: React.PointerEvent<HTMLDivElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      dragCleanupRef.current();
      const target = event.currentTarget;
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        // synthetic events have no active pointer to capture
      }
      const areaRect = target.getBoundingClientRect();
      const applyAt = (clientX: number, clientY: number): void => {
        const fx = Math.max(
          0,
          Math.min(1, (clientX - areaRect.left) / areaRect.width),
        );
        const fy = Math.max(
          0,
          Math.min(1, (clientY - areaRect.top) / areaRect.height),
        );
        apply(fx, fy);
      };
      applyAt(event.clientX, event.clientY);
      const move = (ev: PointerEvent): void => {
        applyAt(ev.clientX, ev.clientY);
      };
      const finish = (): void => {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", finish, true);
        window.removeEventListener("pointercancel", finish, true);
        try {
          if (target.hasPointerCapture(event.pointerId)) {
            target.releasePointerCapture(event.pointerId);
          }
        } catch {
          // pointer capture may already have been released by the browser
        }
        dragCleanupRef.current = () => undefined;
      };
      dragCleanupRef.current = finish;
      // Capture phase is required: the picker wall intentionally stops
      // bubbled pointer events so they cannot start a toolbar drag.
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", finish, true);
      window.addEventListener("pointercancel", finish, true);
    };

  const commitHex = (raw: string): void => {
    const trimmed = raw.trim();
    if (!HEX_RE.test(trimmed)) return;
    const hex = cssToHex(trimmed.startsWith("#") ? trimmed : `#${trimmed}`);
    lastEmitted.current = hex;
    setHsv(hexToHsv(hex));
    onChange(hex);
  };

  const svWidth = COLOR_PICKER.width - COLOR_PICKER.padding * 2;
  const left = Math.max(
    8,
    Math.min(x, window.innerWidth - COLOR_PICKER.width - 8),
  );
  const estHeight =
    COLOR_PICKER.svHeight +
    COLOR_PICKER.hueHeight +
    30 +
    COLOR_PICKER.gap * 2 +
    COLOR_PICKER.padding * 2;
  const top = Math.max(
    8,
    Math.min(
      openUpward === true ? y - estHeight : y,
      window.innerHeight - estHeight - 8,
    ),
  );
  const currentHex = hsvToHex(hsv);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Colour picker"
      // Portaled outside the overlay root, so it must carry the overlay
      // ownership marker itself — without it the selection layer treats
      // every trusted click here as a page click (isOverlayNode fails),
      // deselects the effect, and the whole panel stack collapses.
      data-motionworks-overlay=""
      style={{
        position: "fixed",
        left,
        top,
        // Editor modal sits above the toolbar (10000).
        zIndex: 10001,
        display: "flex",
        flexDirection: "column",
        gap: COLOR_PICKER.gap,
        width: COLOR_PICKER.width,
        boxSizing: "border-box",
        padding: COLOR_PICKER.padding,
        background: GLASS.background,
        backdropFilter: GLASS.backdrop,
        WebkitBackdropFilter: GLASS.backdrop,
        border: GLASS.border,
        borderRadius: GLASS.radiusSmall,
        boxShadow: GLASS.shadow,
        fontFamily: FONT.family,
        pointerEvents: "auto",
      }}
      onContextMenu={(e) => e.preventDefault()}
      // Wall: nothing that starts inside the picker may reach the toolbar's
      // React tree — portals bubble synthetic events through the tree, and a
      // pointerdown that escapes here reads as a bar-drag start.
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        style={{
          position: "relative",
          width: svWidth,
          height: COLOR_PICKER.svHeight,
          borderRadius: GLASS.radiusSmall - 4,
          background: `linear-gradient(to top, #000, rgba(0, 0, 0, 0)), linear-gradient(to right, #fff, hsl(${String(hsv.h)}, 100%, 50%))`,
          boxShadow: `inset 0 0 0 1px ${GLASS.hairline}`,
          cursor: "crosshair",
          touchAction: "none",
        }}
        onPointerDown={dragArea((fx, fy) => emit({ ...hsv, s: fx, v: 1 - fy }))}
      >
        <div
          style={thumbStyle(
            `${String(hsv.s * 100)}%`,
            `${String((1 - hsv.v) * 100)}%`,
          )}
        />
      </div>
      <div
        style={{
          position: "relative",
          width: svWidth,
          height: COLOR_PICKER.hueHeight,
          borderRadius: 999,
          background: HUE_GRADIENT,
          boxShadow: `inset 0 1px 1.5px rgba(0, 0, 0, 0.28), inset 0 0 0 1px ${GLASS.hairline}`,
          cursor: "ew-resize",
          touchAction: "none",
        }}
        onPointerDown={dragArea((fx) => emit({ ...hsv, h: fx * 360 }))}
      >
        <div style={thumbStyle(`${String((hsv.h / 360) * 100)}%`, "50%")} />
      </div>
      <div
        style={{ display: "flex", alignItems: "center", gap: COLOR_PICKER.gap }}
      >
        <span
          aria-hidden
          style={{
            width: COLOR_PICKER.swatchSize,
            height: COLOR_PICKER.swatchSize,
            flexShrink: 0,
            borderRadius: COLOR_PICKER.swatchRadius,
            background: currentHex,
            boxShadow: `inset 0 0 0 1px ${KNOB.rim}`,
          }}
        />
        <input
          autoFocus
          type="text"
          spellCheck={false}
          value={hexField}
          aria-label="Hex colour"
          onFocus={(e) => {
            setHexFocused(true);
            e.currentTarget.select();
          }}
          onBlur={() => {
            setHexFocused(false);
            commitHex(hexField);
            setHexField(hsvToHex(hsv));
          }}
          onChange={(e) => {
            setHexField(e.target.value);
            commitHex(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitHex(hexField);
              onClose();
            }
          }}
          style={{
            flex: 1,
            minWidth: 0,
            padding: "4px 6px",
            fontFamily: FONT.mono,
            fontSize: FONT.sizeBody,
            border: `1px solid ${hexFocused ? COLORS.accentSoft : GLASS.hairline}`,
            borderRadius: GLASS.radiusSmall - 4,
            background: GLASS.fill,
            color: COLORS.neutralInk,
            outline: "none",
          }}
        />
      </div>
    </div>,
    document.body,
  );
}

interface SwatchProps {
  color: string;
  onChange: (hex: string) => void;
  ariaLabel: string;
}

// Swatch button that opens the picker popover, anchored below itself.
// Drop-in replacement for the old native <input type="color"> swatches.
export function ColorSwatch({
  color,
  onChange,
  ariaLabel,
}: SwatchProps): React.JSX.Element {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{
    x: number;
    y: number;
    upward: boolean;
  } | null>(null);
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        onClick={() => {
          const rect = buttonRef.current?.getBoundingClientRect();
          if (rect === undefined) return;
          if (anchor !== null) {
            setAnchor(null);
            return;
          }
          // Open away from the toolbar chip: upward when the swatch sits in
          // the lower half of the viewport, downward otherwise. The picker
          // must never cover the chip — its drag row would sit under the
          // picker's controls.
          const upward = rect.top > window.innerHeight / 2;
          setAnchor({
            x: rect.left,
            y: upward
              ? rect.top - COLOR_PICKER.offsetY
              : rect.bottom + COLOR_PICKER.offsetY,
            upward,
          });
        }}
        style={{
          width: COLOR_PICKER.swatchSize,
          height: COLOR_PICKER.swatchSize,
          flexShrink: 0,
          padding: 0,
          border: `1px solid ${GLASS.hairline}`,
          borderRadius: COLOR_PICKER.swatchRadius,
          background: color,
          boxShadow: `inset 0 0 0 1px ${KNOB.rim}`,
          cursor: "pointer",
        }}
      />
      {anchor !== null && (
        <ColorPickerPopover
          x={anchor.x}
          y={anchor.y}
          openUpward={anchor.upward}
          color={color}
          onChange={onChange}
          onClose={() => setAnchor(null)}
          ignoreRef={buttonRef}
        />
      )}
    </>
  );
}
