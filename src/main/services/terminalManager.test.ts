import path from 'node:path';
import process from 'node:process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';
import {
  buildCliLaunch,
  killTerminal,
  listTerminals,
  resizeTerminal,
  startTerminal,
  writeTerminal,
} from './terminalManager';

// Fake PTY so sessions exist without a real node-pty. Each spawn records the
// write/resize/kill calls routed to it, so tests can assert ownership enforcement.
interface FakePty {
  writes: string[];
  resizes: Array<[number, number]>;
  killed: boolean;
  onData: () => void;
  onExit: () => void;
  write: (d: string) => void;
  resize: (c: number, r: number) => void;
  kill: () => void;
}
const h = vi.hoisted(() => ({ ptys: [] as FakePty[] }));

vi.mock('./ptyLoader', () => ({
  getPtyLoadError: () => null,
  loadPty: () => ({
    spawn: () => {
      const rec: FakePty = {
        writes: [],
        resizes: [],
        killed: false,
        onData() {},
        onExit() {},
        write(d: string) {
          rec.writes.push(d);
        },
        resize(c: number, r: number) {
          rec.resizes.push([c, r]);
        },
        kill() {
          rec.killed = true;
        },
      };
      h.ptys.push(rec);
      return rec;
    },
  }),
}));

// Verifies the role-terminal launch wrapper. The Windows `.cmd`/`.bat` path is the
// owed cross-platform check: a shim can only run via cmd.exe, and node-pty quotes the
// args itself — so we pass `['/d','/c', <path>]` with the path as a plain arg (no
// manual quoting / no `/s` outer-quote dance). The win32 branch is platform-gated.
const onWindows = process.platform === 'win32' ? it : it.skip;
const cmdExe = process.env.ComSpec ?? 'cmd.exe';

describe('buildCliLaunch', () => {
  onWindows('wraps a .cmd shim through cmd.exe with the path as a plain arg', () => {
    const resolved = 'C:\\Users\\me\\AppData\\npm\\claude.cmd';
    const launch = buildCliLaunch(resolved);
    expect(launch.file).toBe(cmdExe);
    expect(launch.args).toEqual(['/d', '/c', resolved]);
    // The path is NOT pre-quoted (node-pty handles quoting); no `/s`.
    expect(launch.args).not.toContain('/s');
    expect(launch.args[2]).toBe(resolved);
  });

  onWindows('wraps a .bat shim the same way, case-insensitively', () => {
    const resolved = 'C:\\tools\\Agent.BAT';
    const launch = buildCliLaunch(resolved);
    expect(launch.file).toBe(cmdExe);
    expect(launch.args).toEqual(['/d', '/c', resolved]);
  });

  onWindows('launches a native .exe directly (bare, native interactive)', () => {
    const resolved = 'C:\\Users\\me\\AppData\\Local\\agy\\bin\\agy.exe';
    const launch = buildCliLaunch(resolved);
    expect(launch.file).toBe(resolved);
    expect(launch.args).toEqual([]);
  });

  it('launches an extensionless / non-shim path directly on any platform', () => {
    const resolved = path.join('/usr', 'local', 'bin', 'cursor-agent');
    const launch = buildCliLaunch(resolved);
    expect(launch.file).toBe(resolved);
    expect(launch.args).toEqual([]);
  });
});

describe('terminal session ownership', () => {
  const fakeWebContents = (): WebContents =>
    ({ isDestroyed: () => false, send: () => {}, once: () => {} }) as unknown as WebContents;

  function start(sender: WebContents, projectId = 'p1'): string {
    const res = startTerminal(
      { projectId, roleId: 'developer', mode: 'shell', cols: 80, rows: 24 },
      { workspacePath: '/tmp/ws', cliName: '', resolvedCommand: null, resolveError: null, env: {} },
      sender,
    );
    if (!res.ok || !res.descriptor) {
      throw new Error(`expected start ok, got ${res.error}`);
    }
    return res.descriptor.id;
  }

  beforeEach(() => {
    h.ptys.length = 0;
  });

  it('only the opening renderer can write to a session', () => {
    const owner = fakeWebContents();
    const foreign = fakeWebContents();
    const id = start(owner);
    const pty = h.ptys[h.ptys.length - 1];

    writeTerminal(id, 'rm -rf', foreign);
    expect(pty.writes).toEqual([]); // foreign sender rejected

    writeTerminal(id, 'ls', owner);
    expect(pty.writes).toEqual(['ls']);
  });

  it('only the opening renderer can resize or kill a session', () => {
    const owner = fakeWebContents();
    const foreign = fakeWebContents();
    const id = start(owner);
    const pty = h.ptys[h.ptys.length - 1];

    resizeTerminal(id, 120, 40, foreign);
    expect(pty.resizes).toEqual([]);
    resizeTerminal(id, 120, 40, owner);
    expect(pty.resizes).toEqual([[120, 40]]);

    killTerminal(id, foreign);
    expect(pty.killed).toBe(false);
    expect(listTerminals('p1', owner).map((d) => d.id)).toContain(id); // still alive

    killTerminal(id, owner);
    expect(pty.killed).toBe(true);
    expect(listTerminals('p1', owner).map((d) => d.id)).not.toContain(id);
  });

  it('listTerminals is scoped to the caller and the requested project', () => {
    const a = fakeWebContents();
    const b = fakeWebContents();
    const idA = start(a, 'proj-a');
    start(b, 'proj-b');

    expect(listTerminals('proj-a', a).map((d) => d.id)).toEqual([idA]);
    expect(listTerminals('proj-a', b)).toEqual([]); // b doesn't own proj-a's session
    expect(listTerminals('proj-b', a)).toEqual([]); // a has nothing in proj-b
  });
});
