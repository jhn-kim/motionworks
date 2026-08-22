# MotionWorks — Runtime Bridge

> **Maintenance rule:** This file defines the live preview loop: how parameter changes from the overlay reach the running effect without touching source files. If the CSS-property contract, event names, or per-library implementation patterns change, edit in place. Do not append. Changes require product owner confirmation.

---

## Purpose

When a designer drags a control, the real effect must respond before the next frame. The live-preview path cannot wait for the daemon, a file write, HMR, or an agent.

MotionWorks uses the browser's style system as that bridge:

```
real stylesheet declaration
        ↓ getComputedStyle
MotionWorks baseline and editing UI
        ↓ element.style.setProperty
live inline CSS value
        ↓ CSS itself or motionworks:change
running effect
```

The daemon participates only in selection, Apply, status, and acknowledgment. No manipulation traffic crosses the network.

---

## CSS Custom-Property Contract

Each schema parameter maps to a CSS property. The default is `--mw-<kebab-key>`; `var` overrides it. The property is declared once in a real source stylesheet on the registered element's rule:

```css
.magnetic-button {
  --mw-radius: 120px;
  --mw-strength: 0.8;
  --mw-response: 0.18;
}
```

On registration, MotionWorks reads `getComputedStyle(element).getPropertyValue(varName)`, decodes it according to the parameter type, and remembers the source unit and prior inline value. If the value cannot be decoded, the binding is marked unbound and live writes become no-ops.

On manipulation, MotionWorks:

1. Encodes the runtime value using the unit originally read from CSS.
2. Calls `element.style.setProperty` for custom properties, or `KeyframeEffect.updateTiming` for an auto-detected animation longhand.
3. Dispatches a bubbling `motionworks:change` CustomEvent.
4. Records the difference from the stylesheet baseline.

Restoring or merely reading a value never dispatches a change event.

---

## Browser Helpers

`motionworks/browser` exports the framework-free API; `motionworks/react` re-exports the same functions.

```ts
import {
  DEFAULT_VAR_PREFIX,
  EVENTS,
  onParamsChange,
  readParam,
  readParams,
  varNameFor,
} from 'motionworks/browser';
```

### `DEFAULT_VAR_PREFIX`

The default custom-property prefix, `--mw-`.

### `varNameFor(key, spec)`

Returns `spec.var` or the default `--mw-<kebab-key>` property.

### `readParam(element, key, spec)`

Reads and decodes one current computed value. It returns the runtime value or `null` when the CSS is absent or unsupported.

### `readParams(element, params)`

Reads every decodable parameter and returns a `Record<string, unknown>` keyed by schema parameter name. Unbound values are omitted.

### `onParamsChange(element, callback)`

Subscribes to `motionworks:change` on the element and returns an unsubscribe function. The event detail includes the schema parameter name, runtime value, and encoded CSS. Effects should normally re-read the full current parameter set because computed values—not event payload accumulation—are the source of truth:

```ts
const sync = () => effect.update(readParams(element, schema.params));
sync();
const stop = onParamsChange(element, sync);
```

This `effect.update` is an application/library method in the example, not a MotionWorks registration callback.

---

## Events

`EVENTS` contains the stable public names:

| Constant | Event | Detail |
|---|---|---|
| `EVENTS.change` | `motionworks:change` | `{ param: string; value: unknown; css: string }` |
| `EVENTS.replay` | `motionworks:replay` | Fresh timestamp |
| `EVENTS.scrub` | `motionworks:scrub` | Playhead position in milliseconds |

All three bubble from the registered element. Replay and scrub are dispatched only for effects that opt into the corresponding capability.

```ts
element.addEventListener(EVENTS.replay, () => replayAnimation());
element.addEventListener(EVENTS.scrub, (event) => {
  seekAnimation((event as CustomEvent<number>).detail);
});
```

Replay must animate only. It must not navigate, submit, mutate business state, or reproduce another behavioral consequence of the real interaction.

---

## Implementation Patterns by Library

The common rule is: declare the canonical value in CSS, read it at initialization, and refresh the library's imperative value when `motionworks:change` fires.

### CSS-native effects

If the effect can consume the custom property directly, no JavaScript subscription is necessary:

```css
.magnetic-button {
  --mw-radius: 120px;
  filter: blur(calc(var(--mw-radius) * 0.02));
}
```

The overlay's inline property is picked up by CSS on the next rendering cycle.

### Framer Motion / Motion

Read the CSS baseline into `MotionValue`s and set them imperatively on change:

```ts
const radius = useMotionValue(0);
const response = useMotionValue(0);

useEffect(() => {
  const element = ref.current;
  if (!element) return;
  const sync = () => {
    const values = readParams(element, schema.params);
    if (typeof values.radius === 'number') radius.set(values.radius);
    if (typeof values.response === 'number') response.set(values.response);
  };
  sync();
  return onParamsChange(element, sync);
}, [radius, response]);
```

Use `MotionValue.set()` or the library's imperative controls; do not route pointer-rate updates through React state.

### GSAP

Refresh a state object or use `gsap.set` without starting a new tween:

```ts
const sync = () => {
  const values = readParams(element, schema.params);
  Object.assign(effectState, values);
  gsap.set(element, {
    '--effect-radius': effectState.radius,
    '--effect-strength': effectState.strength,
  });
};

sync();
const stop = onParamsChange(element, sync);
```

The `--effect-*` properties above are implementation properties. The canonical editable values remain the `--mw-*` declarations read through the schema.

### react-spring

Use the returned imperative API:

```ts
const sync = () => {
  const spring = readParam(element, 'spring', schema.params.spring);
  if (spring) api.start({ config: spring as SpringConfig });
};

sync();
const stop = onParamsChange(element, sync);
```

### WebGL, Three.js, canvas, and custom render loops

Read the CSS values and update cached uniforms or effect state directly:

```ts
const sync = () => {
  const values = readParams(element, schema.params);
  if (typeof values.distortion === 'number') {
    gl.uniform1f(uniformLocations.distortion, values.distortion);
  }
  if (typeof values.radius === 'number') {
    gl.uniform1f(uniformLocations.radius, values.radius);
  }
};

sync();
const stop = onParamsChange(element, sync);
```

Cache expensive handles such as uniform locations during effect initialization. The event handler should remain small enough to complete before the next frame.

---

## Multiple Instances

Each registered DOM instance has its own `slug#n` id and CSS binding. When a designer changes one instance, MotionWorks also previews the value on same-slug sibling elements whose computed baseline equals the selected element's baseline. This preserves coordinated list/card tuning without overwriting an instance that intentionally starts from a different value.

---

## Uncommitted Intent and Restoration

The diff store records real runtime values, not encoded CSS strings:

```text
stylesheet baseline: radius = 120
live preview:        radius = 165
intent:              radius 120 → 165
```

Diffs persist in `localStorage` per page origin. Reloading the page hydrates them and re-applies the `to` value after registration unless the new stylesheet baseline already equals that value.

- **Compare** temporarily applies the baseline through the same live CSS path, then restores the edited value.
- **Discard** restores each property's prior inline state and clears the diff.
- **Apply** retains the intent until the stylesheet reflects the chosen value and reconciliation acknowledges the journal entry.

Stylesheet observers watch added/replaced style and link nodes plus link load events. Refresh removes live inline values, re-reads computed baselines, re-registers, reconciles, and re-applies outstanding intent synchronously.
