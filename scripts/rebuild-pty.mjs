// Rebuild node-pty for Electron's ABI.
//
// macOS/Linux: the stock `@electron/rebuild` path works (compiles a darwin/linux
// binary). Windows is the problem child and the reason this script exists:
//
//  1. `@homebridge/node-pty-prebuilt-multiarch` publishes NO win32 prebuild for the
//     Electron ABI we use (it stops at Electron 29 / ABI v121; we're on Electron 41 /
//     ABI v145 — even further past the prebuild
//     ceiling), so there's nothing to download — it must compile from source. (The
//     script reads the installed Electron version dynamically and retargets, so no
//     change is needed here when Electron moves; only this comment tracks the number.)
//  2. `electron-rebuild` silently SKIPS node-pty on Windows (it sees the bundled
//     `prebuilds/` dir and assumes a prebuild exists), printing "Rebuild Complete"
//     while producing no binary. So the documented command is a no-op here.
//  3. node-gyp's VS auto-detection is brittle on this kind of box: it REJECTS VS 2026
//     (v18) as an unsupported version, and a freshly-installed VS 2022 Build Tools may
//     not have a Windows SDK registered as a component (node-gyp then reports "missing
//     any Windows SDK"). The robust fix is to build from a SUPPORTED VS's developer
//     environment (`vcvars64.bat`): that sets VCINSTALLDIR (node-gyp uses it directly)
//     AND exports the Windows SDK paths from disk — no component registration needed.
//  4. The winpty sub-target requests Spectre-mitigated libraries (MSB8040) that a
//     default C++ install omits. We don't use winpty on Windows 10/11 (ConPTY is the
//     backend `windowsPtyAgent.js` loads), so we build with `/p:SpectreMitigation=false`.
//
// Requires Visual Studio 2017-2022 (v15-v17) Build Tools / IDE with the "Desktop
// development with C++" workload + a Windows SDK + Python on Windows. VS 2026 (v18)
// alone is NOT sufficient until node-gyp adds support for it. See the README.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const PKG = '@homebridge/node-pty-prebuilt-multiarch';
const root = process.cwd();
const ptyDir = path.join(root, 'node_modules', '@homebridge', 'node-pty-prebuilt-multiarch');

function run(file, args, opts = {}) {
  console.log('\n> ' + file + ' ' + args.join(' '));
  execFileSync(file, args, { stdio: 'inherit', ...opts });
}

if (process.platform !== 'win32') {
  // Unchanged from the original `electron-rebuild -f -o <pkg>` behavior.
  run(path.join(root, 'node_modules', '.bin', 'electron-rebuild'), ['-f', '-o', PKG]);
  process.exit(0);
}

// --- Windows: compile from source via a supported VS developer environment ---

const electronVersion = JSON.parse(
  readFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8'),
).version;
console.log('node-pty -> Electron', electronVersion, '(x64)');

// Find a node-gyp-supported Visual Studio: 2017-2022 (v15-v17) with the C++ toolset.
// The half-open range [15.0,18.0) deliberately EXCLUDES VS 2026 (v18), which node-gyp
// cannot use yet.
const vswhere = path.join(
  process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
  'Microsoft Visual Studio',
  'Installer',
  'vswhere.exe',
);
if (!existsSync(vswhere)) {
  throw new Error('vswhere.exe not found — install VS 2022 Build Tools ("Desktop development with C++").');
}
// `-products *` is required: vswhere excludes "BuildTools" installs by default
// (it only returns Enterprise/Pro/Community). `-all` includes installs in an
// incomplete/pending state. We validate by the presence of vcvars64.bat on disk
// rather than a component query, which can read stale after a partial install.
const candidates = execFileSync(
  vswhere,
  ['-all', '-prerelease', '-products', '*', '-version', '[15.0,18.0)', '-property', 'installationPath'],
  { encoding: 'utf8' },
)
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean);
let vsPath = null;
let vcvars = null;
for (const c of candidates) {
  const vc = path.join(c, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
  if (existsSync(vc)) {
    vsPath = c;
    vcvars = vc;
    break;
  }
}
if (!vcvars) {
  throw new Error(
    'No node-gyp-supported Visual Studio (2017-2022 / v15-v17) with the C++ build tools was found.\n' +
      'VS 2026 (v18) is not usable by node-gyp yet. Install "Visual Studio Build Tools 2022" with the\n' +
      '"Desktop development with C++" workload (incl. a Windows SDK), then re-run `npm run rebuild:pty`.',
  );
}
console.log('Using VS dev environment:', vsPath);

// Resolve node-gyp (Electron's fork preferred).
let nodeGyp = null;
for (const cand of ['@electron/node-gyp/bin/node-gyp.js', 'node-gyp/bin/node-gyp.js']) {
  try {
    nodeGyp = require.resolve(cand);
    break;
  } catch {
    /* try next */
  }
}
if (!nodeGyp) {
  throw new Error('node-gyp not found under node_modules (expected @electron/node-gyp or node-gyp).');
}

// Build inside the VS dev environment: `vcvars64.bat` sets VCINSTALLDIR (so node-gyp
// configure uses THIS install, not the unusable v18) and the Windows SDK env. Then
// MSBuild with Spectre mitigation off (see header note #4). Clearing
// NoDefaultCurrentDirectoryInExePath restores cmd.exe's CWD search, which winpty.gyp's
// `GetCommitHash.bat` step depends on.
const bat = [
  '@echo off',
  'set "NoDefaultCurrentDirectoryInExePath="',
  `call "${vcvars}" >nul || exit /b 1`,
  `cd /d "${ptyDir}" || exit /b 1`,
  `node "${nodeGyp}" configure --target=${electronVersion} --arch=x64 --dist-url=https://electronjs.org/headers || exit /b 1`,
  'msbuild build\\binding.sln /p:Configuration=Release /p:Platform=x64 /p:SpectreMitigation=false /nologo /v:m || exit /b 1',
  'echo BUILD_OK',
].join('\r\n');
const batPath = path.join(os.tmpdir(), 'nucleus-rebuild-pty.bat');
writeFileSync(batPath, bat);
try {
  run('cmd.exe', ['/d', '/s', '/c', batPath]);
} finally {
  try {
    rmSync(batPath, { force: true });
  } catch {
    /* best-effort */
  }
}

// Verify the backend node-pty's Windows agent loads.
const conpty = path.join(ptyDir, 'build', 'Release', 'conpty.node');
if (!existsSync(conpty)) {
  throw new Error('Build finished but conpty.node is missing: ' + conpty);
}
// Record the Electron version this binary was built FOR, so the packaging hook can verify the
// ABI matches (not just that the file exists) — a binary left over from an earlier Electron
// would pass an existence check but ship DEAD terminals. (Windows only; the packaging guard
// reads this back.)
writeFileSync(path.join(ptyDir, 'build', 'Release', '.nucleus-electron-abi'), electronVersion);
console.log('\nOK: built ' + path.relative(root, conpty) + ' for Electron ' + electronVersion);
