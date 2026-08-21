import { describe, expect, it } from 'vitest';

import { findInteractiveNode } from './dom-selector.js';

function build(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

describe('findInteractiveNode', () => {
  it('returns the node itself when it is a button', () => {
    const host = build('<button id="b">Add</button>');
    const button = host.querySelector('button')!;
    expect(findInteractiveNode(button)).toBe(button);
  });

  it('walks up from a decorative child to the enclosing interactive element', () => {
    const host = build('<a href="#"><span id="underline">Tabletop</span></a>');
    const span = host.querySelector<HTMLElement>('#underline')!;
    expect(findInteractiveNode(span)).toBe(host.querySelector('a'));
  });

  it('matches role="button" elements', () => {
    const host = build('<div role="button"><span id="inner">Go</span></div>');
    const span = host.querySelector<HTMLElement>('#inner')!;
    expect(findInteractiveNode(span)).toBe(host.querySelector('[role="button"]'));
  });

  it('returns null for nodes with no interactive ancestor', () => {
    const host = build('<div><span id="plain">Just text</span></div>');
    expect(findInteractiveNode(host.querySelector<HTMLElement>('#plain')!)).toBeNull();
  });

  it('returns null for null input', () => {
    expect(findInteractiveNode(null)).toBeNull();
  });

  it('ignores anchors without href', () => {
    const host = build('<a><span id="s">Not a link</span></a>');
    expect(findInteractiveNode(host.querySelector<HTMLElement>('#s')!)).toBeNull();
  });
});
