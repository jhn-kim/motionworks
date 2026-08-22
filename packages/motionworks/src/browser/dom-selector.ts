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
