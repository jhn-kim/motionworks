import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  DEFAULT_VAR_PREFIX,
  EVENTS,
  onParamsChange,
  readParam,
  readParams,
  varNameFor,
} from "./css-bindings.js";
import { OverlayRenderer } from "./overlay/renderer.js";

export interface MountOptions {
  daemonUrl?: string;
  debug?: boolean;
}

let root: Root | null = null;

export function mount(options: MountOptions = {}): Root {
  if (root !== null) return root;
  const container = document.createElement("div");
  container.setAttribute("data-motionworks-root", "");
  document.body.appendChild(container);
  root = createRoot(container);
  root.render(createElement(OverlayRenderer, options));
  return root;
}

export {
  DEFAULT_VAR_PREFIX,
  EVENTS,
  onParamsChange,
  readParam,
  readParams,
  varNameFor,
};

const api = {
  mount,
  DEFAULT_VAR_PREFIX,
  EVENTS,
  onParamsChange,
  readParam,
  readParams,
  varNameFor,
};
Object.assign(window as typeof window & { MotionWorks?: typeof api }, {
  MotionWorks: api,
});

const script = document.currentScript as HTMLScriptElement | null;
if (script?.dataset.autoMount !== "false") {
  const daemonUrl = script?.src
    ? (() => {
        const url = new URL(script.src);
        const token = url.searchParams.get("token");
        return `${url.origin}${token === null ? "" : `?token=${encodeURIComponent(token)}`}`;
      })()
    : undefined;
  const autoMount = (): void => {
    mount({ daemonUrl });
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", autoMount, { once: true });
  else autoMount();
}
