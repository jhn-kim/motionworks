import { findDeclaringRule, type DeclaringRule } from "./css-apply.js";

// Where a motion value physically lives, and therefore whether — and how — it
// can be written back. The overlay reads every value from computed style, so
// everything LOOKS editable; this classifies the value against its actual
// writable home so the gate can refuse or offer a lift instead of stranding the
// edit (the `found 0` failure) or silently fanning it out.
export type WriteProvenance =
  // A single authored declaration owns the value. `rule.scope` says whether that
  // one declaration governs one element ("single") or several ("shared") — the
  // staggered-loader case, where the edit is global.
  | { kind: "authored"; rule: DeclaringRule }
  // The value is set inline on the element (`style={{…}}` / `style="…"`). There
  // is no CSS declaration to replace; a lift into a rule is required first.
  | { kind: "inline" }
  // The value comes from a Tailwind utility (arbitrary property or a motion
  // utility class). Utilities are not declarations the user owns, so a lift into
  // an arbitrary property bound to a `--mw-*` var, or a `@theme` token, is
  // required.
  | { kind: "tailwind"; utility: string }
  // A value with no writable home the overlay can find (computed-only). The gate
  // must not expose it as directly editable.
  | { kind: "none" };

// Unambiguous Tailwind signatures. Arbitrary properties/values carry brackets
// (`[animation-duration:2s]`, `animate-[wiggle_1s_…]`); the motion utilities are
// the `duration-`, `delay-`, `ease-`, `animate-`, and `transition` families.
// Deliberately conservative: a false negative just falls through to `none`
// (still gated), whereas a false positive would offer the wrong lift.
const TAILWIND_MOTION_UTILITY =
  /^(?:duration-|delay-|ease-|animate-|transition(?:-|$))|\[[^\]]*\]/;

function isInlineOnElement(node: HTMLElement, varName: string): boolean {
  // Works for both custom properties and longhand motion properties: inline
  // custom props surface via getPropertyValue, longhands via the same API on
  // the inline style declaration.
  return node.style.getPropertyValue(varName) !== "";
}

// A Tailwind utility rule is a single class selector whose (unescaped) class
// token is one of the element's classes and looks like a motion utility. When
// the winning declaring rule is one of these, the value is owned by Tailwind,
// not by an authored declaration the user can edit in place — so it needs a
// lift rather than a direct write.
function tailwindUtility(
  node: HTMLElement,
  selectorText: string,
): string | undefined {
  const selector = selectorText.trim();
  if (!selector.startsWith(".")) return undefined;
  const token = selector.slice(1).replace(/\\/g, "");
  if (!TAILWIND_MOTION_UTILITY.test(token)) return undefined;
  return node.classList.contains(token) ? token : undefined;
}

export function writeProvenance(
  node: HTMLElement,
  varName: string,
): WriteProvenance {
  if (isInlineOnElement(node, varName)) return { kind: "inline" };
  const rule = findDeclaringRule(node, varName);
  if (rule === undefined) return { kind: "none" };
  const utility = tailwindUtility(node, rule.selectorText);
  if (utility !== undefined) return { kind: "tailwind", utility };
  return { kind: "authored", rule };
}
