import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { promptWindow, readTranscript, sanitizeChatMessages, writeTranscript } from './transcriptStore';

const tmpDirs: string[] = [];
async function tmpFile(name: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nucleus-transcript-'));
  tmpDirs.push(dir);
  return path.join(dir, 'nested', name); // nested: writeTranscript must mkdir the parent
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('sanitizeChatMessages (the shared persistence caps)', () => {
  it('keeps only well-shaped user/persona messages', () => {
    const input = [
      { role: 'user', text: 'hi' },
      { role: 'persona', text: 'hello' },
      { role: 'system', text: 'nope' },
      { role: 'user', text: 42 },
      null,
      'garbage',
    ];
    expect(sanitizeChatMessages(input)).toEqual([
      { role: 'user', text: 'hi' },
      { role: 'persona', text: 'hello' },
    ]);
  });

  it('caps each message at 24000 chars and persistence at the newest 200', () => {
    // Persistence caps sit far ABOVE the prompt window — a long design session's
    // earliest decisions must survive on disk (and reach Richard's plan draft).
    const long = 'x'.repeat(30000);
    const many = Array.from({ length: 205 }, (_unused, i) => ({
      role: 'user' as const,
      text: `msg ${i}`,
    }));
    expect(sanitizeChatMessages([{ role: 'user', text: long }])[0].text).toHaveLength(24000);
    const capped = sanitizeChatMessages(many);
    expect(capped).toHaveLength(200);
    expect(capped[0].text).toBe('msg 5'); // the OLDEST 5 rolled off, newest kept
    expect(capped[199].text).toBe('msg 204');
  });

  it('promptWindow keeps only the newest 40 for interactive turns', () => {
    const many = Array.from({ length: 60 }, (_unused, i) => ({
      role: 'user' as const,
      text: `msg ${i}`,
    }));
    const windowed = promptWindow(many);
    expect(windowed).toHaveLength(40);
    expect(windowed[0].text).toBe('msg 20');
    expect(windowed[39].text).toBe('msg 59');
    expect(promptWindow(many.slice(0, 3))).toHaveLength(3); // short logs pass through
  });

  it('returns [] for non-arrays', () => {
    expect(sanitizeChatMessages(undefined)).toEqual([]);
    expect(sanitizeChatMessages({ messages: [] })).toEqual([]);
  });
});

describe('readTranscript / writeTranscript round-trip', () => {
  it('persists and reads back messages, with extra identity fields in the payload', async () => {
    const abs = await tmpFile('architect.json');
    const messages = [
      { role: 'user' as const, text: 'design it' },
      { role: 'persona' as const, text: 'ok — A) or B)?' },
    ];
    await writeTranscript(abs, messages, { roleId: 'architect' });

    expect(await readTranscript(abs)).toEqual(messages);
    // The on-disk shape matches the engines' previous writers byte-for-byte:
    // schemaVersion first, then the identity fields, then messages.
    const raw = JSON.parse(await readFile(abs, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(raw)).toEqual(['schemaVersion', 'roleId', 'messages']);
    expect(raw.schemaVersion).toBe(1);
    expect(raw.roleId).toBe('architect');
  });

  it('reads [] from an absent or corrupt file (a fresh room)', async () => {
    const abs = await tmpFile('missing.json');
    expect(await readTranscript(abs)).toEqual([]);
    await writeTranscript(abs, [{ role: 'user', text: 'ok' }]);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(abs, '{not json', 'utf8');
    expect(await readTranscript(abs)).toEqual([]);
  });
});
