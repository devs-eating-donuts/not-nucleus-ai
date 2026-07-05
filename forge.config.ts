import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { execFileSync } from 'node:child_process';
import { DEFAULT_NAMING_MODE } from './src/shared/naming';

// The one native module we ship: a pseudo-terminal so PTY-only CLIs (agy) work.
const NATIVE_MODULE = '@homebridge/node-pty-prebuilt-multiarch';

// The rpm maker only runs on Linux, and Forge aborts the ENTIRE `make` (before building any
// target) if `rpmbuild` is missing — so on a Debian/Ubuntu box (dpkg, no rpm, the common Linux
// dev env) `npm run make` failed even for the .deb. Include the rpm maker only when rpmbuild is
// actually present; the .deb always builds. No-op off Linux.
function hasRpmbuild(): boolean {
  if (process.platform !== 'linux') {
    return true; // the rpm maker is platform-gated to linux, so it never runs here anyway
  }
  try {
    execFileSync('sh', ['-c', 'command -v rpmbuild'], { stdio: 'ignore' });
    return true;
  } catch {
    // eslint-disable-next-line no-console
    console.warn('[forge] rpmbuild not found — skipping the .rpm maker (the .deb still builds).');
    return false;
  }
}

// Release safety: a PUBLIC/distributed build must NOT default to a show-name parody
// mode (`canon`/`cover` — real Silicon Valley names). The public-safe defaults are
// `pete` (the original cast — the shipped default since the character-modes build)
// or `distinct` (the original riff names). Set NUCLEUS_PUBLIC_RELEASE=1 when
// packaging for distribution and this fails LOUDLY on a show-name default.
// Backstopped by a guarded unit test (naming.test.ts). Runs at config load →
// covers `package`, `make`, and `start` (all no-ops unless the flag is set, so
// day-to-day dev is unaffected). NOTE: a truly public release must also strip the
// locked casts' likeness assets (see docs/design/character-modes.md).
if (
  process.env.NUCLEUS_PUBLIC_RELEASE === '1' &&
  DEFAULT_NAMING_MODE !== 'pete' &&
  DEFAULT_NAMING_MODE !== 'distinct'
) {
  throw new Error(
    `Public release requires DEFAULT_NAMING_MODE='pete' or 'distinct' (src/shared/naming.ts), got ` +
      `'${DEFAULT_NAMING_MODE}'. Flip it before packaging for distribution, or unset ` +
      `NUCLEUS_PUBLIC_RELEASE for a private build.`,
  );
}

const config: ForgeConfig = {
  packagerConfig: {
    // Whole-module unpack — node-pty needs not just its *.node bindings but the
    // ConPTY helpers it execs at runtime (OpenConsole.exe, conpty.dll, winpty-*),
    // which a *.node-only unpack (auto-unpack-natives) would leave trapped in the
    // asar. Unpacking the module dir covers all of them.
    asar: { unpack: `**/node_modules/${NATIVE_MODULE}/**` },
    name: 'Nucleus-AI',
    executableName: 'nucleus-ai',
    appCopyright: 'Pipeline Labs. Powered by Hoolisoft.',
    // Packager appends the per-platform extension (.icns on macOS, .ico on
    // Windows). Regenerate from assets/icon.svg with `npm run icons`.
    icon: 'assets/icon',
  },
  // Rebuild NOTHING automatically. Forge's built-in rebuild shells out to
  // node-gyp, which needs a Visual Studio C++ toolchain that dev machines may not
  // have — and on `npm start` that crashes the whole app before it boots. node-pty
  // is `@homebridge/node-pty-prebuilt-multiarch` (prebuilt, no compile); dev uses
  // `npm run rebuild:pty` (electron-rebuild → prebuild-install, no toolchain) to
  // put the Electron-ABI binary in place, and packaging is handled by the
  // packageAfterPrune hook below.
  rebuildConfig: { onlyModules: [] },
  hooks: {
    // The Forge Vite plugin bundles the main process and ships NO node_modules,
    // so our externalized native dep is absent from the package. Inject it AFTER
    // pruning (so Forge's own afterCopy rebuild never sees — and chokes on — the
    // injected copy), rebuilt against the target Electron ABI. (Dev `npm start`
    // resolves it from node_modules normally; this hook only matters for
    // package/make.)
    packageAfterPrune: async (_forgeConfig, buildPath, electronVersion, _platform, arch) => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const src = path.join(process.cwd(), 'node_modules', NATIVE_MODULE);
      // Put the native module into the package's node_modules (the Vite plugin
      // ships none), built against the target Electron ABI in OUR node_modules —
      // our package.json lives here, whereas the copied app dir has none yet at
      // this stage (the Vite plugin writes it in a later hook).
      //
      // Windows is special: @electron/rebuild's stock node-gyp path CANNOT build
      // node-pty's winpty sub-target on this toolchain — it needs a supported VS
      // dev environment (VS 2022, not the unusable VS 2026), NoDefaultCurrentDirectory-
      // InExePath cleared (so winpty's GetCommitHash.bat resolves), and Spectre
      // mitigation off. That's exactly what `npm run rebuild:pty`
      // (scripts/rebuild-pty.mjs) does, and it is REQUIRED before packaging on
      // Windows. So on win32 we TRUST that already-Electron-ABI binary instead of
      // re-running the broken stock rebuild here (which fails at GetCommitHash.bat
      // and, with force:true, first WIPES the good binary). macOS/Linux keep the
      // stock rebuild, which works cleanly there.
      if (process.platform === 'win32') {
        const conpty = path.join(src, 'build', 'Release', 'conpty.node');
        if (!fs.existsSync(conpty)) {
          throw new Error(
            `node-pty is not built for the Electron ABI (${conpty} missing). ` +
              'Run `npm run rebuild:pty` before `npm run make` on Windows.',
          );
        }
        // Existence isn't enough: a conpty.node left over from an EARLIER Electron passes the
        // check above but ships DEAD terminals (ABI mismatch). `npm run rebuild:pty` records the
        // Electron version it built for in this marker; verify it matches what we're packaging.
        // A missing marker = a pre-marker binary → the existence check stands (never block a
        // valid build over a missing marker); a PRESENT marker that mismatches is a stale binary.
        const abiMarker = path.join(src, 'build', 'Release', '.nucleus-electron-abi');
        if (fs.existsSync(abiMarker)) {
          const builtFor = fs.readFileSync(abiMarker, 'utf8').trim();
          if (builtFor !== electronVersion) {
            throw new Error(
              `node-pty (conpty.node) was built for Electron ${builtFor}, but you are packaging ` +
                `Electron ${electronVersion} — the shipped terminals would be dead (ABI mismatch). ` +
                'Run `npm run rebuild:pty`, then `npm run make` again.',
            );
          }
        }
      } else {
        const { rebuild } = await import('@electron/rebuild');
        await rebuild({
          buildPath: process.cwd(),
          electronVersion,
          arch,
          force: true,
          onlyModules: [NATIVE_MODULE],
        });
      }
      fs.cpSync(src, path.join(buildPath, 'node_modules', NATIVE_MODULE), {
        recursive: true,
      });
    },
  },
  makers: [
    // Windows: Squirrel installer + the multi-resolution .ico.
    new MakerSquirrel({ setupIcon: 'assets/icon.ico' }),
    // macOS: a .dmg (the expected install experience) plus a .zip fallback.
    new MakerDMG({ icon: 'assets/icon.icns' }, ['darwin']),
    new MakerZIP({}, ['darwin']),
    // Linux: .deb always; .rpm only when rpmbuild is installed (else it aborts the whole make).
    ...(hasRpmbuild() ? [new MakerRpm({ options: { icon: 'assets/icon.png' } })] : []),
    new MakerDeb({ options: { icon: 'assets/icon.png' } }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Hardened runtime: no node CLI flags, no NODE_OPTIONS, asar integrity on.
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
