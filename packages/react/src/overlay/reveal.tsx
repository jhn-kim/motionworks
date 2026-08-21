import { useEffect, useState } from 'react';

import { getBridge } from '../bridge.js';
import { useOverlaySession } from './context.js';
import { humanizeEffectName } from './display-name.js';
import { COLORS, FONT, HIGHLIGHT } from './theme.js';

// Timing for the activation reveal: badges stagger in (reading order), hold
// long enough to be read, then fade out together.
const STAGGER_MS = 45;
const IN_MS = 240;
const HOLD_MS = 1200;
const OUT_MS = 300;

interface RevealEntry {
  key: string;
  name: string;
  node: HTMLElement;
}

// Activation reveal: the moment the toolkit opens, every registered element
// flashes its outline + effect name, so opening MotionWorks visibly answers
// "what changed?" (the overlay is live) and "what can I touch?" (these
// elements). Purely presentational — it fades out on its own and never
// intercepts pointer events. Mounted fresh on each activation.
export function ActivationReveal(): React.JSX.Element | null {
  const session = useOverlaySession();
  // Inventory is captured once at activation; effects registering mid-reveal
  // just wait for the next activation.
  const [entries] = useState<RevealEntry[]>(() => {
    const names = new Map<string, string>();
    for (const effect of session.getStateSnapshot().effects) {
      names.set(effect.id, effect.name);
    }
    const out: RevealEntry[] = [];
    for (const [id, nodes] of getBridge().getAllNodes().entries()) {
      const name = names.get(id);
      if (name === undefined) continue;
      nodes.forEach((node, index) => {
        out.push({
          key: `${id}::${String(index)}`,
          name: humanizeEffectName(name),
          node,
        });
      });
    }
    // Stagger in reading order — document order approximates top-to-bottom.
    out.sort((a, b) =>
      (a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
        ? -1
        : 1,
    );
    return out;
  });
  const [phase, setPhase] = useState<'in' | 'out' | 'done'>('in');

  useEffect(() => {
    if (entries.length === 0) return;
    const inDone = entries.length * STAGGER_MS + IN_MS + HOLD_MS;
    const outTimer = window.setTimeout(() => setPhase('out'), inDone);
    const doneTimer = window.setTimeout(() => setPhase('done'), inDone + OUT_MS);
    return () => {
      clearTimeout(outTimer);
      clearTimeout(doneTimer);
    };
  }, [entries]);

  if (phase === 'done' || entries.length === 0) return null;
  return (
    <>
      {entries.map((entry, index) => (
        <RevealBadge
          key={entry.key}
          entry={entry}
          delayMs={index * STAGGER_MS}
          out={phase === 'out'}
        />
      ))}
    </>
  );
}

interface RevealBadgeProps {
  entry: RevealEntry;
  delayMs: number;
  out: boolean;
}

function RevealBadge({ entry, delayMs, out }: RevealBadgeProps): React.JSX.Element | null {
  const [rect, setRect] = useState<DOMRect | null>(() => entry.node.getBoundingClientRect());
  // First paint happens at opacity 0; the entered flip on the next frame
  // starts the (delayed) fade-in transition.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Track the node's rect per frame — these are motion effects, so the
  // element may well be moving while its badge is showing.
  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    const tick = (): void => {
      if (cancelled) return;
      setRect(entry.node.getBoundingClientRect());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [entry.node]);

  if (rect === null || (rect.width === 0 && rect.height === 0)) return null;
  const visible = entered && !out;
  const labelFitsAbove = rect.top - HIGHLIGHT.offset > 28;
  return (
    <div
      style={{
        position: 'fixed',
        left: rect.left - HIGHLIGHT.offset,
        top: rect.top - HIGHLIGHT.offset,
        width: rect.width + HIGHLIGHT.offset * 2,
        height: rect.height + HIGHLIGHT.offset * 2,
        pointerEvents: 'none',
        zIndex: 9997,
        opacity: visible ? 1 : 0,
        transform: visible ? 'scale(1)' : 'scale(1.04)',
        // Delays stagger the way in; the way out fades everything together.
        transition: out
          ? `opacity ${String(OUT_MS)}ms ease, transform ${String(OUT_MS)}ms ease`
          : `opacity ${String(IN_MS)}ms ease ${String(delayMs)}ms, transform ${String(IN_MS)}ms cubic-bezier(0.3, 0.9, 0.3, 1) ${String(delayMs)}ms`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          border: `1.5px solid ${COLORS.accentSoft}`,
          borderRadius: 4,
          // Dark rim keeps the grayscale outline legible on light apps —
          // same treatment as NodeHighlight.
          boxShadow: '0 0 0 1.5px rgba(0, 0, 0, 0.55)',
          boxSizing: 'border-box',
        }}
      />
      <span
        style={{
          position: 'absolute',
          left: 0,
          ...(labelFitsAbove ? { bottom: '100%', marginBottom: 4 } : { top: 4, marginLeft: 4 }),
          padding: '3px 7px',
          background: 'rgba(15, 17, 17, 0.96)',
          // Border matches the outline stroke; text stays full-strength
          // ink — same pairing as NodeHighlight.
          color: COLORS.neutralInk,
          border: `1px solid ${COLORS.accentSoft}`,
          borderRadius: 5,
          fontSize: FONT.sizeLabel,
          lineHeight: 1.2,
          fontFamily: FONT.family,
          whiteSpace: 'nowrap',
        }}
      >
        {entry.name}
      </span>
    </div>
  );
}
