const INTERACTIVE_SELECTOR =
  'button, a[href], [role="button"], input, select, textarea, summary, label';

// The nearest clickable element for an effect's node. The effect may be
// registered on a decorative child (a badge, an underline span) of the
// interactive element the designer would actually press — closest() walks up
// to it. Null when nothing pressable encloses the node.
export function findInteractiveNode(
  node: HTMLElement | null,
): HTMLElement | null {
  if (node === null) return null;
  const hit = node.closest(INTERACTIVE_SELECTOR);
  return hit instanceof HTMLElement ? hit : null;
}

// A durable-per-element identifier written to `data-mw-id`. Selection and
// journal entries key to this instead of the structural selector, which breaks
// the moment markup is reordered, wrapped, or a class is renamed. The id is
// derived deterministically from the element's position path (tag + sibling
// index up the tree), so the SAME element earns the SAME id across a dev-server
// reload — the documented live-reload persistence technique — and siblings that
// share a class (the three loader dots) still get distinct ids. Surviving a
// refactor of the markup itself needs a build-time plugin; that is the opt-in
// upgrade noted in the PRD, not this runtime fallback.
function positionPath(node: Element): string {
  const parts: string[] = [];
  let current: Element | null = node;
  while (current !== null && current !== document.documentElement) {
    const parent: Element | null = current.parentElement;
    const siblings = parent === null ? [] : Array.from(parent.children);
    const index = siblings.indexOf(current);
    parts.unshift(`${current.tagName.toLowerCase()}:${String(index)}`);
    current = parent;
  }
  return parts.join("/");
}

// djb2, base36. Only needs to be stable and collision-resistant enough to label
// distinct elements on one page — not cryptographic.
function hashPath(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++)
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

// Idempotent: returns the existing `data-mw-id` if one is present (respecting a
// build-time plugin that may have stamped a better one), otherwise derives and
// writes a deterministic id.
export function ensureStableId(node: HTMLElement): string {
  const existing = node.dataset.mwId;
  if (existing !== undefined && existing !== "") return existing;
  const id = `mw-${hashPath(positionPath(node))}`;
  node.dataset.mwId = id;
  return id;
}

// Re-applies the stable id if a live reload (or a framework re-render) strips
// the attribute, so a selection made before the reload still resolves. Returns
// a disposer.
export function watchStableId(node: HTMLElement): () => void {
  const id = ensureStableId(node);
  const observer = new MutationObserver(() => {
    if (node.dataset.mwId !== id) node.dataset.mwId = id;
  });
  observer.observe(node, {
    attributes: true,
    attributeFilter: ["data-mw-id"],
  });
  return () => observer.disconnect();
}

// Builds a CSS-like selector string for a DOM node so the agent has a
// human-recognizable target for source writeback. This is a best-effort
// human-facing label, not something the agent parses to locate code.
export function describeNode(node: Element): string {
  if (node.id !== "") return `#${node.id}`;
  const segments: string[] = [];
  let current: Element | null = node;
  let depth = 0;
  while (current !== null && depth < 4) {
    let seg = current.tagName.toLowerCase();
    if (current.id !== "") {
      seg = `#${current.id}`;
      segments.unshift(seg);
      break;
    }
    if (typeof current.className === "string" && current.className.length > 0) {
      const cls = current.className.trim().split(/\s+/).slice(0, 2).join(".");
      if (cls.length > 0) seg = `${seg}.${cls}`;
    }
    segments.unshift(seg);
    current = current.parentElement;
    depth++;
  }
  return segments.join(" > ");
}
