import type { NamingMode } from './naming';
import { defaultPersonaForRole, personaDisplayName } from './personas';
import type { ChatMessage } from './room';
import type { RoleId } from './roles';
import { ROLE_DEFINITIONS } from './roles';
import { redactSecrets } from './secrets';

/**
 * Project export model. Turns a project's saved room transcripts (the conversations
 * with Erlich, Monica, Richard, and the Punch List) into one readable Markdown
 * document — so a user can keep their conversations before deleting a project and
 * re-pitch the idea cleanly later. Pure + Node/Electron-free (the main process reads
 * the transcripts off disk and calls this); unit tested.
 */

export interface ExportRoom {
  /** The persona speaking in this room (their reply attribution). */
  roleId: RoleId;
  /** Themed room name, e.g. 'The Pitch', 'Investor Pitch', 'The Whiteboard', 'The Punch List'. */
  title: string;
  messages: ChatMessage[];
}

export interface ProjectExportInput {
  projectName: string;
  createdAt: string;
  workspacePath: string;
  templateId: string | null;
  exportedAt: string;
  rooms: ExportRoom[];
}

/** A filesystem-safe slug for an export filename, e.g. "My App!" → "my-app". */
export function safeExportFileName(projectName: string): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug === '' ? 'project' : slug;
}

/**
 * A folder-unique export filename for a project, suffixing `-2`/`-3`… when a prior
 * project's name slug-collides (e.g. "Social Watch" / "social.watch" both → social-watch)
 * so a batch export never silently overwrites one project with another. Mutates `used`
 * (a set of taken lowercased names). Pure — unit tested.
 */
export function uniqueExportFileName(projectName: string, used: Set<string>): string {
  const base = `${safeExportFileName(projectName)}-nucleus-export`;
  let name = `${base}.md`;
  for (let n = 2; used.has(name.toLowerCase()); n += 1) {
    name = `${base}-${n}.md`;
  }
  used.add(name.toLowerCase());
  return name;
}

function speakerName(roleId: RoleId, mode: NamingMode): string {
  const persona = defaultPersonaForRole(roleId);
  return persona ? personaDisplayName(persona, mode) : ROLE_DEFINITIONS[roleId].label;
}

function renderRoom(room: ExportRoom, mode: NamingMode): string {
  const persona = speakerName(room.roleId, mode);
  const roleLabel = ROLE_DEFINITIONS[room.roleId].label;
  const lines: string[] = [`## ${room.title} — ${persona} (${roleLabel})`, ''];
  for (const m of room.messages) {
    const who = m.role === 'user' ? 'You' : persona;
    // Blockquote the body so multi-line replies stay attributed and readable.
    // Mask any secret-shaped value a founder may have pasted into chat before it
    // lands in an exported .md that can leave the workspace or be shared.
    const body = redactSecrets(m.text.trim()).split('\n').join('\n> ');
    lines.push(`**${who}:**`, '', `> ${body}`, '');
  }
  return lines.join('\n');
}

/**
 * Build the Markdown export. Rooms with no messages are skipped; if every room is
 * empty the document still carries the project header plus a short note.
 */
export function buildProjectExportMarkdown(input: ProjectExportInput, mode: NamingMode): string {
  const header: string[] = [
    `# ${input.projectName} — Nucleus-AI export`,
    '',
    `> Exported ${input.exportedAt}. Created ${input.createdAt}.` +
      (input.templateId ? ` Template: ${input.templateId}.` : ''),
    `> Workspace: \`${input.workspacePath}\``,
    '',
    'Your saved conversations for this project. Keep this if you want to re-pitch the idea',
    'cleanly later — deleting the project does not touch this file.',
    '',
    '---',
    '',
  ];
  const nonEmpty = input.rooms.filter((r) => r.messages.length > 0);
  const body =
    nonEmpty.length === 0
      ? '_No conversations were recorded for this project yet._\n'
      : nonEmpty.map((r) => renderRoom(r, mode)).join('\n---\n\n');
  return `${header.join('\n')}${body}`;
}
