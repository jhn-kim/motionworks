# MotionWorks — Runtime Bridge

> **Maintenance rule:** This file defines the live preview loop: how parameter changes from the overlay reach the running effect without touching source files. If the update() contract, the reserved parameter keys, or the per-library implementation patterns change, edit in place. Do not append. Changes require product owner confirmation.

---

## Purpose

When the designer drags a manipulation surface handle, the motion effect must update immediately — in real time, on the live running product, without any file write, without any network round-trip, without any page reload.

This is the "feel" loop. It is what makes MotionWorks feel different from a chat interface. The difference between 0.15 and 0.2 on a lerp factor is not describable in words; it has to be felt by manipulating and watching. Latency in this loop breaks the experience.

This file describes how that loop works: the `update()` function contract, the constraints on implementations, and patterns for each major animation library.

---

## The `update()` Contract

Every `useMotionWorks` registration must include an `update` function:

```ts
update: (newParams: Record<string, unknown>) => void
```

**Constraints — these are hard requirements, not suggestions:**

1. **Synchronous.** `update()` must be synchronous. It cannot return a Promise, cannot `await`, cannot schedule a microtask. It is called on every pointer move event; async behavior breaks the 60fps feel.

2. **Immediate.** The visual effect must change before the next frame. If `update()` takes more than ~4ms, the overlay will feel laggy.

3. **Partial updates.** `update()` receives only the params that changed in a given event, not the full set. Example: if the designer is dragging the radius handle, `update({ radius: 145 })` is called — not `update({ distortion: 0.8, radius: 145, trail: 0.6 })`. The implementation must not reset other params to defaults when a partial update is received. Merge new values into current state; do not replace.

4. **Idempotent.** Calling `update({ radius: 145 })` twice in a row must produce the same result as calling it once.

5. **No side effects.** `update()` must not trigger network requests, log to the console, or cause any React re-renders outside the effect's own animation system. It should only mutate the state the effect uses to compute its next frame.

---

## Reserved Parameter Keys

MotionWorks uses a small set of reserved keys in the `update()` call for global surfaces. Effects that support these should handle them; effects that don't should ignore them silently.

| Key | Type | Description |
|---|---|---|
| `__motionworksScrub` | `number` | Current playhead position in milliseconds. Effect should freeze at this time offset. |
| `__motionworksActive` | `boolean` | Whether the overlay is active. Effects can use this to pause/resume internal tickers. |

No effect is required to handle reserved keys. Ignoring them is the safe default.

---

## Implementation Patterns by Library

### CSS Custom Properties

The simplest approach. Define effect parameters as CSS custom properties and update them via JavaScript.

```ts
// In the component
const DISTORTION_STRENGTH = 0.8;
const INFLUENCE_RADIUS = 120;

// In the update function
update: (newParams) => {
  if (newParams.distortion !== undefined) {
    ref.current!.style.setProperty('--distortion', String(newParams.distortion));
  }
  if (newParams.radius !== undefined) {
    ref.current!.style.setProperty('--radius', `${newParams.radius}px`);
  }
}
```

CSS custom property updates are synchronous and picked up by the browser's rendering pipeline on the next frame. This is the lowest-latency approach available. Use it wherever the animation logic lives in CSS.

---

### Framer Motion (`motion` components, `useMotionValue`)

Framer Motion's `MotionValue` is the right target — it updates without triggering React re-renders.

```ts
// In the component
const distortion = useMotionValue(DISTORTION_STRENGTH);
const radius = useMotionValue(INFLUENCE_RADIUS);

// Pass these to the effect or to a motion component's style prop
// ...

// In the update function
update: (newParams) => {
  if (newParams.distortion !== undefined) distortion.set(newParams.distortion as number);
  if (newParams.radius !== undefined)     radius.set(newParams.radius as number);
}
```

**Do not** use React `useState` or `useReducer` for live preview values. State updates trigger a re-render cycle that adds ~4–8ms of latency per event. `MotionValue.set()` is synchronous and bypasses React's reconciler.

For spring configurations (`stiffness`, `damping`), use Framer Motion's `useSpring` and pass the `MotionValue` as input. Updating the spring config mid-animation requires using the animation controls API:

```ts
const controls = useAnimation();

update: (newParams) => {
  if (newParams.spring) {
    controls.start({
      x: 0,
      transition: { type: 'spring', ...newParams.spring }
    });
  }
}
```

---

### GSAP

GSAP tweens can be updated mid-animation using `gsap.to()` with a duration of 0, or by directly mutating the target object.

```ts
// Keep a reference to the effect target object
const state = { distortion: DISTORTION_STRENGTH, radius: INFLUENCE_RADIUS };

// Apply the effect using state
const tween = gsap.to(elementRef.current, {
  // ... using state.distortion, state.radius
});

update: (newParams) => {
  Object.assign(state, newParams);
  // For immediate visual update without starting a new tween:
  gsap.set(elementRef.current, {
    // Map state values to the CSS/SVG attributes the effect uses
    '--distortion': state.distortion,
    '--radius': state.radius,
  });
}
```

For shader-based GSAP effects, see the WebGL section below.

---

### react-spring

react-spring's `useSpring` hook can be updated imperatively using the returned `api` object.

```ts
const [springs, api] = useSpring(() => ({
  stiffness: SPRING_STIFFNESS,
  damping: SPRING_DAMPING,
}));

update: (newParams) => {
  if (newParams.spring) {
    api.start({ config: newParams.spring as SpringConfig });
  }
}
```

`api.start()` is non-blocking and updates the spring configuration immediately. The animation adjusts on the next frame.

---

### WebGL / Shaders

WebGL effects expose parameters as GLSL uniforms. The `update()` function must write to the uniform directly.

```ts
// Keep a reference to the WebGL context and program
const glRef = useRef<{ gl: WebGLRenderingContext; program: WebGLProgram } | null>(null);

update: (newParams) => {
  if (!glRef.current) return;
  const { gl, program } = glRef.current;

  if (newParams.distortion !== undefined) {
    const loc = gl.getUniformLocation(program, 'u_distortion');
    gl.uniform1f(loc, newParams.distortion as number);
  }
  if (newParams.radius !== undefined) {
    const loc = gl.getUniformLocation(program, 'u_radius');
    gl.uniform1f(loc, newParams.radius as number);
  }
  // The render loop picks up the new uniform values on the next frame.
}
```

**Performance note:** `gl.getUniformLocation` has some overhead. Cache uniform locations at effect initialization rather than looking them up on every `update()` call:

```ts
// At initialization:
const uniformLocations = {
  distortion: gl.getUniformLocation(program, 'u_distortion'),
  radius:     gl.getUniformLocation(program, 'u_radius'),
};

// In update():
update: (newParams) => {
  if (newParams.distortion !== undefined) {
    gl.uniform1f(uniformLocations.distortion, newParams.distortion as number);
  }
}
```

---

### Three.js / custom render loops

Same principle as WebGL: mutate the material or object property directly. Three.js materials update on the next render loop tick.

```ts
const materialRef = useRef<THREE.ShaderMaterial | null>(null);

update: (newParams) => {
  if (!materialRef.current) return;
  if (newParams.distortion !== undefined) {
    materialRef.current.uniforms.uDistortion.value = newParams.distortion;
  }
}
```

---

## Uncommitted Change Tracking

Every call to `update()` from a manipulation event produces a delta from the baseline (the value in the registered schema at the time of last HMR). MotionWorks tracks this delta:

```
Registered (baseline): distortion = 0.8, radius = 120
After manipulation:     distortion = 0.8, radius = 165
Delta (uncommitted):    radius: 120 → 165
```

The overlay renders a visual indicator when uncommitted changes exist (a dot or badge on the effect name label). This communicates to the designer that their changes have not yet been written to source.

When the designer clicks "Apply," the uncommitted delta is packaged and sent to the MCP bridge for the agent to commit. See `SOURCE_SYNC.md` for the full commit flow.

Uncommitted changes are discarded without warning if:
- The designer selects "Discard" explicitly
- A new `useMotionWorks` registration arrives with the same effect ID and its values match the designer's committed choices (meaning the agent already wrote the changes and HMR brought them in)

Uncommitted changes survive HMR reloads. See `OVERLAY.md` for the HMR strategy.
