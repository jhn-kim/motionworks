import { useEffect, useRef } from 'react';

import type { MotionWorksEffect, ParameterType } from '@motionworks/core';

import { getBridge } from '../bridge.js';
import { useOverlaySession } from './context.js';
import { humanizeEffectName } from './display-name.js';
import { useSessionState } from './hooks.js';
import { SliderControl, sliderBoundsFor } from './toolkit-panels.js';
import { FONT, GLASS } from './theme.js';

// Width 0 + minWidth 100%: the list never contributes to the chip's
// intrinsic width — it stretches to whatever the toolbar row is, so opening
// it only ever grows the chip upward.
const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '6px 10px 8px',
  width: 0,
  minWidth: '100%',
  boxSizing: 'border-box',
};

// At most seven rows visible, then the list scrolls.
const LIST_ROW_MAX_HEIGHT = 7 * 24;

// Subtle dock-style magnification: rows swell toward the cursor with a
// cosine falloff, so the list reads as a lens passing over it rather than
// items snapping bigger on hover.
const MAGNIFY_BOOST = 0.015;
const MAGNIFY_RANGE_PX = 64;
// Neighbors are nudged away from the cursor so the swelling row gets
// breathing room instead of bleeding into them.
const MAGNIFY_PUSH_PX = 1.5;

function MagnifyList({ children }: { children: React.ReactNode }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const apply = (pointerY: number | null): void => {
    const el = ref.current;
    if (el === null) return;
    const children = Array.from(el.children).filter(
      (c): c is HTMLElement => c instanceof HTMLElement,
    );
    // The row nearest the cursor is THE hovered row — it alone gets the fill.
    let closest: HTMLElement | null = null;
    let closestD = Infinity;
    const info = children.map((child) => {
      const r = child.getBoundingClientRect();
      const center = r.top + r.height / 2;
      const d = pointerY === null ? Infinity : pointerY - center;
      if (Math.abs(d) < closestD) {
        closestD = Math.abs(d);
        closest = child;
      }
      return { child, d };
    });
    for (const { child, d } of info) {
      const abs = Math.abs(d);
      let scale = 1;
      let shift = 0;
      if (pointerY !== null && abs < MAGNIFY_RANGE_PX) {
        const window = 0.5 + 0.5 * Math.cos((Math.PI * abs) / MAGNIFY_RANGE_PX);
        scale = 1 + MAGNIFY_BOOST * window;
        // Push away from the cursor (up when above it, down when below),
        // except the hovered row itself, which stays put.
        if (child !== closest) shift = Math.sign(d) * -1 * MAGNIFY_PUSH_PX * window;
      }
      const isClosest = pointerY !== null && child === closest && abs < MAGNIFY_RANGE_PX;
      child.style.transformOrigin = 'left center';
      child.style.transition =
        'transform 150ms cubic-bezier(0.3, 0.9, 0.3, 1), background 120ms ease';
      child.style.transform =
        scale === 1 && shift === 0
          ? ''
          : `translateY(${shift.toFixed(1)}px) scale(${scale.toFixed(3)})`;
      child.style.zIndex = isClosest ? '2' : scale > 1 ? '1' : '';
      child.style.position = 'relative';
      child.style.background = isClosest ? GLASS.fillHover : '';
      child.style.borderRadius = isClosest ? '6px' : '';
    }
  };
  return (
    <div
      ref={ref}
      style={listStyle}
      onPointerMove={(e) => {
        apply(e.clientY);
      }}
      onPointerLeave={() => {
        apply(null);
      }}
      onScroll={() => {
        apply(null);
      }}
    >
      {children}
    </div>
  );
}

const listStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  maxHeight: LIST_ROW_MAX_HEIGHT,
  overflowY: 'auto',
  scrollbarWidth: 'thin',
  scrollbarColor: GLASS.scrollbarColor,
  // Let the scrollbar hug the chip's edge instead of sitting inset by the
  // section padding; content keeps its own right breathing room.
  marginRight: -8,
  paddingRight: 9,
};

const headerStyle: React.CSSProperties = {
  fontSize: FONT.sizeLabel,
  letterSpacing: 0.08,
  textTransform: 'uppercase',
  color: 'rgba(255, 255, 255, 0.45)',
  fontFamily: FONT.family,
};

const hintStyle: React.CSSProperties = {
  fontSize: FONT.sizeSmall,
  color: 'rgba(255, 255, 255, 0.5)',
  fontFamily: FONT.family,
  lineHeight: 1.4,
};

const TEMPORAL_TYPES = new Set(['stagger', 'duration']);

export interface ScopedEffect {
  effect: MotionWorksEffect;
  scopeNodes: HTMLElement[];
  timingParams: string[];
  otherTypes: string[];
}

// All registered animations on the selected element or nested inside it —
// the shared scope for the Layers and Choreography panels (and the toolbox's
// decision to show the Layers tool at all).
export function scopedEffects(
  effects: MotionWorksEffect[],
  selectedEffectId: string,
  resolvedType: (effectId: string, paramKey: string) => string | null,
): ScopedEffect[] {
  const bridge = getBridge();
  const allNodes = bridge.getAllNodes();
  const selectedNode = bridge.getNode(selectedEffectId) ?? null;

  const out: ScopedEffect[] = [];
  for (const effect of effects) {
    const nodes = allNodes.get(effect.id) ?? [];
    const scopeNodes =
      effect.id === selectedEffectId
        ? [...nodes]
        : selectedNode === null
          ? []
          : nodes.filter((n) => selectedNode.contains(n));
    if (effect.id !== selectedEffectId && scopeNodes.length === 0) continue;

    const timingParams: string[] = [];
    const otherTypes = new Set<string>();
    for (const [paramKey, param] of Object.entries(effect.params)) {
      const effective = resolvedType(effect.id, paramKey) ?? param.type;
      if (TEMPORAL_TYPES.has(effective)) timingParams.push(paramKey);
      else otherTypes.add(effective.replace(/-/g, ' '));
    }
    out.push({ effect, scopeNodes, timingParams, otherTypes: [...otherTypes] });
  }
  return out;
}

// ── Layers ────────────────────────────────────────────────────────────────
// Outline of the animations inside the selection. Clicking an entry selects
// that animation — the discoverable equivalent of double-click drilling.

export function LayersPanel({
  selectedEffectId,
  onJump,
}: {
  selectedEffectId: string;
  onJump: (effectId: string, node: HTMLElement | null) => void;
}): React.JSX.Element {
  const session = useOverlaySession();
  const state = useSessionState();
  const entries = scopedEffects(state.effects, selectedEffectId, (id, key) =>
    session.resolvedType(id, key),
  );

  return (
    <div style={sectionStyle}>
      <span style={headerStyle}>Layers</span>
      <MagnifyList>
      {entries.map(({ effect, scopeNodes }) => {
        const node = scopeNodes[0] ?? null;
        const isSelected = effect.id === selectedEffectId;
        return (
          <button
            key={effect.id}
            type="button"
            onClick={() => {
              if (!isSelected) onJump(effect.id, node);
            }}
            title={isSelected ? 'Currently selected' : 'Click to edit this animation'}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 1,
              border: 'none',
              borderLeft: isSelected
                ? '2px solid rgba(255, 255, 255, 0.85)'
                : '2px solid rgba(255, 255, 255, 0.15)',
              background: 'transparent',
              padding: '2px 0 2px 8px',
              cursor: isSelected ? 'default' : 'pointer',
              textAlign: 'left',
            }}
          >
            <span
              style={{
                fontSize: FONT.sizeSmall,
                color: 'rgba(255, 255, 255, 0.92)',
                fontFamily: FONT.family,
              }}
            >
              {humanizeEffectName(effect.name)}
              {scopeNodes.length > 1 ? ` × ${String(scopeNodes.length)}` : ''}
            </span>
          </button>
        );
      })}
      </MagnifyList>
    </div>
  );
}

// ── Elements ──────────────────────────────────────────────────────────────
// Nothing-selected state: every registered animation on the page, in one
// layers-style list. This is what keeps the open-but-idle toolkit legible —
// the chip is never empty — and it doubles as a navigator for elements that
// are hard to find by pointing (offscreen, tiny, or stacked).

export function ElementsPanel({
  onJump,
  onHover,
}: {
  onJump: (effectId: string, node: HTMLElement | null) => void;
  onHover: (info: { node: HTMLElement; label: string } | null) => void;
}): React.JSX.Element {
  const state = useSessionState();
  const bridge = getBridge();

  // Clear any lingering hover highlight when the panel goes away (a selection
  // was made or the toolkit closed mid-hover).
  useEffect(() => () => onHover(null), [onHover]);

  const entries = state.effects.map((effect) => {
    const nodes = [...(bridge.getAllNodes().get(effect.id) ?? [])];
    return { effect, nodes };
  });
  // Reading order: entries with a live DOM node sort by document position;
  // node-less registrations sink to the end.
  entries.sort((a, b) => {
    const na = a.nodes[0] ?? null;
    const nb = b.nodes[0] ?? null;
    if (na === null || nb === null) return na === null ? (nb === null ? 0 : 1) : -1;
    return (na.compareDocumentPosition(nb) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 ? -1 : 1;
  });

  return (
    <div style={sectionStyle}>
      <span style={headerStyle}>Animated surfaces</span>
      {entries.length === 0 ? (
        <span style={hintStyle}>
          Nothing registered yet. Ask your coding agent to add a motion effect — it will
          appear here, ready to refine.
        </span>
      ) : (
        <>
          <MagnifyList>
          {entries.map(({ effect, nodes }) => {
            const node = nodes[0] ?? null;
            return (
              <button
                key={effect.id}
                type="button"
                onClick={() => {
                  onJump(effect.id, node);
                }}
                onPointerEnter={() => {
                  if (node !== null) {
                    onHover({ node, label: humanizeEffectName(effect.name) });
                  }
                }}
                onPointerLeave={() => {
                  onHover(null);
                }}
                title="Click to edit this animation"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 1,
                  border: 'none',
                  borderLeft: '2px solid rgba(255, 255, 255, 0.15)',
                  background: 'transparent',
                  padding: '2px 0 2px 8px',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span
                  style={{
                    fontSize: FONT.sizeSmall,
                    color: 'rgba(255, 255, 255, 0.92)',
                    fontFamily: FONT.family,
                  }}
                >
                  {humanizeEffectName(effect.name)}
                  {nodes.length > 1 ? ` × ${String(nodes.length)}` : ''}
                </span>
              </button>
            );
          })}
          </MagnifyList>
        </>
      )}
    </div>
  );
}

// ── Choreography ──────────────────────────────────────────────────────────
// Timing only: every timing parameter (stagger / per-phase durations) of
// every animation in the selection, editable in one place. Animations
// without timing parameters do not appear here — that's what Layers is for.

export function ChoreographyPanel({
  selectedEffectId,
}: {
  selectedEffectId: string;
}): React.JSX.Element {
  const session = useOverlaySession();
  const state = useSessionState();
  const entries = scopedEffects(state.effects, selectedEffectId, (id, key) =>
    session.resolvedType(id, key),
  ).filter((e) => e.timingParams.length > 0);

  return (
    <div style={sectionStyle}>
      <span style={headerStyle}>Choreography</span>
      {entries.length === 0 ? (
        <span style={hintStyle}>No timing parameters in this selection.</span>
      ) : (
        entries.map(({ effect, scopeNodes, timingParams }) => {
          // Rows lead with the fixed tool name; the agent's label only
          // steps in when this animation has several params of one type.
          const typeCounts = new Map<ParameterType, number>();
          for (const key of timingParams) {
            const p = effect.params[key];
            if (p === undefined) continue;
            const t = session.resolvedType(effect.id, key) ?? p.type;
            typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
          }
          return (
          <div key={effect.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span
              style={{
                fontSize: FONT.sizeLabel,
                color: 'rgba(255, 255, 255, 0.6)',
                fontFamily: FONT.family,
              }}
            >
              {humanizeEffectName(effect.name)}
              {scopeNodes.length > 1 ? ` × ${String(scopeNodes.length)}` : ''}
            </span>
            {timingParams.map((paramKey) => {
              const param = effect.params[paramKey];
              if (param === undefined) return null;
              const diff = session.diffs.getDiff(effect.id)[paramKey];
              const live = diff !== undefined ? diff.to : param.value;
              if (typeof live !== 'number') return null;
              const type = session.resolvedType(effect.id, paramKey) ?? param.type;
              const toolName = type === 'stagger' ? 'Stagger' : 'Duration';
              return (
                <SliderControl
                  key={`${effect.id}::${paramKey}`}
                  label={(typeCounts.get(type) ?? 0) === 1 ? toolName : (param.label ?? paramKey)}
                  effectId={effect.id}
                  paramKey={paramKey}
                  currentType={type}
                  value={live}
                  bounds={sliderBoundsFor(param, type)}
                  unit={param.unit}
                  onChange={(next) => session.manipulate(effect.id, paramKey, next)}
                />
              );
            })}
          </div>
          );
        })
      )}
    </div>
  );
}
