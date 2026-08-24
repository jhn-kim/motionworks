import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

import type * as TS from "typescript";

import type { DiscoveredAnimation } from "../shared/index.js";

// Static, dependency-gated inventory of JS-driven animations (Framer Motion /
// the renamed `motion` package, GSAP, react-spring). Text search misses the
// idiomatic forms — aliased `<m.>`, `motion(Base)` factories, value/imperative
// hooks with no motion element, the framer-motion→motion rename — so this
// resolves import BINDINGS per file and matches AST nodes against them. The
// scan is the authoritative coverage signal; runtime probes only confirm
// liveness and live values (see js-detect.ts). Judgment about which findings
// matter stays with the agent; this guarantees recall.

// ── typescript is resolved at runtime, never bundled ────────────────────────
// The package ships zero runtime deps; discovery leans on the project's own
// TypeScript (present in essentially every built React + Framer/GSAP codebase).
let tsCache: typeof TS | null | undefined;
async function loadTs(): Promise<typeof TS | null> {
  if (tsCache !== undefined) return tsCache;
  try {
    const mod = (await import("typescript")) as unknown as {
      default?: typeof TS;
    } & typeof TS;
    tsCache = mod.default ?? mod;
  } catch {
    tsCache = null;
  }
  return tsCache;
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  "coverage",
  ".cache",
]);
const CODE_EXT = new Set([".ts", ".tsx", ".jsx", ".js", ".mjs", ".cjs"]);
const isExcludedFile = (name: string): boolean =>
  /\.(test|spec|stories)\.[cm]?[jt]sx?$/.test(name) || name.endsWith(".d.ts");

// Import-specifier → library, and the dependency keys that gate each library.
const FRAMER_SPECIFIERS = new Set(["framer-motion", "motion", "motion/react"]);
const REACT_SPRING_PREFIX = "@react-spring/";
function libraryForSpecifier(
  spec: string,
): DiscoveredAnimation["library"] | null {
  if (FRAMER_SPECIFIERS.has(spec)) return "framer-motion";
  if (spec === "gsap" || spec.startsWith("gsap/") || spec === "@gsap/react")
    return "gsap";
  if (spec === "react-spring" || spec.startsWith(REACT_SPRING_PREFIX))
    return "react-spring";
  return null;
}

// Hooks worth reporting as animations (value plumbing like useTransform /
// useMotionValue is intentionally excluded — it derives values, it is not an
// animation on its own).
const FRAMER_HOOKS = new Set([
  "useAnimate",
  "useAnimationControls",
  "useSpring",
  "useScroll",
  "useInView",
]);
const REACT_SPRING_HOOKS = new Set([
  "useSpring",
  "useSprings",
  "useTrail",
  "useTransition",
  "useChain",
]);
const GSAP_TWEENS = new Set(["to", "from", "fromTo"]);
const HIGH_SIGNIFICANCE_HOOKS = new Set(["useScroll", "useInView"]);
const HIGH_CONFIDENCE_SPRING_HOOKS = new Set(["useSpring", "useSprings"]);

const ANIMATION_PROPS = new Set([
  "initial",
  "animate",
  "exit",
  "transition",
  "variants",
  "whileHover",
  "whileTap",
  "whileFocus",
  "whileDrag",
  "whileInView",
  "layout",
  "drag",
]);
const MICRO_PROPS = new Set(["whileHover", "whileTap", "whileFocus", "drag"]);
const ENTRANCE_PROPS = new Set([
  "whileInView",
  "layout",
  "layoutId",
  "exit",
  "drag",
]);

function djb2(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++)
    hash = (hash * 33) ^ input.charCodeAt(i);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function walk(dir: string, root: string, out: string[]): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      await walk(join(dir, entry.name), root, out);
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf(".");
      const ext = dot === -1 ? "" : entry.name.slice(dot);
      if (!CODE_EXT.has(ext) || isExcludedFile(entry.name)) continue;
      out.push(join(dir, entry.name));
    }
  }
}

async function presentLibraries(
  root: string,
): Promise<Set<DiscoveredAnimation["library"]>> {
  const present = new Set<DiscoveredAnimation["library"]>();
  try {
    const pkg = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const deps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    };
    for (const name of Object.keys(deps)) {
      const lib = libraryForSpecifier(name);
      if (lib !== null) present.add(lib);
    }
  } catch {
    // No package.json (or unreadable): scan for everything rather than nothing.
    return new Set(["framer-motion", "gsap", "react-spring"]);
  }
  return present;
}

interface RawFinding {
  file: string;
  line: number;
  library: DiscoveredAnimation["library"];
  api: string;
  target?: string;
  significance: DiscoveredAnimation["significance"];
  confidence: DiscoveredAnimation["confidence"];
  count?: number;
  literals?: Record<string, number | string>;
}

// Per-file scan. All resolution is binding-based: a form is only recognised
// when its identifier traces back to an import from a gated library.
function scanFile(
  ts: typeof TS,
  filePath: string,
  relPath: string,
  text: string,
  present: Set<DiscoveredAnimation["library"]>,
): RawFinding[] {
  const kind = filePath.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.TSX;
  const sf = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    kind,
  );
  const findings: RawFinding[] = [];

  // Import bindings resolved for this file only.
  const motionElementLocals = new Map<string, DiscoveredAnimation["library"]>(); // local -> lib (motion / m namespace object)
  const motionFactoryLocals = new Set<string>(); // local of the callable `motion`
  const framerHookLocals = new Map<string, string>(); // local -> canonical hook
  const reactSpringHookLocals = new Map<string, string>();
  const gsapLocals = new Set<string>();
  const arrayLengths = new Map<string, number>(); // module const array literal lengths, for group counts

  const lineOf = (node: TS.Node): number =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  // ── Pass 1: imports + module-level array literals ─────────────────────────
  for (const stmt of sf.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier)
    ) {
      const lib = libraryForSpecifier(stmt.moduleSpecifier.text);
      if (lib === null || !present.has(lib)) continue;
      const bindings = stmt.importClause?.namedBindings;
      if (stmt.importClause?.name !== undefined && lib === "gsap")
        gsapLocals.add(stmt.importClause.name.text); // `import gsap from "gsap"`
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          const imported = (el.propertyName ?? el.name).text;
          const local = el.name.text;
          if (lib === "framer-motion") {
            if (imported === "motion" || imported === "m") {
              motionElementLocals.set(local, lib);
              motionFactoryLocals.add(local);
            } else if (FRAMER_HOOKS.has(imported)) {
              framerHookLocals.set(local, imported);
            }
          } else if (lib === "react-spring") {
            if (REACT_SPRING_HOOKS.has(imported))
              reactSpringHookLocals.set(local, imported);
          } else if (lib === "gsap") {
            if (imported === "gsap") gsapLocals.add(local);
          }
        }
      }
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer !== undefined &&
          ts.isArrayLiteralExpression(decl.initializer)
        )
          arrayLengths.set(decl.name.text, decl.initializer.elements.length);
      }
    }
  }

  const hasAnyLib =
    motionElementLocals.size > 0 ||
    motionFactoryLocals.size > 0 ||
    framerHookLocals.size > 0 ||
    reactSpringHookLocals.size > 0 ||
    gsapLocals.size > 0;
  if (!hasAnyLib) return findings;

  // Count for a JSX element that lives inside `<array>.map(...)`.
  const groupCount = (node: TS.Node): number | undefined => {
    let cur: TS.Node | undefined = node.parent;
    while (cur !== undefined) {
      if (
        ts.isCallExpression(cur) &&
        ts.isPropertyAccessExpression(cur.expression) &&
        cur.expression.name.text === "map" &&
        ts.isIdentifier(cur.expression.expression)
      ) {
        const len = arrayLengths.get(cur.expression.expression.text);
        return len !== undefined && len > 1 ? len : undefined;
      }
      cur = cur.parent;
    }
    return undefined;
  };

  // Inspect a motion element's JSX attributes for significance / confidence /
  // captured literals.
  const readJsxAttrs = (
    attrs: TS.JsxAttributes,
  ): {
    names: Set<string>;
    hasSpread: boolean;
    hasInlineObject: boolean;
    duration?: number;
  } => {
    const names = new Set<string>();
    let hasSpread = false;
    let hasInlineObject = false;
    let duration: number | undefined;
    for (const attr of attrs.properties) {
      if (ts.isJsxSpreadAttribute(attr)) {
        hasSpread = true;
        continue;
      }
      if (!ts.isJsxAttribute(attr)) continue;
      const name = attr.name.getText(sf);
      names.add(name);
      const init = attr.initializer;
      if (
        init !== undefined &&
        ts.isJsxExpression(init) &&
        init.expression !== undefined &&
        ts.isObjectLiteralExpression(init.expression)
      ) {
        if (ANIMATION_PROPS.has(name)) hasInlineObject = true;
        if (name === "transition")
          duration = numericProp(ts, sf, init.expression, "duration");
      }
    }
    return { names, hasSpread, hasInlineObject, duration };
  };

  // ── Pass 2: walk for usages ───────────────────────────────────────────────
  const visit = (node: TS.Node): void => {
    // Factory component: `const Card = motion(Base)` / `motion.create(Base)`.
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isCallExpression(node.initializer)
    ) {
      const callee = node.initializer.expression;
      const isFactory =
        (ts.isIdentifier(callee) && motionFactoryLocals.has(callee.text)) ||
        (ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          motionFactoryLocals.has(callee.expression.text) &&
          callee.name.text === "create");
      if (isFactory) {
        findings.push({
          file: relPath,
          line: lineOf(node),
          library: "framer-motion",
          api: "motion()",
          target: node.name.text,
          significance: "medium",
          confidence: "medium",
        });
      }
    }

    // JSX motion element: `<motion.div>` / `<m.section>` (member on a bound local).
    if (ts.isJsxOpeningLikeElement(node)) {
      const tag = node.tagName;
      if (
        ts.isPropertyAccessExpression(tag) &&
        ts.isIdentifier(tag.expression) &&
        motionElementLocals.has(tag.expression.text)
      ) {
        const local = tag.expression.text;
        const elementTag = tag.name.text;
        const { names, hasSpread, hasInlineObject, duration } = readJsxAttrs(
          node.attributes,
        );
        const significance = jsxSignificance(names);
        const confidence: DiscoveredAnimation["confidence"] =
          hasSpread && !hasInlineObject
            ? "low"
            : hasInlineObject
              ? "high"
              : "medium";
        findings.push({
          file: relPath,
          line: lineOf(node),
          library: motionElementLocals.get(local)!,
          api: `${local}.${elementTag}`,
          target: elementTag,
          significance,
          confidence,
          ...(groupCount(node) !== undefined && { count: groupCount(node) }),
          ...(duration !== undefined && { literals: { duration } }),
        });
      }
    }

    // Call expressions: framer/react-spring hooks and gsap tweens.
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee)) {
        const framer = framerHookLocals.get(callee.text);
        const spring = reactSpringHookLocals.get(callee.text);
        if (framer !== undefined) {
          findings.push({
            file: relPath,
            line: lineOf(node),
            library: "framer-motion",
            api: framer,
            significance: HIGH_SIGNIFICANCE_HOOKS.has(framer)
              ? "high"
              : "medium",
            confidence: "medium",
          });
        } else if (spring !== undefined) {
          findings.push({
            file: relPath,
            line: lineOf(node),
            library: "react-spring",
            api: spring,
            significance: "medium",
            confidence: HIGH_CONFIDENCE_SPRING_HOOKS.has(spring)
              ? "high"
              : "medium",
          });
        }
      } else if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        gsapLocals.has(callee.expression.text) &&
        GSAP_TWEENS.has(callee.name.text)
      ) {
        const vars = node.arguments[node.arguments.length - 1];
        const varsObj =
          vars !== undefined && ts.isObjectLiteralExpression(vars)
            ? vars
            : undefined;
        const duration =
          varsObj === undefined
            ? undefined
            : numericProp(ts, sf, varsObj, "duration");
        const hasScrollTrigger =
          varsObj !== undefined &&
          varsObj.properties.some(
            (p) =>
              ts.isPropertyAssignment(p) &&
              p.name.getText(sf) === "scrollTrigger",
          );
        findings.push({
          file: relPath,
          line: lineOf(node),
          library: "gsap",
          api: `${callee.expression.text}.${callee.name.text}`,
          significance: hasScrollTrigger ? "high" : "medium",
          confidence: varsObj !== undefined ? "high" : "medium",
          ...(duration !== undefined && { literals: { duration } }),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

function jsxSignificance(
  names: Set<string>,
): DiscoveredAnimation["significance"] {
  const hasEntrance =
    (names.has("initial") && names.has("animate")) ||
    [...ENTRANCE_PROPS].some((p) => names.has(p)) ||
    names.has("layoutId");
  if (hasEntrance) return "high";
  const hasMicroOnly =
    [...MICRO_PROPS].some((p) => names.has(p)) &&
    !names.has("initial") &&
    !names.has("animate");
  if (hasMicroOnly) return "low";
  return "medium";
}

function numericProp(
  ts: typeof TS,
  sf: TS.SourceFile,
  obj: TS.ObjectLiteralExpression,
  key: string,
): number | undefined {
  for (const prop of obj.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      prop.name.getText(sf) === key &&
      ts.isNumericLiteral(prop.initializer)
    )
      return Number(prop.initializer.text);
  }
  return undefined;
}

/**
 * Scan a project tree for JS-driven animations. Dependency-gated (only libraries
 * present in package.json are matched), binding-resolved (aliases, factories,
 * hooks), and deterministic. Returns findings sorted by file then line, each
 * with a stable id so re-runs diff cleanly against a persisted inventory.
 */
export async function discoverAnimations(
  root: string,
): Promise<DiscoveredAnimation[]> {
  const ts = await loadTs();
  if (ts === null)
    throw new Error(
      "motionworks discover needs TypeScript. Install it in this project (npm i -D typescript) and re-run.",
    );
  const present = await presentLibraries(root);
  if (present.size === 0) return [];
  const files: string[] = [];
  await walk(root, root, files);
  files.sort();

  const raw: RawFinding[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const relPath = relative(root, file).split(sep).join("/");
    raw.push(...scanFile(ts, file, relPath, text, present));
  }

  // Stable id + final shape. Sort by file, then line, then api for determinism.
  raw.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.line - b.line ||
      a.api.localeCompare(b.api),
  );
  return raw.map((f) => ({
    id: djb2(`${f.file}::${f.api}::${f.target ?? ""}`),
    file: f.file,
    line: f.line,
    library: f.library,
    api: f.api,
    ...(f.target !== undefined && { target: f.target }),
    significance: f.significance,
    confidence: f.confidence,
    ...(f.count !== undefined && { count: f.count }),
    ...(f.literals !== undefined && { literals: f.literals }),
    status: "pending" as const,
  }));
}

// ── Durable, diffable inventory (.motionworks/js-animations.json) ────────────
// Mirrors the adoption journal's lifecycle: a plain atomic read-modify-write.
// Re-running discover reconciles against this file so a designer's triage
// (skipped / adopted) survives across sessions and a PR can show "N new".

const INVENTORY = join(".motionworks", "js-animations.json");
const SIGNIFICANCE_RANK = { high: 0, medium: 1, low: 2 } as const;

export async function readInventory(
  root: string,
): Promise<DiscoveredAnimation[]> {
  try {
    const value: unknown = JSON.parse(
      await readFile(join(root, INVENTORY), "utf8"),
    );
    return Array.isArray(value) ? (value as DiscoveredAnimation[]) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeInventory(
  root: string,
  entries: DiscoveredAnimation[],
): Promise<void> {
  const path = join(root, INVENTORY);
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${String(process.pid)}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(temp, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
  await rename(temp, path);
}

export interface DiscoverResult {
  inventory: DiscoveredAnimation[];
  added: DiscoveredAnimation[];
  removed: DiscoveredAnimation[];
}

/**
 * Scan, reconcile against the persisted inventory (carrying over skipped /
 * adopted triage by id), write it back, and report the diff. Ranked by
 * significance so the caller can surface what matters first.
 */
export async function runDiscover(root: string): Promise<DiscoverResult> {
  const scanned = await discoverAnimations(root);
  const previous = await readInventory(root);
  const prevById = new Map(previous.map((e) => [e.id, e]));
  const scannedIds = new Set(scanned.map((e) => e.id));

  const inventory = scanned.map((entry) => {
    const prior = prevById.get(entry.id);
    // Preserve a designer's decision; refresh everything else from the scan.
    return prior !== undefined && prior.status !== "pending"
      ? { ...entry, status: prior.status }
      : entry;
  });
  inventory.sort(
    (a, b) =>
      SIGNIFICANCE_RANK[a.significance] - SIGNIFICANCE_RANK[b.significance] ||
      a.file.localeCompare(b.file) ||
      a.line - b.line,
  );

  const added = scanned.filter((e) => !prevById.has(e.id));
  const removed = previous.filter((e) => !scannedIds.has(e.id));
  await writeInventory(root, inventory);
  return { inventory, added, removed };
}
