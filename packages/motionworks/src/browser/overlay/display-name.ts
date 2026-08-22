// Human-readable naming for the toolkit UI. Effect ids and registered names
// stay untouched (they are contract surfaces — writeback and wire messages
// depend on them); these helpers only shape what the designer READS.

// "ProductCardHover" → "Product card hover"; "live-pulse" → "Live pulse".
export function humanizeEffectName(name: string): string {
  const instance = /^(.*)#(\d+)$/.exec(name);
  if (instance !== null) {
    const base = humanizeEffectName(instance[1] ?? "");
    return `${base} ${instance[2]}`;
  }
  const spaced = name
    .replace(/[-_]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (spaced.length === 0) return name;
  const lower = spaced.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// Short, designer-friendly description of the element an effect is attached
// to: prefer readable text on/around the element over CSS selectors.
export function friendlyNodeLabel(node: HTMLElement): string {
  const aria = node.getAttribute("aria-label");
  if (aria !== null && aria.trim().length > 0)
    return `"${truncate(aria.trim())}"`;

  const ownText = normalizeText(readableText(node));
  if (ownText !== "") return `"${truncate(ownText)}"`;

  if (node instanceof HTMLImageElement && node.alt.trim().length > 0) {
    return `image "${truncate(node.alt.trim())}"`;
  }

  // No text of its own (icons, dots, tiles) — anchor it to nearby text.
  const parentText =
    node.parentElement !== null
      ? normalizeText(readableText(node.parentElement))
      : "";
  const tag = `<${node.tagName.toLowerCase()}>`;
  if (parentText !== "") return `${tag} in "${truncate(parentText)}"`;
  return tag;
}

// innerText keeps layout-derived separation between child nodes ("Eos Kettle
// $148" rather than "Eos Kettle$148"); jsdom lacks it, so fall back.
function readableText(node: HTMLElement): string | null {
  const inner = (node as { innerText?: string }).innerText;
  return typeof inner === "string" ? inner : node.textContent;
}

function normalizeText(text: string | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function truncate(text: string, max = 26): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
