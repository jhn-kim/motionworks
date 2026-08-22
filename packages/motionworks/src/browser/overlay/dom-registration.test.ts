import { describe, expect, it } from 'vitest';
import { parseDomSchema, parseScriptSchemas } from './dom-registration.js';
describe('DOM registration', () => {
  it('parses element and script schemas', () => { document.body.innerHTML = '<div class="card" data-motionworks=\'{"name":"Card","params":{"radius":{"type":"spatial-radius"}}}\'></div><script type="application/motionworks+json">{".card":{"name":"Script","params":{}}}</script>'; expect(parseDomSchema(document.querySelector('.card')!)).toMatchObject({ name: 'Card' }); expect(parseScriptSchemas(document)).toHaveLength(1); });
  it('returns null for malformed JSON', () => { const el = document.createElement('div'); el.setAttribute('data-motionworks', '{'); expect(parseDomSchema(el)).toBeNull(); });
});
