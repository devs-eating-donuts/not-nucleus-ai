import { defineConfig } from 'vite';

// Main-process build. The Forge Vite plugin supplies entry/externals;
// we pin the output filename so main and preload (both `index.ts` in
// their own folders) never collide in .vite/build.
export default defineConfig({
  build: {
    rollupOptions: {
      // node-pty is a native module — never bundle it; require it at runtime from
      // node_modules. In packaged builds it is unpacked from the asar via the
      // EXPLICIT `asar.unpack` glob in forge.config.ts (NOT the auto-unpack-natives
      // plugin — this app does not use it; following that trail would silently kill
      // packaged PTY). The Forge plugin's own externals (Node builtins + electron)
      // are merged in on top of this.
      external: ['@homebridge/node-pty-prebuilt-multiarch'],
      output: {
        entryFileNames: 'main.js',
      },
    },
  },
});
