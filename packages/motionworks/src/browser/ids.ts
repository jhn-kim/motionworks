export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'effect';
}

export function allocateEffectId(
  slug: string,
  node: Element,
  existing: ReadonlyMap<string, readonly Element[]>,
): string {
  for (const [id, nodes] of existing) {
    if (id.startsWith(`${slug}#`) && nodes.includes(node)) return id;
  }

  const used = new Set<number>();
  const preceding: number[] = [];
  for (const [id, nodes] of existing) {
    const match = new RegExp(`^${escapeRegExp(slug)}#(\\d+)$`).exec(id);
    if (match === null) continue;
    const index = Number(match[1]);
    used.add(index);
    if (nodes.some((other) => other.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) {
      preceding.push(index);
    }
  }

  let index = preceding.length + 1;
  while (used.has(index)) index += 1;
  return `${slug}#${String(index)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
