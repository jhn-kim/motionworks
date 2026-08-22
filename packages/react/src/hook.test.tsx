import { render } from "@testing-library/react";
import { useRef } from "react";
import { MotionWorksStateManager } from "@motionworks/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getBridge } from "./bridge.js";
import { useMotionWorks } from "./hook.js";

function AnimatedCard({
  update,
}: {
  update?: (p: Record<string, unknown>) => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useMotionWorks(ref, {
    name: "CardEntrance",
    params: {
      radius: { type: "spatial-radius", value: 100, min: 20, max: 400 },
    },
    ...(update !== undefined ? { update } : {}),
  });
  return <div ref={ref} />;
}

function DifferentlyNamedCard(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useMotionWorks(ref, {
    name: "CardEntrance",
    params: { radius: { type: "spatial-radius", value: 100 } },
    update: () => {},
  });
  return <div ref={ref} />;
}

let bridge: ReturnType<typeof getBridge>;
let state: MotionWorksStateManager;

beforeEach(() => {
  bridge = getBridge();
  state = new MotionWorksStateManager();
  bridge.attach(state);
});

afterEach(() => {
  bridge.detach();
});

describe("useMotionWorks — registration lifecycle", () => {
  it("registers with a stable id and unregisters on unmount", () => {
    const { unmount } = render(<AnimatedCard update={() => {}} />);
    const effects = state.getAllEffects();
    expect(effects).toHaveLength(1);
    const id = effects[0]?.id;
    expect(id).toContain("CardEntrance");
    unmount();
    expect(state.getAllEffects()).toHaveLength(0);
  });

  it("uses the same id after unmount + remount (HMR-style)", () => {
    const first = render(<AnimatedCard update={() => {}} />);
    const firstId = state.getAllEffects()[0]?.id;
    first.unmount();
    const second = render(<AnimatedCard update={() => {}} />);
    const secondId = state.getAllEffects()[0]?.id;
    expect(secondId).toBeDefined();
    expect(secondId).toBe(firstId);
    second.unmount();
  });

  it("two differently-named components with the same schema get different ids", () => {
    render(<AnimatedCard update={() => {}} />);
    render(<DifferentlyNamedCard />);
    const ids = state.getAllEffects().map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(2);
  });

  it("registers into the attached state manager with readOnly false", () => {
    render(<AnimatedCard update={() => {}} />);
    const effect = state.getAllEffects()[0];
    expect(effect).toBeDefined();
    expect(effect?.readOnly).toBe(false);
  });

  it("marks the effect readOnly when no update fn is provided (validation rule 4)", () => {
    render(<AnimatedCard />);
    const effect = state.getAllEffects()[0];
    expect(effect?.readOnly).toBe(true);
  });

  it("keeps every instance node hit-testable when one component registers many times", () => {
    render(
      <>
        <AnimatedCard update={() => {}} />
        <AnimatedCard update={() => {}} />
        <AnimatedCard update={() => {}} />
      </>,
    );
    // One effect definition…
    expect(state.getAllEffects()).toHaveLength(1);
    const id = state.getAllEffects()[0]!.id;
    // …but all three DOM instances tracked.
    expect(bridge.getAllNodes().get(id)).toHaveLength(3);
  });

  it("unmounting one instance does not unregister the effect for its siblings", () => {
    const first = render(<AnimatedCard update={() => {}} />);
    const second = render(<AnimatedCard update={() => {}} />);
    const id = state.getAllEffects()[0]!.id;
    first.unmount();
    expect(state.getAllEffects()).toHaveLength(1);
    expect(bridge.getAllNodes().get(id)).toHaveLength(1);
    second.unmount();
    expect(state.getAllEffects()).toHaveLength(0);
  });

  it("fans out update() to every live instance, not just the last registered", () => {
    const calls: string[] = [];
    render(
      <>
        <AnimatedCard update={() => calls.push("a")} />
        <AnimatedCard update={() => calls.push("b")} />
      </>,
    );
    const id = state.getAllEffects()[0]!.id;
    // Manipulating through the state manager must reach BOTH instances —
    // before the fan-out, only the last registration's update() survived.
    state.applyParamChange(id, "radius", 160);
    expect(calls).toContain("a");
    expect(calls).toContain("b");
  });

  it("getNode follows the active instance set by the selection engine", () => {
    render(
      <>
        <AnimatedCard update={() => {}} />
        <AnimatedCard update={() => {}} />
      </>,
    );
    const id = state.getAllEffects()[0]!.id;
    const instances = bridge.getAllNodes().get(id)!;
    expect(bridge.getNode(id)).toBe(instances[0]);
    bridge.setActiveNode(id, instances[1]!);
    expect(bridge.getNode(id)).toBe(instances[1]);
  });

  it("replays pre-attach ops in order (StrictMode register → unregister → register)", () => {
    bridge.detach();
    const node = document.createElement("div");
    const registration = {
      name: "CardEntrance",
      params: { radius: { type: "spatial-radius", value: 100 } },
      update: () => {},
    } as const;
    // StrictMode's double-invoked effect produces exactly this sequence
    // before the provider's lazy chunk has attached.
    bridge.register("X::CardEntrance", node, registration);
    bridge.unregister("X::CardEntrance", node);
    bridge.register("X::CardEntrance", node, registration);
    bridge.attach(state);
    expect(state.getAllEffects()).toHaveLength(1);
    // The node must still be hit-testable — replaying registers before
    // unregisters would leave the effect registered but nodeless.
    expect(bridge.getAllNodes().get("X::CardEntrance")).toEqual([node]);
  });

  it("registrations that arrive before the provider attaches are replayed on attach", () => {
    // Detach first — the fresh mount simulates the app-side hook firing before
    // the provider's lazy chunk has loaded.
    bridge.detach();
    render(<AnimatedCard update={() => {}} />);
    // Registration is pending — state manager has nothing yet.
    expect(state.getAllEffects()).toHaveLength(0);
    // Re-attach: pending registrations flush.
    bridge.attach(state);
    expect(state.getAllEffects()).toHaveLength(1);
    expect(state.getAllEffects()[0]?.name).toBe("CardEntrance");
  });
});
