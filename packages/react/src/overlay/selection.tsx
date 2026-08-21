import { useEffect, useRef, useState } from 'react';

import { getBridge } from '../bridge.js';
import { NodeHighlight } from './highlight.js';
import { useOverlaySession } from './context.js';
import { humanizeEffectName } from './display-name.js';
import { useSessionState } from './hooks.js';

// Two consecutive clicks are treated as a drill gesture when they land close
// together in both time and space. The window is deliberately looser than the
// system dblclick default because a designer is repeatedly stabbing at a
// specific element, not the OS's rapid-double.
const DRILL_WINDOW_MS = 450;
const DRILL_MOVE_TOLERANCE_PX = 8;

interface Props {
  active: boolean;
  selectedEffectId: string | null;
}

// Selection engine. When active:
//   • pointermove hit-tests registered nodes → show hover highlight
//   • pointerdown resolves to select (if hovering a registered node) or
//     deselect (if hovering empty space)
// Uses capture-phase listeners on the document so we get first crack at
// clicks. Only click-shaped events are intercepted (preventDefault +
// stopPropagation) so selecting never triggers the app's own click
// handlers; hover/move events flow through untouched so the app's
// animations play exactly as they do with MotionWorks off.
export function SelectionEngine({ active, selectedEffectId }: Props): React.JSX.Element | null {
  const session = useOverlaySession();
  const state = useSessionState();
  const [hover, setHover] = useState<{ node: HTMLElement; id: string } | null>(null);
  const [selectedNode, setSelectedNode] = useState<HTMLElement | null>(() =>
    selectedEffectId === null ? null : getBridge().getNode(selectedEffectId) ?? null,
  );

  // Last-click state so we can tell a follow-up click (same spot, quick) from
  // a fresh click. A follow-up is treated as a double-click: hone straight
  // to the deepest registered element under the point. Ref (not state)
  // because pointerdown reads/writes it synchronously.
  const lastClickRef = useRef<{ time: number; x: number; y: number }>({
    time: 0,
    x: 0,
    y: 0,
  });

  useEffect(() => {
    if (selectedEffectId === null) {
      setSelectedNode(null);
      return;
    }
    const bridge = getBridge();
    const update = (): void => {
      setSelectedNode(bridge.getNode(selectedEffectId) ?? null);
    };
    update();
    return bridge.subscribeToNodes(update);
  }, [selectedEffectId]);

  useEffect(() => {
    if (!active) {
      setHover(null);
      return;
    }
    const bridge = getBridge();

    // Registration map is rebuilt per hit-test — the bridge's node set can
    // change any time (HMR, mount/unmount) so caching outside would go stale.
    // Returns registered nodes at the point ordered SHALLOWEST → DEEPEST,
    // so index 0 is the outermost ancestor and index N-1 is the innermost.
    // `elementsFromPoint` gives us deepest-first, so we reverse.
    const registeredStackAt = (
      x: number,
      y: number,
    ): { id: string; node: HTMLElement }[] => {
      const registeredIdByNode = new Map<HTMLElement, string>();
      for (const [id, instances] of bridge.getAllNodes().entries()) {
        for (const node of instances) registeredIdByNode.set(node, id);
      }
      const stack = document.elementsFromPoint(x, y);
      const hits: { id: string; node: HTMLElement }[] = [];
      for (const element of stack) {
        if (isOverlayNode(element)) continue;
        if (!(element instanceof HTMLElement)) continue;
        const id = registeredIdByNode.get(element);
        if (id !== undefined) {
          hits.push({ id, node: element });
        }
      }
      return hits.reverse();
    };

    const onMove = (event: PointerEvent): void => {
      // Pointer over overlay UI (toolbar, drawer, panels): the designer is
      // using the tool, not the canvas — never hit-test through it to the
      // app elements underneath.
      if (event.target instanceof Element && isOverlayNode(event.target)) {
        setHover(null);
        return;
      }
      // Hover just outlines the outermost registered ancestor — it's what a
      // single click grabs. The deepest element is only relevant once the
      // designer commits to double-clicking.
      const stack = registeredStackAt(event.clientX, event.clientY);
      setHover(stack.length === 0 ? null : { node: stack[0]!.node, id: stack[0]!.id });
    };

    const onDown = (event: PointerEvent): void => {
      // Synthetic events aren't the designer selecting — they're the
      // session's replayInteraction (or the app's own dispatches) and must
      // flow through to the app untouched.
      if (!event.isTrusted) return;
      // Overlay-owned UI (toolbox, scrubber, menus) handles its own clicks.
      if (event.target instanceof Element && isOverlayNode(event.target)) return;

      const stack = registeredStackAt(event.clientX, event.clientY);
      event.preventDefault();
      event.stopPropagation();

      if (stack.length === 0) {
        session.selectEffect(null);
        lastClickRef.current = { time: 0, x: 0, y: 0 };
        return;
      }

      const last = lastClickRef.current;
      const now = Date.now();
      const dt = now - last.time;
      const dx = Math.abs(event.clientX - last.x);
      const dy = Math.abs(event.clientY - last.y);
      const isFollowUp =
        dt <= DRILL_WINDOW_MS &&
        dx <= DRILL_MOVE_TOLERANCE_PX &&
        dy <= DRILL_MOVE_TOLERANCE_PX;

      const target = isFollowUp ? stack[stack.length - 1]! : stack[0]!;
      session.selectEffect(target.id, target.node);
      lastClickRef.current = { time: now, x: event.clientX, y: event.clientY };
    };

    // Native double-click fallback in case my time-based detection misses
    // (browser dblclick has looser tolerance and uses OS settings). Selects
    // the deepest registered node at the point.
    const onDblClick = (event: MouseEvent): void => {
      if (!event.isTrusted) return;
      if (event.target instanceof Element && isOverlayNode(event.target)) return;
      const stack = registeredStackAt(event.clientX, event.clientY);
      event.preventDefault();
      event.stopPropagation();
      if (stack.length === 0) return;
      const target = stack[stack.length - 1]!;
      session.selectEffect(target.id, target.node);
    };

    // preventDefault on pointerdown does NOT reliably suppress the follow-up
    // click event (buttons/links still navigate). Capture the click and kill
    // it here so overlay-mode selection never triggers the underlying UI.
    // Overlay-owned nodes (toolbox buttons) are exempted the same way onDown
    // exempts them.
    const onClick = (event: MouseEvent): void => {
      if (!event.isTrusted) return;
      if (event.target instanceof Element && isOverlayNode(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    document.addEventListener('pointermove', onMove, { capture: true });
    document.addEventListener('pointerdown', onDown, { capture: true });
    document.addEventListener('click', onClick, { capture: true });
    document.addEventListener('dblclick', onDblClick, { capture: true });
    return () => {
      document.removeEventListener('pointermove', onMove, { capture: true });
      document.removeEventListener('pointerdown', onDown, { capture: true });
      document.removeEventListener('click', onClick, { capture: true });
      document.removeEventListener('dblclick', onDblClick, { capture: true });
      setHover(null);
    };
  }, [active, session]);

  if (!active) return null;

  const showHover = hover !== null && hover.node !== selectedNode;
  const nameById = (id: string | null): string | undefined => {
    if (id === null) return undefined;
    const effect = state.effects.find((e) => e.id === id);
    return effect === undefined ? undefined : humanizeEffectName(effect.name);
  };
  const hoverLabel = hover !== null ? nameById(hover.id) : undefined;
  const selectedLabel = nameById(selectedEffectId);

  return (
    <>
      {showHover && (
        <NodeHighlight
          node={hover.node}
          color="rgba(255, 255, 255, 0.45)"
          label={hoverLabel}
        />
      )}
      {selectedNode !== null && (
        <NodeHighlight node={selectedNode} color="rgb(255, 255, 255)" label={selectedLabel} />
      )}
    </>
  );
}

function isOverlayNode(node: Element): boolean {
  return node.closest('[data-motionworks-overlay]') !== null;
}
