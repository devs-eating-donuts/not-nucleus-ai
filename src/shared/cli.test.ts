import { describe, expect, it } from 'vitest';
import {
  applyThinkingKeyword,
  CLI_PRESETS,
  ROOM_TIMEOUT_DEEP_MS,
  ROOM_TIMEOUT_DEFAULT_MS,
  isReliableForQa,
  qaSeatReliabilityHint,
  resolveThinkingKeyword,
  roomTimeoutMsForThinking,
  seatThinkingAdvice,
  stepDownThinkingLevel,
  thinkingArgsFor,
} from './cli';

const claude = CLI_PRESETS.find((p) => p.id === 'claude');
const copilot = CLI_PRESETS.find((p) => p.id === 'copilot');
const cursor = CLI_PRESETS.find((p) => p.id === 'cursor');

// QA reliability: PTY CLIs (agy) background long checks and stall the gate; the spawn-based
// cursor-agent ALSO stalls under a real QA workload (qaStallsProne); other
// spawn CLIs settle on exit. The hint steers the QA seat toward Claude/Codex without forcing it.
describe('QA-seat reliability', () => {
  const agy = CLI_PRESETS.find((p) => p.id === 'antigravity')!;
  const codex = CLI_PRESETS.find((p) => p.id === 'codex')!;
  it('marks PTY CLIs (agy) AND qaStallsProne CLIs (cursor) unreliable for QA', () => {
    expect(isReliableForQa(agy)).toBe(false); // agy is execVia:'pty'
    expect(isReliableForQa(cursor!)).toBe(false); // cursor is spawn but qaStallsProne
    expect(isReliableForQa(claude!)).toBe(true);
    expect(isReliableForQa(codex)).toBe(true);
    expect(isReliableForQa(copilot!)).toBe(true);
  });
  it("returns a hint for agy + cursor, '' for reliable CLIs", () => {
    expect(qaSeatReliabilityHint(agy)).toMatch(/Claude or Codex/);
    // cursor gets the agentic-stall wording, not the terminal-background one.
    expect(qaSeatReliabilityHint(cursor!)).toMatch(/retrieval\/agentic|Claude or Codex/);
    expect(qaSeatReliabilityHint(cursor!)).not.toBe('');
    expect(qaSeatReliabilityHint(claude!)).toBe('');
    expect(qaSeatReliabilityHint(codex)).toBe('');
  });
});

// Claude's extended thinking is a prompt keyword, not a flag — the invoker appends the
// mapped keyword to the prompt. These guard the mapping + the byte-identical-when-unset
// guarantee so non-thinking flows (and flag-based CLIs like Copilot) never change.
describe('resolveThinkingKeyword', () => {
  it('maps Claude levels to their prompt keywords', () => {
    expect(resolveThinkingKeyword(claude, 'think')).toBe('think');
    expect(resolveThinkingKeyword(claude, 'think-hard')).toBe('think hard');
    expect(resolveThinkingKeyword(claude, 'ultrathink')).toBe('ultrathink');
  });

  it("returns '' for the default level (no keyword) and for unset levels", () => {
    expect(resolveThinkingKeyword(claude, 'default')).toBe('');
    expect(resolveThinkingKeyword(claude, '')).toBe('');
    expect(resolveThinkingKeyword(claude, undefined)).toBe('');
    expect(resolveThinkingKeyword(claude, null)).toBe('');
  });

  it("returns '' for flag-delivery CLIs (Copilot uses --reasoning-effort, not a keyword)", () => {
    expect(resolveThinkingKeyword(copilot, 'high')).toBe('');
    expect(resolveThinkingKeyword(copilot, 'max')).toBe('');
  });

  it("returns '' for CLIs without thinking support and for a missing preset", () => {
    expect(resolveThinkingKeyword(cursor, 'think')).toBe('');
    expect(resolveThinkingKeyword(undefined, 'think')).toBe('');
  });

  it('returns \'\' for an unknown level on a prompt-delivery CLI', () => {
    expect(resolveThinkingKeyword(claude, 'nonsense')).toBe('');
  });
});

describe('applyThinkingKeyword', () => {
  const base = 'Implement the login form.\n\nReturn JSON only.';

  it('appends the keyword on its own trailing line, leaving the prompt body intact', () => {
    expect(applyThinkingKeyword(base, claude, 'ultrathink')).toBe(base + '\n\nultrathink');
    expect(applyThinkingKeyword(base, claude, 'think-hard')).toBe(base + '\n\nthink hard');
  });

  it('is byte-identical when no keyword applies (default / unset / flag CLI / no thinking)', () => {
    expect(applyThinkingKeyword(base, claude, 'default')).toBe(base);
    expect(applyThinkingKeyword(base, claude, undefined)).toBe(base);
    expect(applyThinkingKeyword(base, copilot, 'high')).toBe(base);
    expect(applyThinkingKeyword(base, cursor, 'think')).toBe(base);
  });
});

// E2: Codex's reasoning effort is wired as a `-c model_reasoning_effort=<level>` config
// override (Copilot stays a flag; Claude stays a prompt keyword). thinkingArgsFor is the
// single argv builder for the flag/config side, with a stale/invalid-level guard so a
// leftover level from a prior assignment can't inject a value the CLI would reject.
describe('thinkingArgsFor', () => {
  const codex = CLI_PRESETS.find((p) => p.id === 'codex')!;

  it('wires Codex reasoning effort as a -c config override', () => {
    expect(thinkingArgsFor(codex, codex.capabilities, 'high')).toEqual([
      '-c',
      'model_reasoning_effort=high',
    ]);
    expect(thinkingArgsFor(codex, codex.capabilities, 'low')).toEqual([
      '-c',
      'model_reasoning_effort=low',
    ]);
  });

  it('advertises the full current Codex level ladder (minimal…xhigh), ordered low→high', () => {
    // Per the current Codex docs for headless `codex exec`; low/medium/high verified live.
    expect(codex.capabilities.supportedThinkingLevels).toEqual([
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
    expect(thinkingArgsFor(codex, codex.capabilities, 'xhigh')).toEqual([
      '-c',
      'model_reasoning_effort=xhigh',
    ]);
    expect(thinkingArgsFor(codex, codex.capabilities, 'minimal')).toEqual([
      '-c',
      'model_reasoning_effort=minimal',
    ]);
  });

  it("prefers the preset's live level list over a stale stored clone (auto-upgrade)", () => {
    // A Codex seat assigned before minimal/xhigh existed stores the old 3-level clone
    // (capabilities are cloned at assign time, never re-synced) — the live catalog must
    // win or the new levels would be silently dropped from argv.
    const stale = { ...codex.capabilities, supportedThinkingLevels: ['low', 'medium', 'high'] };
    expect(thinkingArgsFor(codex, stale, 'xhigh')).toEqual(['-c', 'model_reasoning_effort=xhigh']);
  });

  it('wires Copilot reasoning effort as a flag', () => {
    expect(thinkingArgsFor(copilot, copilot!.capabilities, 'high')).toEqual([
      '--reasoning-effort',
      'high',
    ]);
  });

  it('returns [] for prompt-keyword CLIs (Claude rides applyThinkingKeyword, not argv)', () => {
    expect(thinkingArgsFor(claude, claude!.capabilities, 'ultrathink')).toEqual([]);
  });

  it('returns [] when the level is unset or default', () => {
    expect(thinkingArgsFor(codex, codex.capabilities, '')).toEqual([]);
    expect(thinkingArgsFor(codex, codex.capabilities, undefined)).toEqual([]);
    expect(thinkingArgsFor(codex, codex.capabilities, null)).toEqual([]);
    expect(thinkingArgsFor(codex, codex.capabilities, 'default')).toEqual([]);
  });

  it('drops a stale/invalid level the CLI does not advertise (no bad -c arg)', () => {
    // e.g. an 'ultrathink' left over from a prior Claude assignment on a Codex seat
    expect(thinkingArgsFor(codex, codex.capabilities, 'ultrathink')).toEqual([]);
  });

  it("validates against the preset's levels when the assignment's stored caps predate them", () => {
    // An older Codex assignment cloned before supportedThinkingLevels existed: still
    // validated against the preset's list, so a free-typed value stays safe.
    const staleCaps = { ...codex.capabilities, supportedThinkingLevels: undefined };
    expect(thinkingArgsFor(codex, staleCaps, 'high')).toEqual(['-c', 'model_reasoning_effort=high']);
    expect(thinkingArgsFor(codex, staleCaps, 'bogus')).toEqual([]);
  });

  it('returns [] when the CLI does not support thinking or is missing', () => {
    expect(thinkingArgsFor(cursor, cursor!.capabilities, 'high')).toEqual([]);
    expect(thinkingArgsFor(undefined, undefined, 'high')).toEqual([]);
  });
});

describe('roomTimeoutMsForThinking', () => {
  it('gives ultrathink the deep (Bullpen-grade) budget when the CLI supports thinking', () => {
    expect(roomTimeoutMsForThinking('ultrathink')).toBe(ROOM_TIMEOUT_DEEP_MS);
    expect(roomTimeoutMsForThinking('ultrathink', true)).toBe(ROOM_TIMEOUT_DEEP_MS);
  });

  it('gives every other level (and unset) the comfortable default budget', () => {
    expect(roomTimeoutMsForThinking('think-hard')).toBe(ROOM_TIMEOUT_DEFAULT_MS);
    expect(roomTimeoutMsForThinking('think')).toBe(ROOM_TIMEOUT_DEFAULT_MS);
    expect(roomTimeoutMsForThinking('default')).toBe(ROOM_TIMEOUT_DEFAULT_MS);
    expect(roomTimeoutMsForThinking(undefined)).toBe(ROOM_TIMEOUT_DEFAULT_MS);
    expect(roomTimeoutMsForThinking(null)).toBe(ROOM_TIMEOUT_DEFAULT_MS);
  });

  it('withholds the deep budget when the seat’s CLI does not support thinking (stale ultrathink)', () => {
    // A non-thinking CLI carrying a leftover 'ultrathink' must NOT get 600s — it does
    // no extended thinking and would just make a hung turn wait twice as long.
    expect(roomTimeoutMsForThinking('ultrathink', false)).toBe(ROOM_TIMEOUT_DEFAULT_MS);
  });

  it('the default budget comfortably exceeds the old flat 120s that killed deep chats', () => {
    expect(ROOM_TIMEOUT_DEFAULT_MS).toBeGreaterThan(120_000);
    expect(ROOM_TIMEOUT_DEEP_MS).toBeGreaterThanOrEqual(ROOM_TIMEOUT_DEFAULT_MS);
  });
});

// R2 — the timeout step-down: one level lower on the preset's ordered ladder, or null.
describe('stepDownThinkingLevel', () => {
  const codex = CLI_PRESETS.find((p) => p.id === 'codex')!;

  it('steps one level down the ordered supported list', () => {
    expect(stepDownThinkingLevel(claude, claude!.capabilities, 'ultrathink')).toBe('think-hard');
    expect(stepDownThinkingLevel(claude, claude!.capabilities, 'think')).toBe('default');
    expect(stepDownThinkingLevel(copilot, copilot!.capabilities, 'max')).toBe('xhigh');
    expect(stepDownThinkingLevel(codex, codex.capabilities, 'xhigh')).toBe('high');
    expect(stepDownThinkingLevel(codex, codex.capabilities, 'high')).toBe('medium');
    expect(stepDownThinkingLevel(codex, codex.capabilities, 'low')).toBe('minimal');
  });

  it('returns null when there is nothing to step down to', () => {
    expect(stepDownThinkingLevel(claude, claude!.capabilities, 'default')).toBeNull();
    expect(stepDownThinkingLevel(claude, claude!.capabilities, undefined)).toBeNull();
    expect(stepDownThinkingLevel(claude, claude!.capabilities, null)).toBeNull();
    expect(stepDownThinkingLevel(codex, codex.capabilities, 'minimal')).toBeNull(); // already lowest
    expect(stepDownThinkingLevel(claude, claude!.capabilities, 'bogus-level')).toBeNull();
  });

  it('returns null for CLIs without thinking support', () => {
    expect(stepDownThinkingLevel(cursor, cursor!.capabilities, 'high')).toBeNull();
    expect(stepDownThinkingLevel(undefined, undefined, 'max')).toBeNull();
  });
});

// Seat-level thinking advice: deep for autonomous dev, middle for reviews, Default for
// chat seats — grounded in the live builds' timing data. Advisory only.
describe('seatThinkingAdvice', () => {
  const codex = CLI_PRESETS.find((p) => p.id === 'codex')!;

  it('suggests deep reasoning for the developer seat', () => {
    expect(seatThinkingAdvice('developer', claude, claude!.capabilities, undefined)?.level).toBe(
      'think-hard',
    );
    expect(seatThinkingAdvice('developer', codex, codex.capabilities, undefined)?.level).toBe('high');
  });

  it('suggests a middle level for the review seats', () => {
    expect(seatThinkingAdvice('qa', claude, claude!.capabilities, undefined)?.level).toBe('think');
    expect(seatThinkingAdvice('security', codex, codex.capabilities, undefined)?.level).toBe('medium');
    expect(seatThinkingAdvice('architect', codex, codex.capabilities, undefined)?.level).toBe('medium');
  });

  it('stays quiet when the seat already matches the suggestion', () => {
    expect(seatThinkingAdvice('developer', claude, claude!.capabilities, 'think-hard')).toBeNull();
    expect(seatThinkingAdvice('qa', codex, codex.capabilities, 'medium')).toBeNull();
  });

  it('advises Default on a chat seat only when a HEAVY level is set', () => {
    const heavy = seatThinkingAdvice('stakeholder', claude, claude!.capabilities, 'ultrathink');
    expect(heavy).not.toBeNull();
    expect(heavy!.level).toBeNull(); // "leave it at Default"
    expect(seatThinkingAdvice('projectLead', claude, claude!.capabilities, 'think')).toBeNull();
    expect(seatThinkingAdvice('stakeholder', claude, claude!.capabilities, undefined)).toBeNull();
  });

  it('returns null for CLIs without thinking support or without a table entry', () => {
    expect(seatThinkingAdvice('developer', cursor, cursor!.capabilities, undefined)).toBeNull();
    expect(seatThinkingAdvice('developer', undefined, undefined, undefined)).toBeNull();
    expect(seatThinkingAdvice('ops', claude, claude!.capabilities, undefined)).toBeNull();
  });
});
