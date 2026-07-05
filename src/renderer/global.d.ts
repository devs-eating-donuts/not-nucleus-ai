import type { NucleusApi } from '../shared/ipc';

declare global {
  interface Window {
    /** Exposed by the preload bridge. The renderer's only door to main. */
    nucleus: NucleusApi;
  }
}

export {};
