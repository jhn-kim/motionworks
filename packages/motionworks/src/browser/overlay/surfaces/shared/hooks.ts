import { useEffect, useRef, useState } from "react";

import { getCanvasRegistry, type CanvasDraw } from "./canvas-registry.js";

// Tracks the element's bounding rect once per animation frame. Lots of
// surfaces need this and reimplementing it in each is fragile — they'd all
// re-derive centers, widths, and heights independently.
export function useNodeRect(node: HTMLElement | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(() =>
    node !== null ? node.getBoundingClientRect() : null,
  );
  const rectRef = useRef(rect);
  rectRef.current = rect;

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
      const prev = rectRef.current;
      if (
        prev === null ||
        prev.left !== next.left ||
        prev.top !== next.top ||
        prev.width !== next.width ||
        prev.height !== next.height
      ) {
        setRect(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [node]);

  return rect;
}

// Path coordinates are defined against the registered element at rest. A
// normal bounding rect includes CSS transforms and offset-path motion, so a
// guide measured that way chases the animated element around the screen.
// Reconstructing the rect from layout metrics keeps the coordinate host
// still while preserving movement caused by scrolling, layout, and resized
// ancestors.
export function restingNodeRect(node: HTMLElement): DOMRect {
  const offsetParent = node.offsetParent;
  if (!(offsetParent instanceof HTMLElement)) {
    return node.getBoundingClientRect();
  }

  const parentRect = offsetParent.getBoundingClientRect();
  const scaleX =
    offsetParent.offsetWidth === 0
      ? 1
      : parentRect.width / offsetParent.offsetWidth;
  const scaleY =
    offsetParent.offsetHeight === 0
      ? 1
      : parentRect.height / offsetParent.offsetHeight;

  return new DOMRect(
    parentRect.left +
      (offsetParent.clientLeft + node.offsetLeft - offsetParent.scrollLeft) *
        scaleX,
    parentRect.top +
      (offsetParent.clientTop + node.offsetTop - offsetParent.scrollTop) *
        scaleY,
    node.offsetWidth * scaleX,
    node.offsetHeight * scaleY,
  );
}

export function useRestingNodeRect(node: HTMLElement | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(() =>
    node !== null ? restingNodeRect(node) : null,
  );
  const rectRef = useRef(rect);
  rectRef.current = rect;

  useEffect(() => {
    if (node === null) {
      setRect(null);
      return;
    }
    let cancelled = false;
    let raf = 0;
    const tick = (): void => {
      if (cancelled) return;
      const next = restingNodeRect(node);
      const prev = rectRef.current;
      if (
        prev === null ||
        prev.left !== next.left ||
        prev.top !== next.top ||
        prev.width !== next.width ||
        prev.height !== next.height
      ) {
        setRect(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [node]);

  return rect;
}

// Registers a canvas draw callback for the lifetime of the caller's mount.
// The callback should read from refs (not state) — the CanvasLayer's rAF
// loop invokes it on every frame regardless of React renders.
export function useCanvasDrawer(draw: CanvasDraw | null): void {
  useEffect(() => {
    if (draw === null) return;
    return getCanvasRegistry().register(draw);
  }, [draw]);
}
