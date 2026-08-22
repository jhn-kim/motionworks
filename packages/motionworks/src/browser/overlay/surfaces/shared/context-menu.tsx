import { useEffect, useRef, useState } from "react";

import type { ParameterType } from "../../../../shared/index.js";

import { useOverlaySession } from "../../context.js";
import {
  COLORS,
  CONTEXT_MENU,
  FONT,
  NUMERIC_EDITOR,
  PANEL,
} from "../../theme.js";

const ALL_TYPES: ParameterType[] = [
  "spatial-radius",
  "spatial-strength",
  "temporal-decay",
  "temporal-response",
  "spring-response",
  "gradient",
  "path",
  "stagger",
  "scalar",
];

interface Props {
  x: number;
  y: number;
  currentType: ParameterType;
  effectId: string;
  paramKey: string;
  onEnterExactValue: () => void;
  onClose: () => void;
}

// Small right-click menu with two entries: numeric value editor (surface-
// specific) and a submenu listing the 10 parameter types. Positioned in
// viewport space; opts into pointer events explicitly since the parent
// foreignObject is pointer-events: none.
export function SurfaceContextMenu({
  x,
  y,
  currentType,
  effectId,
  paramKey,
  onEnterExactValue,
  onClose,
}: Props): React.JSX.Element {
  const session = useOverlaySession();
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocDown = (event: PointerEvent): void => {
      if (ref.current === null) return;
      if (!(event.target instanceof Node)) return;
      if (ref.current.contains(event.target)) return;
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
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        left: x,
        top: y,
        zIndex: 10000,
        minWidth: CONTEXT_MENU.minWidth,
        background: COLORS.panelBg,
        border: `1px solid ${COLORS.panelBorder}`,
        borderRadius: CONTEXT_MENU.radius,
        boxShadow: CONTEXT_MENU.shadow,
        fontFamily: FONT.family,
        fontSize: FONT.sizeBody,
        color: COLORS.neutralInk,
        pointerEvents: "auto",
        overflow: "visible",
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuItem
        onClick={() => {
          onEnterExactValue();
        }}
      >
        Enter exact value…
      </MenuItem>
      <MenuItem
        onMouseEnter={() => setSubmenuOpen(true)}
        onMouseLeave={() => setSubmenuOpen(false)}
        onClick={() => setSubmenuOpen((v) => !v)}
        style={{ position: "relative" }}
      >
        Edit parameter type
        <span style={{ opacity: 0.55, marginLeft: 8 }}>▸</span>
        {submenuOpen && (
          <div
            style={{
              position: "absolute",
              left: "100%",
              top: -1,
              marginLeft: CONTEXT_MENU.submenuIndent,
              minWidth: CONTEXT_MENU.minWidth,
              background: COLORS.panelBg,
              border: `1px solid ${COLORS.panelBorder}`,
              borderRadius: CONTEXT_MENU.radius,
              boxShadow: CONTEXT_MENU.shadow,
              zIndex: 10001,
            }}
          >
            {ALL_TYPES.map((type) => (
              <MenuItem
                key={type}
                onClick={(event) => {
                  event.stopPropagation();
                  if (type !== currentType) {
                    session.correctType(effectId, paramKey, type);
                  }
                  onClose();
                }}
                selected={type === currentType}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 12,
                    marginRight: 6,
                    opacity: type === currentType ? 1 : 0,
                  }}
                >
                  ✓
                </span>
                <code
                  style={{ fontFamily: FONT.mono, fontSize: FONT.sizeSmall }}
                >
                  {type}
                </code>
              </MenuItem>
            ))}
          </div>
        )}
      </MenuItem>
    </div>
  );
}

interface MenuItemProps extends React.HTMLAttributes<HTMLDivElement> {
  selected?: boolean;
}

function MenuItem({
  selected: _selected,
  children,
  style,
  onMouseEnter,
  onMouseLeave,
  ...rest
}: MenuItemProps): React.JSX.Element {
  const [hover, setHover] = useState(false);
  return (
    <div
      {...rest}
      style={{
        padding: CONTEXT_MENU.itemPadding,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        background: hover ? CONTEXT_MENU.itemHoverBg : "transparent",
        ...style,
      }}
      onMouseEnter={(e) => {
        setHover(true);
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        setHover(false);
        onMouseLeave?.(e);
      }}
    >
      {children}
    </div>
  );
}

interface NumericEditorProps {
  initial: number;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  step?: number;
}

// Compact numeric input for the "Enter exact value…" flow. Selects the
// contents on focus so the designer can start typing over the initial value
// without a manual clear.
export function NumericEditor({
  initial,
  onSubmit,
  onCancel,
  step,
}: NumericEditorProps): React.JSX.Element {
  const format =
    step !== undefined && step < 1
      ? initial.toFixed(2)
      : String(Math.round(initial));
  const [value, setValue] = useState(() => format);
  return (
    <input
      autoFocus
      type="number"
      step={step ?? "any"}
      value={value}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSubmit(value);
        else if (e.key === "Escape") onCancel();
      }}
      onBlur={() => onSubmit(value)}
      style={{
        width: NUMERIC_EDITOR.width,
        padding: NUMERIC_EDITOR.padding,
        fontFamily: FONT.mono,
        fontSize: FONT.sizeBody,
        border: `1px solid ${COLORS.accentSoft}`,
        borderRadius: NUMERIC_EDITOR.radius,
        background: COLORS.panelBg,
        color: COLORS.neutralInk,
        outline: "none",
        boxShadow: PANEL.shadow,
      }}
    />
  );
}
