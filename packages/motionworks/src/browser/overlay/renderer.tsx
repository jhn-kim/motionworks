import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import type { ParameterType } from "../../shared/index.js";

import { getBridge } from "../bridge.js";
import { findInteractiveNode } from "../dom-selector.js";
import { startAutoDetect } from "./auto-detect.js";
import { startDomRegistration } from './dom-registration.js';
import { CanvasLayer } from "./canvas-layer.js";
import { OverlaySessionContext, useOverlaySession } from "./context.js";
import { type ArmedTool } from "./cursor-tool.js";
import { humanizeEffectName } from "./display-name.js";
import { ElementsPanel, LayersPanel, scopedEffects } from "./global-panels.js";
import { NodeHighlight } from "./highlight.js";
import { useConnection, useSessionState } from "./hooks.js";
import { ActivationReveal } from "./reveal.js";
import { curveForType } from "./scale.js";
import { Scrubber } from "./scrubber.js";
import { SelectionEngine } from "./selection.js";
import { OverlaySession } from "./session.js";
import { SvgLayer } from "./svg-layer.js";
import { GLASS, RESERVED_KEYS, SPRING_SURFACE } from "./theme.js";
import { FamilySliderPanel, type PanelItem } from "./family-panel.js";
import {
  sliderBoundsFor,
  ToolkitTypePanel,
  type PanelParamEntry,
} from "./toolkit-panels.js";
import { ICONS, Toolbox, type Tool } from "./toolbox.js";

export interface OverlayRendererProps {
  port?: number;
  daemonUrl?: string;
  debug?: boolean;
}

const DEFAULT_PORT = 52340;

// Everything below runs in the overlay's own React root (see
// MotionWorksProvider). It owns the OverlaySession — the state manager,
// diff store, and daemon client — and renders three portal layers on top of
// the app.
export function OverlayRenderer({
  port = DEFAULT_PORT,
  daemonUrl = `http://127.0.0.1:${String(port)}`,
  debug = false,
}: OverlayRendererProps): React.JSX.Element | null {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const sessionRef = useRef<OverlaySession | null>(null);

  if (sessionRef.current === null) {
    sessionRef.current = new OverlaySession({ daemonUrl, debug });
  }
  const session = sessionRef.current;

  useEffect(() => {
    // Container is created imperatively so it survives HMR of the provider
    // (which would otherwise unmount + remount the portal target).
    const div = document.createElement("div");
    div.setAttribute("data-motionworks-overlay", "");
    div.style.cssText =
      "position:fixed;inset:0;pointer-events:none;z-index:9997;";
    document.body.appendChild(div);
    setContainer(div);
    return () => {
      div.remove();
    };
  }, []);

  useEffect(() => {
    session.start();
    return () => session.stop();
  }, [session]);

  if (container === null) return null;

  return createPortal(
    <OverlaySessionContext.Provider value={session}>
      <OverlayShell />
    </OverlaySessionContext.Provider>,
    container,
  );
}

// Split out so the hit-test hooks can be inside the session context
// provider.
function OverlayShell(): React.JSX.Element {
  // closed → open → closing → closed. Closing plays the mirror of the open
  // morph: the chip shrinks back into the launcher square at center, then
  // the launcher mounts there and glides home to the corner.
  const [phase, setPhase] = useState<"closed" | "open" | "closing">("closed");
  // Which screen edge the toolkit (and launcher) anchors to. Mirrored
  // anatomy at the top; changed only by dragging the bar.
  const [dock, setDock] = useState<"bottom" | "top">("bottom");
  const active = phase === "open";
  const session = useOverlaySession();
  const connected = useConnection();
  const requestClose = (): void => {
    setPhase((p) => (p === "open" ? "closing" : p));
  };
  useEffect(() => {
    if (phase !== "closing") return;
    // Closing the toolkit ends the editing session: drop the selection so
    // the next open starts clean. (sessionStorage-based restore remains for
    // its real purpose — surviving HMR reloads mid-session.)
    session.selectEffect(null);
    // The chip shrinks WHILE traveling to the corner; the launcher then
    // mounts in place there — no second glide.
    const timer = window.setTimeout(() => {
      setPhase("closed");
    }, 270);
    return () => {
      clearTimeout(timer);
    };
  }, [phase]);
  const state = useSessionState();
  const selectedEffect = useMemo(
    () => state.effects.find((e) => e.id === state.selectedEffectId) ?? null,
    [state.effects, state.selectedEffectId],
  );

  // Activation is click-driven: the floating logo square opens the toolkit,
  // clicking the logo again (or Escape) closes it. No hotkeys.
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The container stays pointer-events: none even while active — the app
  // underneath must keep receiving hover/move events so its animations play
  // exactly as they do with MotionWorks off. Selection works anyway: the
  // SelectionEngine listens at the document level (capture phase) and only
  // clicks are intercepted there. Interactive overlay pieces (toolbox,
  // scrubber, menus) opt into pointer events individually.

  // While the overlay is active, CSS keyframe animations are auto-registered
  // as named, selectable, tunable effects (see auto-detect.ts).
  useEffect(() => {
    if (!active) return;
    const stopAuto = startAutoDetect();
    const stopDom = startDomRegistration();
    return () => { stopAuto(); stopDom(); };
  }, [active]);

  useEffect(() => {
    session.daemon.setActive(active);
  }, [active, session]);

  // Parameter manipulation lives in the toolkit (DynamicToolbox); selection
  // highlight comes from the SelectionEngine. The canvas/SVG layers are not
  // mounted globally — spatial editors that need the element itself as the
  // control surface (path) mount them scoped from inside the toolbox.
  return (
    <>
      <SelectionEngine
        active={active}
        selectedEffectId={selectedEffect?.id ?? null}
      />
      {/* Remounts per activation, so the inventory flash replays each time
          the toolkit opens. */}
      {active ? <ActivationReveal /> : null}
      <Scrubber active={active} selectedEffect={selectedEffect} />
      {phase !== "closed" ? (
        <DynamicToolbox
          selectedEffect={selectedEffect}
          closing={phase === "closing"}
          dock={dock}
          onDockChange={setDock}
          onClose={requestClose}
        />
      ) : (
        <Launcher
          dock={dock}
          connected={connected}
          onDockChange={setDock}
          onOpen={() => {
            // Every open starts clean — a selection lingering in
            // sessionStorage from before a reload must not resurrect here.
            // (HMR restore still works while the toolkit stays open.)
            session.selectEffect(null);
            setPhase("open");
          }}
        />
      )}
    </>
  );
}

// Tool metadata for each MotionWorks parameter type. Keyed by ParameterType so
// filtering the selected effect's params (which carry a `type` field) maps
// straight into the tool list — no separate registry to maintain.
const TYPE_TOOL_META: Record<
  ParameterType,
  { label: string; icon: React.ReactNode }
> = {
  "spatial-radius": { label: "Spatial radius", icon: ICONS.spatialRadius },
  "spatial-strength": {
    label: "Spatial strength",
    icon: ICONS.spatialStrength,
  },
  "temporal-decay": { label: "Temporal decay", icon: ICONS.temporalDecay },
  "temporal-response": {
    label: "Temporal response",
    icon: ICONS.temporalResponse,
  },
  "spring-response": { label: "Spring response", icon: ICONS.springResponse },
  gradient: { label: "Gradient", icon: ICONS.gradient },
  path: { label: "Path", icon: ICONS.path },
  stagger: { label: "Stagger", icon: ICONS.stagger },
  duration: { label: "Duration", icon: ICONS.duration },
  "easing-curve": { label: "Easing curve", icon: ICONS.easingCurve },
  scalar: { label: "Scalar", icon: ICONS.scalar },
};

// Succinct hover explanations (≤6 words) for the parameter tools inside
// family panels. Spring axes carry their own.
const TOOL_HINTS: Partial<Record<ParameterType, string>> = {
  "spatial-radius": "How far the effect reaches",
  "spatial-strength": "How hard it pushes and pulls",
  "temporal-decay": "How slowly the trail fades",
  "temporal-response": "How quickly it follows input",
  gradient: "The colors along the motion",
  path: "The route the element travels",
  stagger: "The delay between each element",
  duration: "How long the motion runs",
  "easing-curve": "How it speeds up and settles",
  scalar: "An amount specific to this effect",
};

const AXIS_HINTS = {
  stiffness: "Snappier, more energetic",
  damping: "Calmer settle, less wobble",
  mass: "Weight and momentum",
} as const;

// Parameter families: the toolbar shows these four fixed buttons instead of
// one icon per type. The scaffold never changes shape — a family with no
// params on the current selection renders disabled, not hidden — so the
// designer builds spatial memory while the panel contents stay contextual.
type Family = "space" | "feel" | "time" | "style";

const FAMILY_ORDER: Family[] = ["space", "feel", "time", "style"];

const FAMILY_META: Record<
  Family,
  { label: string; icon: React.ReactNode; types: ParameterType[] }
> = {
  space: {
    label: "Space — radius, strength, path",
    icon: ICONS.familySpace,
    types: ["spatial-radius", "spatial-strength", "path"],
  },
  feel: {
    label: "Feel — springs, easing, response",
    icon: ICONS.familyFeel,
    types: [
      "spring-response",
      "easing-curve",
      "temporal-response",
      "temporal-decay",
    ],
  },
  // Time is the existing choreography panel: every timing param in the
  // selection scope, editable in one place.
  time: {
    label: "Time — durations & stagger",
    icon: ICONS.choreography,
    types: ["duration", "stagger"],
  },
  style: {
    label: "Style — color & extras",
    icon: ICONS.familyStyle,
    types: ["gradient", "scalar"],
  },
};

interface DynamicToolboxProps {
  selectedEffect: ReturnType<typeof useSessionState>["effects"][number] | null;
  closing?: boolean;
  dock: "bottom" | "top";
  onDockChange: (dock: "bottom" | "top") => void;
  onClose: () => void;
}

function DynamicToolbox({
  selectedEffect,
  closing = false,
  dock,
  onDockChange,
  onClose,
}: DynamicToolboxProps): React.JSX.Element {
  const session = useOverlaySession();

  // Which family's slider panel is expanded (one at a time), and which
  // non-scalar editor (gradient / easing curve / path) is showing.
  const [openFamily, setOpenFamily] = useState<Family | null>(null);
  const [openEditor, setOpenEditor] = useState<ParameterType | null>(null);
  // Baseline comparison. A toggle (not a pointer hold): hover- and
  // press-triggered animations need the mouse free to trigger them while
  // comparing, so the button flips state and the B key acts as a
  // hold-to-compare with the pointer elsewhere.
  const [comparing, setComparing] = useState(false);

  const effectId = selectedEffect?.id ?? null;
  useEffect(() => {
    setComparing(false);
    // Everything tool-shaped resets on selection change — panel, editor,
    // and the layers list all belong to the previous selection.
    setOpenFamily(null);
    setOpenEditor(null);
    setShowLayers(false);
  }, [effectId]);

  // Escape closes the family panel/editor before it closes the toolkit.
  useEffect(() => {
    if (openFamily === null && openEditor === null) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpenFamily(null);
      setOpenEditor(null);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
    };
  }, [openFamily, openEditor]);

  useEffect(() => {
    if (!comparing || effectId === null) return;
    session.holdBaseline(effectId, true);
    return () => {
      session.holdBaseline(effectId, false);
    };
  }, [comparing, effectId, session]);

  // Global (selection-independent) modes.
  const [showLayers, setShowLayers] = useState(false);

  // Element being hovered in the nothing-selected browse list — highlighted
  // on the page so the list entries and the live elements read as one thing.
  const [browseHover, setBrowseHover] = useState<{
    node: HTMLElement;
    label: string;
  } | null>(null);

  // Live drags only surface via the diff store's `to`; type overrides only
  // via the override store. Subscribe to both so the panels re-render with
  // fresh values (same pattern the SVG layer used).
  useSyncExternalStore(
    (l) => session.diffs.subscribe(l),
    () => session.diffs.getVersion(),
    () => 0,
  );
  useSyncExternalStore(
    (l) => session.typeOverrides.subscribe(l),
    () => session.typeOverrides.getVersion(),
    () => 0,
  );

  // Params grouped by their effective (override-aware) type.
  const entriesByType = new Map<ParameterType, PanelParamEntry[]>();
  if (selectedEffect !== null) {
    const diff = session.diffs.getDiff(selectedEffect.id);
    for (const [paramKey, param] of Object.entries(selectedEffect.params)) {
      const effectiveType =
        session.resolvedType(selectedEffect.id, paramKey) ?? param.type;
      const paramDiff = diff[paramKey];
      const liveValue = paramDiff !== undefined ? paramDiff.to : param.value;
      const list = entriesByType.get(effectiveType) ?? [];
      list.push({ paramKey, param, liveValue });
      entriesByType.set(effectiveType, list);
    }
  }

  const hasDiff =
    selectedEffect !== null && session.diffs.hasDiff(selectedEffect.id);
  const hasPendingCorrections =
    selectedEffect !== null && session.hasPendingCorrections(selectedEffect.id);

  const sessionState = useSessionState();
  const scoped =
    selectedEffect === null
      ? []
      : scopedEffects(sessionState.effects, selectedEffect.id, (id, key) =>
          session.resolvedType(id, key),
        );
  const timingInScope = scoped.some((e) => e.timingParams.length > 0);
  const effectCount = sessionState.effects.length;

  const tools = useMemo<Tool[]>(() => {
    const hasSelection = selectedEffect !== null;
    // Progressive disclosure: the chip only ever shows what is currently
    // meaningful. Logo (close) always; navigation and parameter tools once
    // something is selected; apply/discard/compare only once there are
    // actual changes to act on.
    const result: Tool[] = [
      {
        id: "logo",
        label: "Close MotionWorks",
        kind: "action",
        icon: ICONS.logo,
        selected: false,
        onClick: onClose,
      },
    ];

    // In-time verbs live in their own right-hand section. Order: apply,
    // discard, play, compare. While a family panel or editor is open the
    // verbs are ALWAYS present — as disabled ghosts until a change exists —
    // so the bar's width is frozen for the whole editing session and the
    // first edit lights them up in place instead of shifting the layout.
    const editing = openFamily !== null || openEditor !== null;
    const verbsVisible =
      hasSelection && (hasDiff || hasPendingCorrections || editing);
    const verbsLive = hasSelection && (hasDiff || hasPendingCorrections);
    // Replay: a capability-declared replay wins (the effect re-runs itself
    // via the reserved key). Otherwise, effects on clickable elements get a
    // simulated press — selection swallows genuine clicks, so this is the
    // only way to watch press/click animations while the overlay is open.
    const replayCapable = selectedEffect?.capabilities?.replay === true;
    const pressTarget =
      !replayCapable && selectedEffect !== null
        ? findInteractiveNode(getBridge().getNode(selectedEffect.id) ?? null)
        : null;
    if (selectedEffect !== null && (replayCapable || pressTarget !== null)) {
      result.push({
        id: "replay",
        label: replayCapable
          ? "Play animation"
          : "Play animation — simulates a press",
        kind: "verb",
        icon: ICONS.replay,
        selected: false,
        onClick: () => {
          if (replayCapable) {
            session.sendReserved(
              selectedEffect.id,
              RESERVED_KEYS.replay,
              Date.now(),
            );
          } else {
            session.replayInteraction(selectedEffect.id);
          }
        },
      });
    }
    if (verbsVisible) {
      result.push({
        id: "compare",
        label: !verbsLive
          ? "Compare — make a change first"
          : comparing
            ? "Showing original — click to see your changes"
            : "Compare with original",
        kind: "verb",
        icon: comparing ? ICONS.compareActive : ICONS.compare,
        disabled: !verbsLive,
        selected: comparing,
        onClick: () => {
          setComparing((v) => !v);
        },
      });
    }
    if (verbsVisible) {
      result.push(
        {
          id: "garbage",
          label: verbsLive
            ? "Discard changes"
            : "Discard — make a change first",
          kind: "verb",
          icon: ICONS.garbage,
          tint: "rgb(255, 118, 108)",
          hoverColor: "rgb(255, 158, 148)",
          disabled: !verbsLive,
          selected: false,
          onClick: () => {
            session.discard(selectedEffect.id);
          },
        },
        {
          id: "apply",
          label: verbsLive ? "Apply changes" : "Apply — make a change first",
          kind: "verb",
          icon: ICONS.apply,
          tint: "rgb(126, 224, 140)",
          hoverColor: "rgb(168, 242, 180)",
          disabled: !verbsLive,
          selected: false,
          onClick: () => {
            session.commit(selectedEffect.id);
          },
        },
      );
    }

    // Layers/browse is always present: with a selection it scopes to the
    // nested animations; without one it lists every animation on the page.
    result.push({
      id: "layers",
      label: hasSelection
        ? "Layers — animations in this selection"
        : "Animations on this page",
      kind: "action",
      icon: ICONS.layers,
      disabled: effectCount === 0,
      selected: showLayers,
      onClick: () => {
        // Layers and tool panels are either/or — never both open.
        setOpenFamily(null);
        setOpenEditor(null);
        setShowLayers((v) => !v);
      },
    });

    // The four parameter families are a fixed scaffold shown from the moment
    // the toolkit opens: always the same buttons in the same order, disabled
    // (never hidden) until a selection provides params in that family.
    // Clicking one opens its tool drawer; the family also reads active while
    // its drawer is open, one of its tools is armed, or an editor is showing.
    const presentTypes = new Set<ParameterType>();
    if (hasSelection) {
      for (const [paramKey, param] of Object.entries(selectedEffect.params)) {
        presentTypes.add(
          session.resolvedType(selectedEffect.id, paramKey) ?? param.type,
        );
      }
    }
    for (const family of FAMILY_ORDER) {
      const meta = FAMILY_META[family];
      const present =
        hasSelection &&
        (family === "time"
          ? timingInScope
          : meta.types.some((t) => presentTypes.has(t)));
      const familyActive =
        openFamily === family ||
        (openEditor !== null && meta.types.includes(openEditor));
      result.push({
        id: family,
        label: hasSelection
          ? meta.label
          : `${meta.label} — select an element to unlock`,
        kind: "type",
        icon: meta.icon,
        disabled: !present,
        selected: present && familyActive,
        onClick: () => {
          setShowLayers(false);
          // Any open editor (easing / gradient / path) belongs to the
          // family panel it was opened from — switching or closing the
          // family closes it too.
          setOpenEditor(null);
          setOpenFamily((f) => (f === family ? null : family));
        },
      });
    }

    return result;
  }, [
    selectedEffect,
    session,
    openFamily,
    openEditor,
    hasDiff,
    hasPendingCorrections,
    comparing,
    showLayers,
    effectCount,
    timingInScope,
    onClose,
  ]);

  // ── Family panel contents ───────────────────────────────────────────────
  // Icon + slider per tool; toggles and editor rows for the rest.
  const buildPanelItems = (family: Family): PanelItem[] => {
    if (selectedEffect === null) return [];
    const items: PanelItem[] = [];

    if (family === "time") {
      // Timing tools cover the whole selection scope (nested animations
      // included). Rows lead with the fixed tool name; the agent's label
      // (and owning animation) only appears when several params share a
      // type and need telling apart.
      const timeTypeCounts = new Map<ParameterType, number>();
      for (const { effect, timingParams } of scoped) {
        for (const paramKey of timingParams) {
          if (effect.params[paramKey] === undefined) continue;
          const type =
            session.resolvedType(effect.id, paramKey) ??
            effect.params[paramKey]!.type;
          timeTypeCounts.set(type, (timeTypeCounts.get(type) ?? 0) + 1);
        }
      }
      for (const { effect, timingParams } of scoped) {
        for (const paramKey of timingParams) {
          const param = effect.params[paramKey];
          if (param === undefined) continue;
          const type = session.resolvedType(effect.id, paramKey) ?? param.type;
          const bounds = sliderBoundsFor(param, type);
          const own = effect.id === selectedEffect.id;
          const agentLabel = param.label ?? paramKey;
          const tool: ArmedTool = {
            effectId: effect.id,
            paramKey,
            label:
              (timeTypeCounts.get(type) ?? 0) === 1
                ? TYPE_TOOL_META[type].label
                : own
                  ? agentLabel
                  : `${humanizeEffectName(effect.name)} · ${agentLabel}`,
            unit: param.unit,
            spec: {
              min: bounds.min,
              max: bounds.max,
              curve: curveForType(type),
            },
            type,
          };
          items.push({
            kind: "slider",
            tool,
            icon: TYPE_TOOL_META[type].icon,
            hint: TOOL_HINTS[type] ?? "",
          });
        }
      }
      return items;
    }

    const editorTypesAdded = new Set<ParameterType>();
    for (const type of FAMILY_META[family].types) {
      for (const entry of entriesByType.get(type) ?? []) {
        // Tool names lead. The agent's label steps in when the effect
        // registers several params of the same type (two "Duration" rows
        // would be ambiguous) — and always for scalar, the semantics-free
        // type where the agent's word is the only thing that says what
        // the value actually does.
        const solo = (entriesByType.get(type) ?? []).length === 1;
        const label =
          solo && type !== "scalar"
            ? TYPE_TOOL_META[type].label
            : (entry.param.label ?? entry.paramKey);
        if (type === "gradient" || type === "easing-curve" || type === "path") {
          if (!editorTypesAdded.has(type)) {
            editorTypesAdded.add(type);
            items.push({
              kind: "editor",
              editorType: type,
              label: TYPE_TOOL_META[type].label,
              icon: TYPE_TOOL_META[type].icon,
              hint: TOOL_HINTS[type] ?? "",
              active: openEditor === type,
            });
          }
          continue;
        }
        if (type === "spring-response" && typeof entry.liveValue !== "number") {
          // Spring objects arm one axis at a time — three tools.
          const springEntries = entriesByType.get("spring-response") ?? [];
          const axes = [
            {
              key: "stiffness" as const,
              text: "Stiffness",
              range: SPRING_SURFACE.stiffnessRange,
              icon: ICONS.stiffness,
            },
            {
              key: "damping" as const,
              text: "Damping",
              range: SPRING_SURFACE.dampingRange,
              icon: ICONS.damping,
            },
            {
              key: "mass" as const,
              text: "Mass",
              range: SPRING_SURFACE.massRange,
              icon: ICONS.mass,
            },
          ];
          for (const axis of axes) {
            const tool: ArmedTool = {
              effectId: selectedEffect.id,
              paramKey: entry.paramKey,
              axis: axis.key,
              label:
                springEntries.length > 1
                  ? `${label} · ${axis.text}`
                  : axis.text,
              unit: undefined,
              spec: { min: axis.range.min, max: axis.range.max, curve: "log" },
              type,
            };
            items.push({
              kind: "slider",
              tool,
              icon: axis.icon,
              hint: AXIS_HINTS[axis.key],
            });
          }
          continue;
        }
        if (typeof entry.liveValue !== "number") continue;
        const bounds = sliderBoundsFor(entry.param, type);
        const tool: ArmedTool = {
          effectId: selectedEffect.id,
          paramKey: entry.paramKey,
          label,
          unit: entry.param.unit,
          spec: { min: bounds.min, max: bounds.max, curve: curveForType(type) },
          type,
        };
        items.push({
          kind: "slider",
          tool,
          icon: TYPE_TOOL_META[type].icon,
          // Scalar is the catch-all: its meaning lives entirely in the
          // agent's label, so the hint puts that word in a sentence
          // instead of describing "a value" in the abstract.
          hint:
            type === "scalar"
              ? `How much ${label.toLowerCase()}`
              : (TOOL_HINTS[type] ?? ""),
        });
      }
    }
    // Sliders first; toggles and editor rows (gradient, easing, path)
    // gather at the bottom of the drawer.
    return [
      ...items.filter((i) => i.kind === "slider"),
      ...items.filter((i) => i.kind !== "slider"),
    ];
  };

  const openPanels: React.ReactNode[] = [];
  // The layers button toggles the navigator: the page-wide inventory when
  // nothing is selected, the selection-scoped layers list otherwise.
  if (showLayers) {
    if (selectedEffect === null) {
      openPanels.push(
        <ElementsPanel
          key="__elements"
          onJump={(id, node) => {
            session.selectEffect(id, node ?? undefined);
          }}
          onHover={setBrowseHover}
        />,
      );
    } else {
      openPanels.push(
        <LayersPanel
          key="__layers"
          selectedEffectId={selectedEffect.id}
          onJump={(id, node) => {
            session.selectEffect(id, node ?? undefined);
          }}
        />,
      );
    }
  }
  // The expanded family: its tools as icon + slider rows, growing the chip
  // upward with the gooey morph.
  if (selectedEffect !== null && openFamily !== null) {
    openPanels.push(
      <FamilySliderPanel
        key={`__family-${openFamily}`}
        items={buildPanelItems(openFamily)}
        onEditor={(type) => {
          setOpenEditor((cur) => (cur === type ? null : type));
        }}
      />,
    );
  }
  // The one open non-scalar editor (gradient / easing curve / path). These
  // become detached canvas popups next; for now they render as a chip panel.
  if (
    selectedEffect !== null &&
    openEditor !== null &&
    entriesByType.has(openEditor)
  ) {
    openPanels.push(
      <ToolkitTypePanel
        key={openEditor}
        type={openEditor}
        // The drawer row the designer just clicked already names the editor,
        // so repeating a section title inside the panel adds no context.
        label=""
        effectId={selectedEffect.id}
        entries={entriesByType.get(openEditor) ?? []}
      />,
    );
  }

  // The path editor edits on the canvas, not in the chip: opening it mounts
  // the canvas + SVG layers scoped to path params, so the bezier curve,
  // anchors, and handles render over the actual element while the panel
  // keeps the numeric escape hatch.
  const pathEditing = selectedEffect !== null && openEditor === "path";

  return (
    <>
      {pathEditing ? (
        <>
          <CanvasLayer active hasSelection />
          <SvgLayer active selectedEffect={selectedEffect} only={["path"]} />
        </>
      ) : null}
      {browseHover !== null ? (
        <NodeHighlight
          node={browseHover.node}
          color="rgba(255, 255, 255, 0.85)"
          label={browseHover.label}
        />
      ) : null}
      <Toolbox
        tools={tools}
        dock={dock}
        onDockChange={onDockChange}
        onDragStart={() => {
          setOpenFamily(null);
          setOpenEditor(null);
          setShowLayers(false);
        }}
        panels={openPanels.length > 0 ? openPanels : null}
        closing={closing}
      />
    </>
  );
}

const LAUNCHER_SIZE = 46;
// Matches the toolbox's BOTTOM_MARGIN so the glide ends exactly where the
// chip mounts.
const LAUNCHER_MARGIN = 16;

// Closed state: a logo square fixed in the bottom-right corner, unmovable.
// Clicking it glides the square to bottom-center; when the glide lands, the
// toolbox mounts in its place and morphs open from the same footprint.
function Launcher({
  onOpen,
  dock,
  connected,
  onDockChange,
}: {
  onOpen: () => void;
  dock: "bottom" | "top";
  connected: boolean;
  onDockChange: (dock: "bottom" | "top") => void;
}): React.JSX.Element {
  const closedX = (): number =>
    window.innerWidth - LAUNCHER_SIZE - LAUNCHER_MARGIN;
  const centerX = (): number => (window.innerWidth - LAUNCHER_SIZE) / 2;
  const [x, setX] = useState(closedX);
  const [opening, setOpening] = useState(false);
  const openedRef = useRef(false);

  // Draggable, same parameters as the toolbar: 6px threshold, free follow,
  // then a 340ms glide to the nearest anchor corner on release.
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [snapTop, setSnapTop] = useState<number | null>(null);
  const dragRef = useRef({
    tracking: false,
    moved: false,
    startX: 0,
    startY: 0,
    offX: 0,
    offY: 0,
  });
  const suppressClickRef = useRef(false);

  useEffect(() => {
    const onResize = (): void => {
      if (!openedRef.current) setX(closedX());
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const finishOpen = (): void => {
    if (openedRef.current) {
      openedRef.current = false;
      onOpen();
    }
  };

  // Fires the open ~78% through the glide, overlapping the stages: the
  // chip starts blooming while the square finishes its last few px of
  // travel, so the two moments read as one continuous motion instead of
  // slide → pause → open. (Also the safety net for a zero-distance glide.)
  useEffect(() => {
    if (!opening) return;
    const timer = window.setTimeout(finishOpen, 285);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opening]);

  useEffect(() => {
    if (snapTop === null) return;
    const timer = window.setTimeout(() => {
      setSnapTop(null);
    }, 350);
    return () => {
      clearTimeout(timer);
    };
  }, [snapTop]);

  const beginDrag = (e: React.PointerEvent): void => {
    if (opening) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragRef.current = {
      tracking: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      offX: e.clientX - rect.left,
      offY: e.clientY - rect.top,
    };
    const move = (ev: PointerEvent): void => {
      const d = dragRef.current;
      if (!d.tracking) return;
      if (!d.moved) {
        if (Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) < 6)
          return;
        d.moved = true;
        suppressClickRef.current = true;
        setSnapTop(null);
      }
      setDragPos({ x: ev.clientX - d.offX, y: ev.clientY - d.offY });
    };
    const up = (ev: PointerEvent): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const d = dragRef.current;
      d.tracking = false;
      if (!d.moved) return;
      const centerY = ev.clientY - d.offY + LAUNCHER_SIZE / 2;
      const targetDock: "bottom" | "top" =
        centerY < window.innerHeight / 2 ? "top" : "bottom";
      const top =
        targetDock === "top"
          ? LAUNCHER_MARGIN
          : window.innerHeight - LAUNCHER_SIZE - LAUNCHER_MARGIN;
      setDragPos(null);
      setSnapTop(top);
      setX(closedX());
      onDockChange(targetDock);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <button
      type="button"
      aria-label="Open MotionWorks"
      title={
        connected
          ? "Open MotionWorks"
          : "Start it with `npx motionworks` in your project root"
      }
      onPointerDown={beginDrag}
      onClick={() => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        if (opening) return;
        openedRef.current = true;
        setOpening(true);
        setX(centerX());
      }}
      onTransitionEnd={(event) => {
        if (event.propertyName === "left") finishOpen();
      }}
      style={{
        position: "fixed",
        ...(dragPos !== null
          ? { left: dragPos.x, top: dragPos.y }
          : snapTop !== null
            ? { left: x, top: snapTop }
            : {
                left: x,
                ...(dock === "bottom"
                  ? { bottom: LAUNCHER_MARGIN }
                  : { top: LAUNCHER_MARGIN }),
              }),
        width: LAUNCHER_SIZE,
        height: LAUNCHER_SIZE,
        display: "grid",
        placeItems: "center",
        background: GLASS.background,
        border: GLASS.border,
        borderRadius: GLASS.radiusLarge,
        boxShadow: GLASS.shadow,
        backdropFilter: GLASS.backdrop,
        WebkitBackdropFilter: GLASS.backdrop,
        color: "rgba(255, 255, 255, 0.95)",
        cursor: opening ? "default" : "grab",
        pointerEvents: "auto",
        zIndex: 9998,
        padding: 0,
        touchAction: "none",
        transition:
          dragPos !== null
            ? "none"
            : snapTop !== null
              ? "left 340ms cubic-bezier(0.3, 0.95, 0.3, 1), top 340ms cubic-bezier(0.3, 0.95, 0.3, 1)"
              : "left 305ms cubic-bezier(0.28, 1.1, 0.3, 1)",
      }}
    >
      {ICONS.logo}
    </button>
  );
}
