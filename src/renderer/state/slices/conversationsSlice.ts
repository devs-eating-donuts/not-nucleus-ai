import type { AppState, StoreCtx } from '../appStoreShared';
import { hasBridge } from '../appStoreShared';

type ConversationsSlice = Pick<
  AppState,
  | 'loadRoom'
  | 'sendRoomMessage'
  | 'retryRoomMessage'
  | 'loadIntervention'
  | 'sendInterventionMessage'
  | 'retryInterventionMessage'
  | 'kickoffRoom'
  | 'loadWorkRequest'
  | 'sendWorkRequest'
  | 'retryWorkRequest'
>;

/** The chat surfaces: design rooms, persona interventions, and the Punch List — all
 *  routed through the one shared chatTurn helper (guards, per-channel state, follow-ups). */
export function createConversationsSlice({ set, get, h }: StoreCtx): ConversationsSlice {
  const { chatTurn } = h;
  return {
    loadRoom: async (roleId) => {
      const active = get().activeProject;
      if (!active || !hasBridge()) {
        return;
      }
      const target = active.registry.id;
      const messages = await window.nucleus.room.getLog(target, roleId);
      if (get().activeProjectId !== target) {
        return;
      }
      // The disk log holds only SUCCESSFUL turns. If the in-memory conversation for
      // this same project ends with an unanswered user turn (a failed/timed-out send
      // awaiting Retry), replacing it with the disk log would permanently discard the
      // typed message AND the Retry path — merge the trailing user turn back instead.
      const inMemory = get().roomConversations[roleId] ?? [];
      const trailing = inMemory[inMemory.length - 1];
      const merged =
        trailing?.role === 'user' &&
        inMemory.length === messages.length + 1 &&
        get().roomSendingRole !== roleId
          ? [...messages, trailing]
          : messages;
      set({ roomConversations: { ...get().roomConversations, [roleId]: merged } });
    },

    // The room channel allows sends while a build runs (rooms execute in a temp
    // cwd with no autopilot, so there's no writer collision) — hence no refusal.
    // The overlapping-send drop is SURFACED (a silent no-op here left the Erlich
    // pitch panel "Waiting…" forever when another project's long turn was still
    // resolving; the scoped error opens the Continue gate).
    sendRoomMessage: async (roleId, text) =>
      chatTurn({
        text,
        current: get().roomConversations[roleId] ?? [],
        busy: get().roomSendingRole !== null,
        busyError: 'Another conversation is still finishing — give it a moment, then send again.',
        begin: (messages) =>
          set({
            roomConversations: { ...get().roomConversations, [roleId]: messages },
            roomSendingRole: roleId,
            roomError: null,
          }),
        send: (projectId, messages) =>
          window.nucleus.room.send(projectId, roleId, messages, get().namingMode),
        commit: (messages) =>
          set({ roomConversations: { ...get().roomConversations, [roleId]: messages } }),
        fail: (message) => set({ roomError: { roleId, message } }),
        end: () => set({ roomSendingRole: null }),
      }),

    retryRoomMessage: async (roleId) =>
      chatTurn({
        text: null,
        current: get().roomConversations[roleId] ?? [],
        busy: get().roomSendingRole !== null,
        // A retry's transcript is already on screen — begin only flags the turn.
        begin: () => set({ roomSendingRole: roleId, roomError: null }),
        send: (projectId, messages) =>
          window.nucleus.room.send(projectId, roleId, messages, get().namingMode),
        commit: (messages) =>
          set({ roomConversations: { ...get().roomConversations, [roleId]: messages } }),
        fail: (message) => set({ roomError: { roleId, message } }),
        end: () => set({ roomSendingRole: null }),
      }),

    // Intervention chats (Big Head / Dinesh / Gilfoyle). Mirrors the room-chat actions
    // (in-flight guard + post-await active-project guard) but keyed by `${roleId}:${taskId}`
    // so each persona keeps a separate thread about the same escalated task.
    loadIntervention: async (roleId, taskId) => {
      const active = get().activeProject;
      if (!active || !hasBridge()) {
        return;
      }
      const target = active.registry.id;
      const key = `${roleId}:${taskId}`;
      const result = await window.nucleus.intervention.load(target, roleId, taskId);
      if (get().activeProjectId !== target) {
        return;
      }
      set({
        interventionConversations: { ...get().interventionConversations, [key]: result.messages },
        interventionContexts: { ...get().interventionContexts, [key]: result.context ?? undefined },
      });
    },

    // The intervention channel runs the seat's CLI in the WORKSPACE with autopilot
    // (Dinesh edits files), so it must never overlap the autonomous Bullpen loop —
    // bullpenRunning folds into the SILENT busy guard (the chat input is already
    // visibly locked with a disabledNote during a run, so no error is surfaced).
    sendInterventionMessage: async (roleId, taskId, text) => {
      const key = `${roleId}:${taskId}`;
      return chatTurn({
        text,
        current: get().interventionConversations[key] ?? [],
        busy: get().interventionSendingKey !== null || get().bullpenRunning,
        begin: (messages) =>
          set({
            interventionConversations: { ...get().interventionConversations, [key]: messages },
            interventionSendingKey: key,
            interventionError: null,
          }),
        send: (projectId, messages) =>
          window.nucleus.intervention.send(projectId, roleId, taskId, messages, get().namingMode),
        commit: (messages) =>
          set({
            interventionConversations: { ...get().interventionConversations, [key]: messages },
          }),
        fail: (message) => set({ interventionError: { key, message } }),
        end: () => set({ interventionSendingKey: null }),
      });
    },

    retryInterventionMessage: async (roleId, taskId) => {
      const key = `${roleId}:${taskId}`;
      return chatTurn({
        text: null,
        current: get().interventionConversations[key] ?? [],
        busy: get().interventionSendingKey !== null || get().bullpenRunning,
        begin: () => set({ interventionSendingKey: key, interventionError: null }),
        send: (projectId, messages) =>
          window.nucleus.intervention.send(projectId, roleId, taskId, messages, get().namingMode),
        commit: (messages) =>
          set({
            interventionConversations: { ...get().interventionConversations, [key]: messages },
          }),
        fail: (message) => set({ interventionError: { key, message } }),
        end: () => set({ interventionSendingKey: null }),
      });
    },

    kickoffRoom: async (roleId) => {
      const active = get().activeProject;
      if (!active || !hasBridge()) {
        return;
      }
      // Only open an empty room, and don't double-fire while one is in flight.
      if ((get().roomConversations[roleId] ?? []).length > 0 || get().roomSendingRole !== null) {
        return;
      }
      const runProjectId = active.registry.id;
      set({ roomSendingRole: roleId, roomError: null });
      try {
        const result = await window.nucleus.room.kickoff(runProjectId, roleId, get().namingMode);
        // Bail if the user switched projects mid-flight.
        if (get().activeProjectId !== runProjectId) {
          return;
        }
        if (result.ok && result.reply.trim() !== '') {
          // Re-read the persisted log so races can't duplicate the opening line.
          const messages = await window.nucleus.room.getLog(runProjectId, roleId);
          if (get().activeProjectId === runProjectId) {
            set({ roomConversations: { ...get().roomConversations, [roleId]: messages } });
          }
        } else if (!result.ok && result.error) {
          set({ roomError: { roleId, message: result.error } });
        }
      } catch (err) {
        set({ roomError: { roleId, message: err instanceof Error ? err.message : String(err) } });
      } finally {
        if (get().roomSendingRole === roleId) {
          set({ roomSendingRole: null });
        }
      }
    },

    loadWorkRequest: async () => {
      const active = get().activeProject;
      if (!active || !hasBridge()) {
        return;
      }
      const target = active.registry.id;
      const messages = await window.nucleus.workRequest.getLog(target);
      if (get().activeProjectId !== target) {
        return;
      }
      set({ workRequestMessages: messages });
    },

    // E3 — the Punch List files tasks in the workspace, and the Bullpen's remediation
    // creators allocate task numbers in the same folder, so a turn is REFUSED (with a
    // surfaced error, unlike the visibly-locked intervention input) while a build runs.
    sendWorkRequest: async (text) =>
      chatTurn({
        text,
        current: get().workRequestMessages,
        busy: get().workRequestSending,
        refusal: get().bullpenRunning
          ? 'The build is running — pause The Bullpen before filing a Punch List item.'
          : null,
        begin: (messages) =>
          set({ workRequestMessages: messages, workRequestSending: true, workRequestError: null }),
        send: (projectId, messages) =>
          window.nucleus.workRequest.send(projectId, messages, get().namingMode),
        commit: async (messages, result) => {
          set({ workRequestMessages: messages });
          // Richard filed a task → refresh the board so it shows up on The Bullpen.
          if (result.createdTaskId) {
            await get().loadWhiteboardPlan();
          }
        },
        fail: (message) => set({ workRequestError: message }),
        end: () => set({ workRequestSending: false }),
      }),

    retryWorkRequest: async () =>
      chatTurn({
        text: null,
        current: get().workRequestMessages,
        busy: get().workRequestSending,
        refusal: get().bullpenRunning
          ? 'The build is running — pause The Bullpen before retrying.'
          : null,
        begin: () => set({ workRequestSending: true, workRequestError: null }),
        send: (projectId, messages) =>
          window.nucleus.workRequest.send(projectId, messages, get().namingMode),
        commit: async (messages, result) => {
          set({ workRequestMessages: messages });
          if (result.createdTaskId) {
            await get().loadWhiteboardPlan();
          }
        },
        fail: (message) => set({ workRequestError: message }),
        end: () => set({ workRequestSending: false }),
      }),
  };
}
