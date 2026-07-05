import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureUserPathEnv, mergePath } from './pathEnv';

describe('mergePath', () => {
  it('appends only entries not already present (order preserved, no dupes)', () => {
    expect(mergePath('/usr/bin:/bin', ['/opt/homebrew/bin', '/usr/bin'], ':')).toBe(
      '/usr/bin:/bin:/opt/homebrew/bin',
    );
  });
  it('de-dupes within the additions too', () => {
    expect(mergePath('/bin', ['/a', '/a', '/b'], ':')).toBe('/bin:/a:/b');
  });
  it('returns the original string unchanged when nothing is new', () => {
    expect(mergePath('/usr/bin:/bin', ['/bin', '/usr/bin'], ':')).toBe('/usr/bin:/bin');
  });
  it('handles an empty current PATH', () => {
    expect(mergePath('', ['/a', '/b'], ':')).toBe('/a:/b');
  });
  it('ignores empty additions', () => {
    expect(mergePath('/bin', ['', '/a', ''], ':')).toBe('/bin:/a');
  });
});

describe('ensureUserPathEnv guards', () => {
  const original = process.env.PATH;
  beforeEach(() => {
    process.env.PATH = '/usr/bin:/bin';
  });
  afterEach(() => {
    process.env.PATH = original;
  });

  it('is a no-op on Windows (GUI inherits the registry PATH)', async () => {
    await ensureUserPathEnv({ packaged: true, platform: 'win32' });
    expect(process.env.PATH).toBe('/usr/bin:/bin');
  });

  it('is a no-op in dev (not packaged — terminal launch already has the full PATH)', async () => {
    await ensureUserPathEnv({ packaged: false, platform: 'darwin' });
    expect(process.env.PATH).toBe('/usr/bin:/bin');
  });
});
