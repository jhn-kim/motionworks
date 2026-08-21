import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderStanza, scanClaudeMd } from './claude-md.js';
import { runInit } from './init.js';

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'motionworks-init-'));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe('runInit', () => {
  it('creates CLAUDE.md with the stanza when no instruction file exists (--yes)', async () => {
    const outcomes = await runInit({ cwd, packageVersion: '1.0.0', yes: true, log: () => {} });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ kind: 'created', file: 'CLAUDE.md' });
    const contents = await readFile(join(cwd, 'CLAUDE.md'), 'utf8');
    const scan = scanClaudeMd(contents);
    expect(scan.present).toBe(true);
    expect(scan.version).toBe('1.0.0');
    expect(contents).toContain('[MotionWorks schema emission guide]');
  });

  it('is idempotent at the same version: running twice yields byte-identical CLAUDE.md and skipped-same-version', async () => {
    await runInit({ cwd, packageVersion: '1.0.0', yes: true, log: () => {} });
    const first = await readFile(join(cwd, 'CLAUDE.md'), 'utf8');

    const outcomes = await runInit({ cwd, packageVersion: '1.0.0', yes: true, log: () => {} });
    expect(outcomes[0]!.kind).toBe('skipped-same-version');
    const second = await readFile(join(cwd, 'CLAUDE.md'), 'utf8');
    expect(second).toBe(first);
  });

  it('appends to an existing CLAUDE.md without touching prior content', async () => {
    const priorContent = '# Project instructions\n\nSome existing notes.\n';
    await writeFile(join(cwd, 'CLAUDE.md'), priorContent, 'utf8');
    const outcomes = await runInit({ cwd, packageVersion: '1.0.0', yes: true, log: () => {} });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ kind: 'appended', file: 'CLAUDE.md' });

    const contents = await readFile(join(cwd, 'CLAUDE.md'), 'utf8');
    expect(contents.startsWith(priorContent)).toBe(true);
    const scan = scanClaudeMd(contents);
    expect(scan.present).toBe(true);
    expect(scan.version).toBe('1.0.0');
  });

  it('replaces an older stanza with confirmation (--yes), leaving surrounding content untouched', async () => {
    const oldStanza = renderStanza('0.5.0');
    const priorContent = `# Project\n\n${oldStanza}\n\nMore notes below.\n`;
    await writeFile(join(cwd, 'CLAUDE.md'), priorContent, 'utf8');

    const outcomes = await runInit({ cwd, packageVersion: '1.0.0', yes: true, log: () => {} });
    expect(outcomes[0]!.kind).toBe('replaced');

    const contents = await readFile(join(cwd, 'CLAUDE.md'), 'utf8');
    expect(contents.startsWith('# Project\n\n')).toBe(true);
    expect(contents.endsWith('More notes below.\n')).toBe(true);
    const scan = scanClaudeMd(contents);
    expect(scan.version).toBe('1.0.0');
  });

  it('does not overwrite a stanza newer than the installed package', async () => {
    const newerStanza = renderStanza('9.9.9');
    await writeFile(join(cwd, 'CLAUDE.md'), `${newerStanza}\n`, 'utf8');

    const before = await readFile(join(cwd, 'CLAUDE.md'), 'utf8');
    const outcomes = await runInit({ cwd, packageVersion: '1.0.0', yes: true, log: () => {} });
    expect(outcomes[0]!.kind).toBe('skipped-same-version');
    const after = await readFile(join(cwd, 'CLAUDE.md'), 'utf8');
    expect(after).toBe(before);
  });

  it('updates both CLAUDE.md and AGENTS.md when both exist', async () => {
    await writeFile(join(cwd, 'CLAUDE.md'), '# Claude notes\n', 'utf8');
    await writeFile(join(cwd, 'AGENTS.md'), '# Codex notes\n', 'utf8');

    const outcomes = await runInit({ cwd, packageVersion: '1.0.0', yes: true, log: () => {} });
    expect(outcomes).toHaveLength(2);
    expect(outcomes.map((o) => o.file).sort()).toEqual(['AGENTS.md', 'CLAUDE.md']);
    expect(outcomes.every((o) => o.kind === 'appended')).toBe(true);

    for (const file of ['CLAUDE.md', 'AGENTS.md']) {
      const scan = scanClaudeMd(await readFile(join(cwd, file), 'utf8'));
      expect(scan.present).toBe(true);
      expect(scan.version).toBe('1.0.0');
    }
  });

  it('targets an AGENTS.md-only project without creating CLAUDE.md', async () => {
    await writeFile(join(cwd, 'AGENTS.md'), '# Codex notes\n', 'utf8');

    const outcomes = await runInit({ cwd, packageVersion: '1.0.0', yes: true, log: () => {} });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ kind: 'appended', file: 'AGENTS.md' });
    await expect(readFile(join(cwd, 'CLAUDE.md'), 'utf8')).rejects.toThrow();
  });

  it('creates AGENTS.md when forced with the agents flag', async () => {
    const outcomes = await runInit({
      cwd,
      packageVersion: '1.0.0',
      yes: true,
      agents: true,
      log: () => {},
    });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ kind: 'created', file: 'AGENTS.md' });
    const scan = scanClaudeMd(await readFile(join(cwd, 'AGENTS.md'), 'utf8'));
    expect(scan.version).toBe('1.0.0');
    await expect(readFile(join(cwd, 'CLAUDE.md'), 'utf8')).rejects.toThrow();
  });

  it('targets both files when both flags are passed, creating missing ones', async () => {
    const outcomes = await runInit({
      cwd,
      packageVersion: '1.0.0',
      yes: true,
      claude: true,
      agents: true,
      log: () => {},
    });
    expect(outcomes.map((o) => o.kind)).toEqual(['created', 'created']);
    expect(outcomes.map((o) => o.file)).toEqual(['CLAUDE.md', 'AGENTS.md']);
  });

  it('can update the two files at independent versions in one run', async () => {
    await writeFile(join(cwd, 'CLAUDE.md'), `${renderStanza('1.0.0')}\n`, 'utf8');
    await writeFile(join(cwd, 'AGENTS.md'), `${renderStanza('0.5.0')}\n`, 'utf8');

    const outcomes = await runInit({ cwd, packageVersion: '1.0.0', yes: true, log: () => {} });
    const byFile = new Map(outcomes.map((o) => [o.file, o.kind]));
    expect(byFile.get('CLAUDE.md')).toBe('skipped-same-version');
    expect(byFile.get('AGENTS.md')).toBe('replaced');
  });
});
