# @motionworks/core

Framework agnostic core for [MotionWorks](https://github.com/jhn-kim/motionworks), a direct manipulation motion design layer for projects built with AI coding agents.

This package holds the shared contract: schema types, parameter validation, state management, and the WebSocket bridge server that connects the in-app overlay to agent tooling. Framework wrappers build on it; see [`@motionworks/react`](https://www.npmjs.com/package/@motionworks/react).

Most users should install a framework wrapper rather than depending on this package directly.
