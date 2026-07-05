import { useEffect, useState } from 'react';
import type { RoleId } from '../../shared/roles';
import { useAppStore } from '../state/appStore';
import { RoomChat } from './RoomChat';
import { StatusBadge } from './StatusBadge';
import type { BadgeTone } from './StatusBadge';

function statusTone(status: string): BadgeTone {
  if (status === 'verified' || status === 'done') return 'ok';
  if (status === 'human-needed' || status === 'blocked') return 'error';
  if (status === 'in-progress') return 'info';
  return 'neutral';
}

/**
 * A persona intervention tab on The Bullpen (Big Head / Dinesh / Gilfoyle). A
 * human-in-the-loop chat about an escalated task: seeded with the task + its
 * acceptance criteria + the role-appropriate review tail, the seat's CLI runs in
 * the workspace cwd so the persona can inspect the real code (Dinesh can also fix
 * it). "Re-run QA" hands the task back to the autonomous loop.
 */
export function InterventionTab({
  roleId,
  taskId,
  personaName,
  onResumeQa,
  qaRunning,
}: {
  roleId: RoleId;
  taskId: string;
  personaName: string;
  onResumeQa: () => void;
  qaRunning: boolean;
}) {
  const conversations = useAppStore((s) => s.interventionConversations);
  const contexts = useAppStore((s) => s.interventionContexts);
  const sendingKey = useAppStore((s) => s.interventionSendingKey);
  const error = useAppStore((s) => s.interventionError);
  const bullpenRunning = useAppStore((s) => s.bullpenRunning);
  const loadIntervention = useAppStore((s) => s.loadIntervention);
  const sendInterventionMessage = useAppStore((s) => s.sendInterventionMessage);
  const retryInterventionMessage = useAppStore((s) => s.retryInterventionMessage);
  const projectId = useAppStore((s) => s.activeProject?.registry.id ?? null);
  const [openErr, setOpenErr] = useState<string | null>(null);

  const openInVscode = () => {
    if (!projectId) return;
    setOpenErr(null);
    void window.nucleus.buildTools
      .openInVscode(projectId)
      .then((r) => {
        if (!r.ok) setOpenErr(r.error ?? 'Could not open VS Code.');
      })
      .catch((e) => setOpenErr(e instanceof Error ? e.message : 'Could not open VS Code.'));
  };

  const key = `${roleId}:${taskId}`;

  useEffect(() => {
    void loadIntervention(roleId, taskId);
  }, [roleId, taskId, loadIntervention]);

  const taskCtx = contexts[key] ?? null;
  const messages = conversations[key] ?? [];

  return (
    <div className="section">
      <div className="section-heading">
        <h2>
          {personaName} · {taskId}
        </h2>
        <span className="section-note">
          Talk it through — {personaName} can inspect the code in the workspace.
        </span>
      </div>

      {taskCtx && (
        <div className="card intervention-context">
          <div className="role-card-top">
            <div className="role-persona">
              {taskCtx.taskId} — {taskCtx.title}
            </div>
            <StatusBadge tone={statusTone(taskCtx.status)} label={taskCtx.status} dot={false} />
          </div>
          {taskCtx.goal && <p style={{ marginTop: 6 }}>{taskCtx.goal}</p>}
          {taskCtx.acceptanceCriteria.length > 0 && (
            <div className="intervention-acs">
              <strong>Acceptance criteria</strong>
              <ul>
                {taskCtx.acceptanceCriteria.map((a) => (
                  <li key={a.id}>
                    <code>{a.id}</code> {a.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {taskCtx.reviewTail && (
            <details className="intervention-qa">
              <summary>{taskCtx.reviewLabel}</summary>
              <pre>{taskCtx.reviewTail}</pre>
            </details>
          )}
          <div className="intervention-actions">
            <button
              type="button"
              className="btn primary sm"
              onClick={onResumeQa}
              disabled={qaRunning}
              title="Mark the task ready and re-run QA on it in the Bullpen"
            >
              Re-run QA →
            </button>
            <button
              type="button"
              className="btn sm"
              onClick={openInVscode}
              disabled={!projectId}
              title="Open the project workspace in VS Code to look around or make manual edits"
            >
              Open in VS Code
            </button>
            {openErr && <span className="intervention-open-err">{openErr}</span>}
          </div>
        </div>
      )}

      <RoomChat
        personaName={personaName}
        roleId={roleId}
        messages={messages}
        sending={sendingKey === key}
        error={error?.key === key ? error.message : null}
        onSend={(text) => void sendInterventionMessage(roleId, taskId, text)}
        onRetry={() => void retryInterventionMessage(roleId, taskId)}
        placeholder={`Ask ${personaName} about this task…`}
        disabledNote={
          bullpenRunning
            ? `Pause the build (Stop) before asking ${personaName} — the team is working in the workspace right now.`
            : undefined
        }
      />
    </div>
  );
}
