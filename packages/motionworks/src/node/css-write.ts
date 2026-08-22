import { readdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import { cssValuesEqual } from '../shared/css-values.js';
import type { JournalEntry, ParameterType } from '../shared/index.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage', '.motionworks']);
const CSS_FILE = /(?:\.module)?\.(?:css|scss|less)$/i;

export async function listCssFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) await walk(resolve(dir, entry.name)); }
      else if (entry.isFile() && CSS_FILE.test(entry.name)) files.push(resolve(dir, entry.name));
    }
  };
  await walk(resolve(root));
  return files.sort();
}

export interface DeclarationMatch { start: number; end: number; value: string; selectorText: string }

function maskCommentsAndStrings(source: string): string {
  let out = '';
  let quote = '';
  let comment = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index] ?? '';
    const next = source[index + 1] ?? '';
    if (comment) { if (char === '*' && next === '/') { out += '  '; index++; comment = false; } else out += char === '\n' ? '\n' : ' '; continue; }
    if (quote !== '') { if (char === '\\') { out += '  '; index++; } else if (char === quote) { out += ' '; quote = ''; } else out += char === '\n' ? '\n' : ' '; continue; }
    if (char === '/' && next === '*') { out += '  '; index++; comment = true; continue; }
    if (char === '"' || char === "'") { quote = char; out += ' '; continue; }
    out += char;
  }
  return out;
}

function selectorAt(masked: string, position: number): string {
  const stack: number[] = [];
  for (let index = 0; index < position; index++) {
    if (masked[index] === '{') stack.push(index);
    else if (masked[index] === '}') stack.pop();
  }
  for (let index = stack.length - 1; index >= 0; index--) {
    const brace = stack[index]!;
    const previous = Math.max(masked.lastIndexOf('}', brace - 1), masked.lastIndexOf('{', brace - 1), masked.lastIndexOf(';', brace - 1));
    const selector = masked.slice(previous + 1, brace).trim();
    if (!selector.startsWith('@')) return selector;
  }
  return '';
}

export function findDeclarations(source: string, varName: string): DeclarationMatch[] {
  if (varName === 'animation') return [];
  const masked = maskCommentsAndStrings(source);
  const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^|[;{])\\s*${escaped}\\s*:\\s*`, 'gm');
  const matches: DeclarationMatch[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(masked)) !== null) {
    const start = pattern.lastIndex;
    let end = start;
    let depth = 0;
    while (end < masked.length) {
      const char = masked[end];
      if (char === '(') depth++;
      else if (char === ')') depth--;
      else if ((char === ';' || char === '}') && depth === 0) break;
      end++;
    }
    let valueEnd = end;
    while (valueEnd > start && /\s/.test(source[valueEnd - 1] ?? '')) valueEnd--;
    matches.push({ start, end: valueEnd, value: source.slice(start, valueEnd), selectorText: selectorAt(masked, start) });
  }
  return matches;
}

function insideRoot(root: string, file: string): boolean {
  const path = relative(resolve(root), resolve(file));
  return path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(path);
}

export async function applyCssChanges(projectRoot: string, entry: JournalEntry): Promise<{ kind: 'applied'; files: string[] } | { kind: 'skipped'; reason: string }> {
  if (entry.changes.length === 0) return { kind: 'skipped', reason: 'No CSS value changes to apply.' };
  const root = resolve(projectRoot);
  const files = await listCssFiles(root);
  const sources = new Map<string, string>();
  for (const file of files) sources.set(file, await readFile(file, 'utf8'));
  const replacements = new Map<string, Array<{ start: number; end: number; value: string }>>();

  for (const change of entry.changes) {
    if (change.var === undefined || change.fromCss === undefined || change.toCss === undefined) return { kind: 'skipped', reason: `Change ${change.param} is not bound to a CSS declaration.` };
    if (change.var === 'animation') return { kind: 'skipped', reason: 'The animation shorthand is not directly writable.' };
    let candidates = files.flatMap((file) => findDeclarations(sources.get(file)!, change.var!).filter((decl) => cssValuesEqual(change.type as ParameterType, decl.value, change.fromCss!)).map((decl) => ({ file, decl })));
    if (change.rule?.sourceFile !== undefined) {
      const target = resolve(root, change.rule.sourceFile.replace(/^\/@fs\//, '/'));
      if (!insideRoot(root, target)) return { kind: 'skipped', reason: `Source file for ${change.param} is outside the project root.` };
      candidates = candidates.filter(({ file }) => resolve(file) === target || file.endsWith(change.rule!.sourceFile!));
    }
    if (change.rule?.selectorText !== undefined) candidates = candidates.filter(({ decl }) => decl.selectorText === change.rule!.selectorText);
    if (candidates.length !== 1) return { kind: 'skipped', reason: `Expected one declaration for ${change.var} with value ${change.fromCss}; found ${String(candidates.length)}.` };
    const candidate = candidates[0]!;
    const list = replacements.get(candidate.file) ?? [];
    list.push({ start: candidate.decl.start, end: candidate.decl.end, value: change.toCss });
    replacements.set(candidate.file, list);
  }

  for (const [file, edits] of replacements) {
    let source = sources.get(file)!;
    for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.value + source.slice(edit.end);
    await writeFile(file, source, 'utf8');
  }
  return { kind: 'applied', files: [...replacements.keys()].map((file) => relative(root, file)) };
}
