import type { MotionWorksRegistration } from '../../shared/types.js';
import { getBridge } from '../bridge.js';

export function parseDomSchema(el: Element): MotionWorksRegistration | null {
  const json = el.getAttribute('data-motionworks');
  if (json === null || json === '') return null;
  try { const value = JSON.parse(json) as MotionWorksRegistration; return typeof value?.name === 'string' && typeof value?.params === 'object' ? value : null; } catch { console.warn('[MotionWorks] Invalid data-motionworks JSON.'); return null; }
}

export function parseScriptSchemas(doc: Document): Array<{ el: HTMLElement; schema: MotionWorksRegistration }> {
  const result: Array<{ el: HTMLElement; schema: MotionWorksRegistration }> = [];
  for (const script of Array.from(doc.querySelectorAll<HTMLScriptElement>('script[type="application/motionworks+json"]'))) {
    try { const schemas = JSON.parse(script.textContent ?? '{}') as Record<string, MotionWorksRegistration>; for (const [selector, schema] of Object.entries(schemas)) for (const el of Array.from(doc.querySelectorAll<HTMLElement>(selector))) result.push({ el, schema }); } catch { console.warn('[MotionWorks] Invalid application/motionworks+json schema.'); }
  }
  return result;
}

export function startDomRegistration(): () => void {
  const bridge = getBridge();
  const registered = new Map<HTMLElement, string>();
  let counter = 0;
  const scan = (): void => {
    const pairs = [...Array.from(document.querySelectorAll<HTMLElement>('[data-motionworks]')).flatMap((el) => { const schema = parseDomSchema(el); return schema === null ? [] : [{ el, schema }]; }), ...parseScriptSchemas(document)];
    for (const { el, schema } of pairs) if (!registered.has(el)) { const slug = schema.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'effect'; const id = `${slug}#${String(++counter)}`; registered.set(el, id); bridge.register(id, el, schema); }
    for (const [el, id] of [...registered]) if (!el.isConnected) { bridge.unregister(id, el); registered.delete(el); }
  };
  scan();
  const observer = new MutationObserver(scan); observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-motionworks'] });
  return () => { observer.disconnect(); for (const [el, id] of registered) bridge.unregister(id, el); registered.clear(); };
}
