import { describe, expect, it } from 'vitest';
import {
  AGENT_PACK_TARGETS,
  NUCLEUS_RAILS_SENTINEL,
  composeAgentFile,
  enabledAgentPackTargets,
  renderAgentInstructions,
} from './agentPack';

describe('renderAgentInstructions', () => {
  const body = renderAgentInstructions('Pied Piper');

  it('includes the project name', () => {
    expect(body).toContain('Agent instructions — Pied Piper');
  });

  it('carries the core build rails', () => {
    expect(body).toMatch(/never start a long-running or blocking process/i);
    expect(body).toMatch(/one-shot commands/i);
    expect(body).toMatch(/EVERY acceptance criterion/i);
    // Secrets rule: never put a value in code/commit/logs; read from the environment.
    expect(body).toMatch(/never put a secret value/i);
    expect(body).toMatch(/from the environment/i);
  });

  it('carries the hard rules ported from the POC', () => {
    expect(body).toMatch(/CI .* is NOT a debug loop/i);
    expect(body).toMatch(/Look up the current stable version/i); // versioning
    expect(body).toMatch(/When you.?re blocked/i);
    expect(body).toMatch(/STOP and say so/i);
    expect(body).toMatch(/multi-file or destructive changes/i);
  });

  it('carries the engineering baselines (API/UI/testing breadth)', () => {
    expect(body).toMatch(/Engineering baselines/i);
    expect(body).toMatch(/parameterize queries/i);
    expect(body).toMatch(/loading, empty, and error states/i);
    expect(body).toMatch(/assert observable behavior/i);
  });
});

describe('composeAgentFile (merge over a scaffolder file, never clobber)', () => {
  it('writes the bare body byte-for-byte when the file is absent', () => {
    const out = composeAgentFile(null, 'Pied Piper');
    expect(out).toEqual({ mode: 'created', content: renderAgentInstructions('Pied Piper') });
  });

  it('MERGES our rails into a scaffolder file, preserving its content + @import', () => {
    // create-next-app writes CLAUDE.md = `@AGENTS.md` (a Claude Code import directive).
    const scaffolderFile = '@AGENTS.md\n';
    const out = composeAgentFile(scaffolderFile, 'Pied Piper');
    expect(out.mode).toBe('merged');
    if (out.mode !== 'merged') throw new Error('unreachable');
    // The scaffolder's own import survives so Next's rules still load…
    expect(out.content).toContain('@AGENTS.md');
    // …and our rails are appended in a delimited managed block.
    expect(out.content).toContain('<!-- BEGIN NUCLEUS-AI BUILD RAILS (managed) -->');
    expect(out.content).toContain('<!-- END NUCLEUS-AI BUILD RAILS -->');
    expect(out.content).toContain(NUCLEUS_RAILS_SENTINEL);
    expect(out.content).toMatch(/never start a long-running or blocking process/i);
    // The original content comes FIRST (the import isn't buried below our block).
    expect(out.content.indexOf('@AGENTS.md')).toBeLessThan(out.content.indexOf('BUILD RAILS'));
  });

  it('is idempotent — skips a file that already carries the rails', () => {
    const already = composeAgentFile('@AGENTS.md\n', 'Pied Piper');
    if (already.mode !== 'merged') throw new Error('unreachable');
    expect(composeAgentFile(already.content, 'Pied Piper')).toEqual({ mode: 'skipped' });
    // A freshly-written bare file is likewise recognized as already-railed.
    expect(composeAgentFile(renderAgentInstructions('Pied Piper'), 'Pied Piper')).toEqual({
      mode: 'skipped',
    });
  });
});

describe('agent pack targets (phased rollout)', () => {
  it('enables exactly CLAUDE.md + AGENTS.md today — guards against a stray enabled flip', () => {
    expect(enabledAgentPackTargets().map((t) => t.path)).toEqual(['CLAUDE.md', 'AGENTS.md']);
  });

  it('still defines all five tool targets', () => {
    expect(AGENT_PACK_TARGETS.map((t) => t.id).sort()).toEqual(
      ['claude', 'codex', 'copilot', 'cursor', 'gemini'].sort(),
    );
  });
});
