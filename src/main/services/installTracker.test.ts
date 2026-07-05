import { describe, expect, it } from 'vitest';
import type { InstallOutcome } from '../../shared/scaffold';
import { clearInstallState, getInstallState, setInstallState } from './installTracker';

const running: InstallOutcome = { attempted: true, ok: false, error: null, pending: true };
const done: InstallOutcome = { attempted: true, ok: true, error: null, pending: false };

describe('installTracker (background-install state, process-local)', () => {
  it('returns null for an untracked project (poll → inert no-op upstream)', () => {
    expect(getInstallState('never-seen')).toBeNull();
  });

  it('tracks the running → done transition for the poll', () => {
    setInstallState('p1', running);
    expect(getInstallState('p1')).toEqual(running);
    setInstallState('p1', done); // install finished in the background
    expect(getInstallState('p1')).toEqual(done);
  });

  it('clears state on delete so the map does not leak across a session', () => {
    setInstallState('p2', done);
    clearInstallState('p2');
    expect(getInstallState('p2')).toBeNull();
  });
});
