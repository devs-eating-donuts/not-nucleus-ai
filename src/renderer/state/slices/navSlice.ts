import { isDefaultTeamReady } from '../../../shared/settings';
import type { AppState, StoreCtx } from '../appStoreShared';

type NavSlice = Pick<
  AppState,
  | 'navigate'
  | 'beginNewProject'
  | 'startBuildPitch'
  | 'addProjectToVenture'
  | 'beginRipItProject'
  | 'setStartFreshPitch'
  | 'setStartRipItFresh'
>;

/** Navigation + the "New Project" / Venture / Rip-it entry-point intent flags. */
export function createNavSlice({ set, get }: StoreCtx): NavSlice {
  return {
    navigate: (page, runId) =>
      set((s) => ({
        page,
        activeRunId: page === 'run-detail' ? (runId ?? null) : null,
        // The post-onboarding "Continue to Hacker Hostel" CTA lives on the Team page;
        // drop the flag the moment the user navigates anywhere else.
        justOnboarded: page === 'team' ? s.justOnboarded : false,
      })),

    beginNewProject: () => {
      // Guard against dead seats: a new project copies the global roster, so if any
      // lifecycle-chain role has no CLI the whole pipeline (pitch → design → build)
      // can't run. Route to the Default Team to set up + validate first; the Team page
      // shows a "Continue to New Project" CTA once the chain is assigned.
      if (!isDefaultTeamReady(get().settings.roles)) {
        set({ pendingNewProject: true, page: 'team', activeRunId: null });
        return;
      }
      // Surface the structural choice first ("one app" vs "a product, in pieces"),
      // then the "Define your project" step, then the same Erlich pitch. Reset the
      // build draft so a fresh entry never inherits a half-finished prior choice.
      set({
        pendingNewProject: false,
        pendingVenture: null,
        pendingTemplateId: null,
        pendingScaffoldId: null,
        pendingOverlayIds: [],
        page: 'new-build',
        activeRunId: null,
      });
    },

    startBuildPitch: ({ venture, templateId, scaffoldId, overlayIds }) =>
      set({
        startFreshPitch: true,
        pendingVenture: venture,
        pendingTemplateId: templateId,
        pendingScaffoldId: scaffoldId,
        pendingOverlayIds: overlayIds,
        page: 'new-run',
        activeRunId: null,
      }),

    addProjectToVenture: (ventureId, ventureName) => {
      // Same Default-Team readiness gate as beginNewProject — never drop the user into
      // a lifecycle that can't run. (Rare here: the venture's first project already
      // required a ready team. Keeps every new-project entry point consistent.)
      if (!isDefaultTeamReady(get().settings.roles)) {
        set({
          pendingNewProject: true,
          pendingVenture: null,
          pendingTemplateId: null,
          pendingScaffoldId: null,
          pendingOverlayIds: [],
          page: 'team',
          activeRunId: null,
        });
        return;
      }
      // Preset the Venture and jump into the define step (NewBuildPage sees the preset
      // venture on mount and skips the kind chooser, opening at "pick a starting point").
      set({
        pendingVenture: { id: ventureId, name: ventureName },
        pendingTemplateId: null,
        pendingScaffoldId: null,
        pendingOverlayIds: [],
        page: 'new-build',
        activeRunId: null,
      });
    },

    setStartFreshPitch: (value) => set({ startFreshPitch: value }),

    beginRipItProject: () => {
      // The express lane needs only Erlich (chat) + Dinesh (build); the RipItPage
      // itself nudges the user to assign them if either is missing, so there's no
      // hard team gate here — just open a fresh express form.
      set({
        startRipItFresh: true,
        pendingVenture: null,
        pendingTemplateId: null,
        pendingScaffoldId: null,
        pendingOverlayIds: [],
        page: 'rip-it',
        activeRunId: null,
      });
    },

    setStartRipItFresh: (value) => set({ startRipItFresh: value }),
  };
}
