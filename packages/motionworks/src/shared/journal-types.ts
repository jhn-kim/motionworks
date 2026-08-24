import type { ParameterType, TypeCorrection } from "./types.js";

export type JournalStatus = "pending" | "agent-working" | "applied";

export interface JournalChange {
  param: string;
  type: ParameterType;
  from: unknown;
  to: unknown;
  var?: string;
  fromCss?: string;
  toCss?: string;
  rule?: {
    selectorText: string;
    sheetHref: string;
    sourceFile?: string;
    // Present when the browser resolved a declaring rule: how many elements the
    // winning selector governs, and whether the write is local ("single") or
    // fans out across instances ("shared"). Optional for backward compatibility
    // with entries written before scope tracking.
    matchedCount?: number;
    scope?: "single" | "shared";
  };
}

export interface JournalEntry {
  id: string;
  createdAt: number;
  origin: string;
  page: string;
  effectId: string;
  effectName: string;
  elementSelector: string;
  // Durable per-element anchor (`data-mw-id`). Selection and re-selection key to
  // this; `elementSelector` remains the human-readable structural label.
  // Optional for backward compatibility with pre-anchor entries.
  mwId?: string;
  changes: JournalChange[];
  typeCorrections?: TypeCorrection[];
  status: JournalStatus;
  appliedAt?: number;
  appliedBy?: "css" | "agent" | "cli";
  files?: string[];
  error?: string;
}

export type CommitRequest = Omit<
  JournalEntry,
  | "id"
  | "createdAt"
  | "origin"
  | "status"
  | "appliedAt"
  | "appliedBy"
  | "files"
  | "error"
>;

/**
 * Adoption journal (`.motionworks/adoptions.json`). Distinct from the value
 * journal: an adoption is a one-time request for the coding agent to LIFT a
 * JS-driven animation's tunable value (GSAP/Framer Motion/react-spring/custom)
 * into a CSS custom property the effect reads, then attach a MotionWorks schema.
 * After that the effect flows through the normal CSS path and never needs
 * adoption again.
 */
export interface AdoptionParam {
  key: string; // e.g. "duration"
  type: ParameterType;
  value: unknown; // current runtime value (ms for durations)
  var: string; // proposed --mw-* custom property to bind to
  label: string;
  unit?: string;
}

export interface AdoptionRequest {
  library: "gsap" | "framer-motion" | "react-spring" | "custom";
  page: string;
  effectName: string;
  elementSelector: string;
  params: AdoptionParam[];
}

export interface AdoptionEntry extends AdoptionRequest {
  id: string;
  createdAt: number;
  origin: string;
  status: JournalStatus;
  appliedAt?: number;
  appliedBy?: "agent" | "cli";
  error?: string;
}

/**
 * A JS-driven animation located by a STATIC source scan (`motionworks
 * discover`), as opposed to the runtime GSAP registry. The scan is the
 * authoritative inventory of what motion exists in the source tree; runtime
 * probes only confirm liveness and capture live numeric values. Written to
 * `.motionworks/js-animations.json` as a durable, diffable artifact the agent
 * reasons over instead of re-deriving a grep each session.
 */
export interface DiscoveredAnimation {
  /** Stable id: hash of file + api + target, so re-scans diff cleanly. */
  id: string;
  /** Repo-relative POSIX path. */
  file: string;
  /** 1-based line of the primary usage site. */
  line: number;
  library: "framer-motion" | "gsap" | "react-spring";
  /** The recognised API surface, e.g. "motion.div", "useSpring", "gsap.to". */
  api: string;
  /** The element/component the animation drives, when statically knowable. */
  target?: string;
  /** How much the animation likely matters to a designer (ranking, not certainty). */
  significance: "high" | "medium" | "low";
  /** How certain the STATIC scan is that this is a real, liftable animation. */
  confidence: "high" | "medium" | "low";
  /** Grouped count when the same call is mapped over a list (deduped to one entry). */
  count?: number;
  /** Exact source literals captured for a byte-accurate lift (e.g. { duration: 0.6 }). */
  literals?: Record<string, number | string>;
  /** Triage lifecycle, mirroring the adoption journal. */
  status: "pending" | "adopted" | "skipped";
}

export interface SelectRequest {
  effectId: string;
  effectName: string;
  elementSelector: string;
  values?: Record<string, unknown>;
  page?: string;
}

export interface StatusResponse {
  ok: true;
  port: number;
  projectRoot: string;
  pending: number;
  agent: {
    enabled: boolean;
    command: "claude" | "codex" | null;
    running: boolean;
  };
}
