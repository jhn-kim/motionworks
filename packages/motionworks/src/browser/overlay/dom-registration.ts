import type { MotionWorksRegistration } from "../../shared/types.js";
import { getBridge } from "../bridge.js";
import { allocateEffectId, slugify } from "../ids.js";

function isSchema(value: unknown): value is MotionWorksRegistration {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const schema = value as { name?: unknown; params?: unknown };
  return (
    typeof schema.name === "string" &&
    schema.name.trim() !== "" &&
    typeof schema.params === "object" &&
    schema.params !== null &&
    !Array.isArray(schema.params)
  );
}

export function parseDomSchema(el: Element): MotionWorksRegistration | null {
  const json = el.getAttribute("data-motionworks");
  if (json === null || json === "") return null;
  try {
    const value = JSON.parse(json) as unknown;
    return isSchema(value) ? value : null;
  } catch {
    console.warn("[MotionWorks] Invalid data-motionworks JSON.");
    return null;
  }
}

export function parseScriptSchemas(
  doc: Document,
): Array<{ el: HTMLElement; schema: MotionWorksRegistration }> {
  const result: Array<{ el: HTMLElement; schema: MotionWorksRegistration }> =
    [];
  for (const script of Array.from(
    doc.querySelectorAll<HTMLScriptElement>(
      'script[type="application/motionworks+json"]',
    ),
  )) {
    try {
      const schemas = JSON.parse(script.textContent ?? "{}") as unknown;
      if (
        typeof schemas !== "object" ||
        schemas === null ||
        Array.isArray(schemas)
      )
        continue;
      for (const [selector, schema] of Object.entries(schemas))
        if (isSchema(schema))
          for (const el of Array.from(
            doc.querySelectorAll<HTMLElement>(selector),
          ))
            result.push({ el, schema });
    } catch {
      console.warn(
        "[MotionWorks] Invalid application/motionworks+json schema.",
      );
    }
  }
  return result;
}

export function startDomRegistration(): () => void {
  const bridge = getBridge();
  const registered = new Map<
    HTMLElement,
    { id: string; fingerprint: string }
  >();
  const scan = (): void => {
    const desired = new Map<HTMLElement, MotionWorksRegistration>();
    for (const { el, schema } of parseScriptSchemas(document))
      desired.set(el, schema);
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>("[data-motionworks]"),
    )) {
      const schema = parseDomSchema(el);
      if (schema !== null) desired.set(el, schema);
    }

    for (const [el, schema] of desired) {
      const fingerprint = JSON.stringify(schema);
      const existing = registered.get(el);
      if (existing?.fingerprint === fingerprint) continue;
      const slug = slugify(schema.name);
      let id = existing?.id;
      if (id === undefined || !id.startsWith(`${slug}#`)) {
        if (existing !== undefined) bridge.unregister(existing.id, el);
        id = allocateEffectId(slug, el, bridge.getAllNodes());
      }
      registered.set(el, { id, fingerprint });
      bridge.register(id, el, schema);
    }

    for (const [el, entry] of [...registered]) {
      if (desired.has(el)) continue;
      bridge.unregister(entry.id, el);
      registered.delete(el);
    }
  };
  scan();
  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });
  return () => {
    observer.disconnect();
    for (const [el, entry] of registered) bridge.unregister(entry.id, el);
    registered.clear();
  };
}
