// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { MotionWorksStateManager } from '../shared/state.js';
import { getBridge } from './bridge.js';
import { useMotionWorks } from './hook.js';

function Fixture(): React.JSX.Element { const ref = createRef<HTMLDivElement>(); useMotionWorks(ref, { name: 'Card', params: { radius: { type: 'spatial-radius' } } }); return <div ref={ref} style={{ '--mw-radius': '100px' } as React.CSSProperties} />; }
afterEach(() => getBridge().detach());
describe('useMotionWorks', () => {
  it('registers a CSS baseline and unregisters on unmount', () => {
    const state = new MotionWorksStateManager(); getBridge().attach(state); const view = render(<Fixture />);
    expect(state.getAllEffects()[0]?.params.radius?.value).toBe(100);
    view.unmount(); expect(state.getAllEffects()).toHaveLength(0);
  });
});
