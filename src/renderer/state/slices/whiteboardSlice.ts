import type { AppState, StoreCtx } from '../appStoreShared';
import { hasBridge } from '../appStoreShared';

type WhiteboardSlice = Pick<
  AppState,
  'loadWhiteboardPlan' | 'draftWhiteboardPlan' | 'approveWhiteboardPlan' | 'setDeploymentPosture'
>;

/** The Whiteboard: Richard's drafted plan + approval + the deployment-posture control. */
export function createWhiteboardSlice({ set, get }: StoreCtx): WhiteboardSlice {
  return {
    loadWhiteboardPlan: async () => {
      const active = get().activeProject;
      if (!active || !hasBridge()) {
        return;
      }
      const target = active.registry.id;
      const plan = await window.nucleus.whiteboard.getPlan(target);
      if (get().activeProjectId !== target) {
        return;
      }
      set({ whiteboardPlan: plan });
    },

    draftWhiteboardPlan: async () => {
      const active = get().activeProject;
      if (!active || !hasBridge()) {
        return;
      }
      // Mode-not-concurrency (E3): a draft/re-draft unlinks EVERY task file and resets
      // the plan revision — under a live autopilot writer (a running build, an
      // intervention turn, a Punch List filing) the in-flight step would resurrect
      // old-plan task files into the new plan. Never interleave them.
      if (get().bullpenRunning || get().interventionSendingKey !== null || get().workRequestSending) {
        set({
          whiteboardError: get().bullpenRunning
            ? 'The build is running — stop The Bullpen before re-drafting the plan.'
            : 'A persona turn is still finishing — wait for it, then re-draft the plan.',
        });
        return;
      }
      set({ whiteboardDrafting: true, whiteboardError: null });
      try {
        const result = await window.nucleus.whiteboard.draft(active.registry.id);
        if (!result.ok) {
          set({ whiteboardError: result.error ?? 'The Architect could not draft a plan.' });
        }
        const plan = await window.nucleus.whiteboard.getPlan(active.registry.id);
        set({ whiteboardPlan: plan });
      } catch (err) {
        set({ whiteboardError: err instanceof Error ? err.message : String(err) });
      } finally {
        set({ whiteboardDrafting: false });
      }
    },

    approveWhiteboardPlan: async (approved) => {
      const active = get().activeProject;
      if (!active || !hasBridge()) {
        return false;
      }
      // "Send back" (approved=false) yanks the plan's approval out from under a
      // running build — same mode-not-concurrency rule as draftWhiteboardPlan.
      if (!approved && get().bullpenRunning) {
        set({ whiteboardError: 'The build is running — stop The Bullpen before sending the plan back.' });
        return false;
      }
      try {
        const plan = await window.nucleus.whiteboard.approve(active.registry.id, approved);
        // A successful approve/send-back clears any earlier guard error — otherwise a stale
        // "build is running" banner would sit under the now-approved plan indefinitely.
        set({ whiteboardPlan: plan, whiteboardError: null });
        return true;
      } catch (err) {
        // A rejection used to be an unhandled promise + a button that silently did
        // nothing (and the caller navigated to The Bullpen with nothing approved).
        set({ whiteboardError: err instanceof Error ? err.message : String(err) });
        return false;
      }
    },

    setDeploymentPosture: async (posture) => {
      const active = get().activeProject;
      if (!active || !hasBridge()) {
        return;
      }
      const id = active.registry.id;
      try {
        const info = await window.nucleus.project.setDeploymentPosture(id, posture);
        // Guard against a project switch mid-call — only apply to the same active project.
        set((s) =>
          s.activeProject && s.activeProject.registry.id === id
            ? { activeProject: { ...s.activeProject, info } }
            : {},
        );
      } catch {
        /* best-effort; the control reflects the persisted value on next open */
      }
    },
  };
}
