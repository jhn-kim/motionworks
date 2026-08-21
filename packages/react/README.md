# @motionworks/react

React bindings for [MotionWorks](https://github.com/jhn-kim/motionworks), a direct manipulation motion design layer for projects built with AI coding agents. An agent generates a motion effect; MotionWorks overlays the running app so a designer can select the real element, adjust parameters live, replay the animation, and send refined values back to the agent for source writeback.

## Install

```bash
npm install @motionworks/react
```

Requires React 19.

## Quickstart

Register an effect so it becomes selectable and tunable in the overlay:

```tsx
import { useRef, useEffect } from "react";
import { useMotionWorks } from "@motionworks/react";

const FOLLOW_RESPONSE = 0.15;

function FollowCard() {
  const ref = useRef<HTMLDivElement>(null);

  useMotionWorks(ref, {
    name: "FollowCard",
    params: {
      response: {
        type: "temporal-response",
        value: FOLLOW_RESPONSE,
        min: 0.01,
        max: 1,
        label: "Response",
      },
    },
    update: (next) => {
      /* apply next.response to the live effect */
    },
    sourceHints: {
      response: { file: "src/FollowCard.tsx", variable: "FOLLOW_RESPONSE" },
    },
  });

  return <div ref={ref}>…</div>;
}
```

## Agent integration

Pair with [`@motionworks/mcp`](https://www.npmjs.com/package/@motionworks/mcp) so a coding agent (e.g. Claude Code) receives the designer's refinements and writes them back to source.
