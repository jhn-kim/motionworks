import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import type { DiscoveredAnimation } from "../shared/index.js";

import { discoverAnimations } from "./discover.js";

// The deterministic recall/precision gate for `motionworks discover`. Each
// fixture is a mini-project with hand-labeled ground truth; the scan must
// recover the labeled animations (recall) without leaking node_modules / test
// / stories / commented code (precision). See fixtures/js-discover/*.

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "..", "..", "fixtures", "js-discover");

interface Expected {
  file: string;
  library: DiscoveredAnimation["library"];
  api: string;
  target?: string;
  confidence: DiscoveredAnimation["confidence"];
  significance: DiscoveredAnimation["significance"];
  count?: number;
  literals?: Record<string, number | string>;
}
interface GroundTruth {
  expected: Expected[];
  negativeFiles: string[];
}

const keyOf = (f: { file: string; api: string; target?: string }): string =>
  `${f.file}::${f.api}::${f.target ?? ""}`;

async function loadTruth(fixture: string): Promise<GroundTruth> {
  return JSON.parse(
    await readFile(join(FIXTURES, fixture, "ground-truth.json"), "utf8"),
  ) as GroundTruth;
}

const FIXTURE_NAMES = ["app", "app-motion-pkg"] as const;

describe("discoverAnimations — recall & precision gate", () => {
  for (const fixture of FIXTURE_NAMES) {
    it(`inventories ${fixture} without false positives`, async () => {
      const truth = await loadTruth(fixture);
      const found = await discoverAnimations(join(FIXTURES, fixture));
      const foundByKey = new Map(found.map((f) => [keyOf(f), f]));

      // ── Hard precision: zero leakage from excluded files ──────────────────
      const leaked = found.filter((f) => truth.negativeFiles.includes(f.file));
      expect(
        leaked,
        `leaked from excluded files: ${JSON.stringify(leaked)}`,
      ).toEqual([]);

      // ── Recall over HIGH+MEDIUM confidence ground truth ───────────────────
      const graded = truth.expected.filter(
        (e) => e.confidence === "high" || e.confidence === "medium",
      );
      const missed = graded.filter((e) => !foundByKey.has(keyOf(e)));
      const recall = (graded.length - missed.length) / graded.length;
      expect(
        recall,
        `recall ${recall.toFixed(3)}; missed: ${JSON.stringify(missed.map(keyOf))}`,
      ).toBeGreaterThanOrEqual(0.95);

      // ── Field-level correctness on every matched expectation ──────────────
      for (const e of truth.expected) {
        const hit = foundByKey.get(keyOf(e));
        if (hit === undefined) continue; // recall handles misses
        expect(hit.library, `library for ${keyOf(e)}`).toBe(e.library);
        expect(hit.confidence, `confidence for ${keyOf(e)}`).toBe(e.confidence);
        expect(hit.significance, `significance for ${keyOf(e)}`).toBe(
          e.significance,
        );
        if (e.count !== undefined)
          expect(hit.count, `group count for ${keyOf(e)}`).toBe(e.count);
        if (e.literals !== undefined)
          for (const [k, v] of Object.entries(e.literals))
            expect(hit.literals?.[k], `literal ${k} for ${keyOf(e)}`).toBe(v);
      }

      // ── Soft precision: extra findings in positive files stay rare ────────
      const expectedKeys = new Set(truth.expected.map(keyOf));
      const positiveFindings = found.filter(
        (f) => !truth.negativeFiles.includes(f.file),
      );
      const extra = positiveFindings.filter((f) => !expectedKeys.has(keyOf(f)));
      const precision =
        positiveFindings.length === 0
          ? 1
          : (positiveFindings.length - extra.length) / positiveFindings.length;
      expect(
        precision,
        `precision ${precision.toFixed(3)}; extra: ${JSON.stringify(extra.map(keyOf))}`,
      ).toBeGreaterThanOrEqual(0.9);
    });
  }

  it("captures byte-accurate duration literals for lifting", async () => {
    const found = await discoverAnimations(join(FIXTURES, "app"));
    const hero = found.find((f) => f.file === "src/Hero.tsx");
    expect(hero?.literals?.duration).toBe(0.6);
  });

  it("emits a stable id that survives re-scan", async () => {
    const a = await discoverAnimations(join(FIXTURES, "app"));
    const b = await discoverAnimations(join(FIXTURES, "app"));
    expect(a.map((f) => f.id)).toEqual(b.map((f) => f.id));
    expect(new Set(a.map((f) => f.id)).size).toBe(a.length); // ids unique
  });
});
