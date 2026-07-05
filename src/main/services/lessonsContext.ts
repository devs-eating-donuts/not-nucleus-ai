import path from 'node:path';
import { techTagsFor } from '../../shared/lessons';
import type { RoleId } from '../../shared/roles';
import { getTemplateById } from '../../shared/templates';
import { knownPitfallsBlock } from './lessonsInjection';
import { readProjectInfo } from './markdownWorkspace';

/** The project's archetype + stack + provenance id, for lesson tagging/injection. */
export interface TechContext {
  archetype: string | null;
  stack: string[];
  projectId: string;
}

/** Derive the project's tech context (best-effort — missing info → empty). */
export async function loadTechContext(workspacePath: string): Promise<TechContext> {
  const info = await readProjectInfo(workspacePath).catch(() => null);
  const archetype = info?.templateId ?? null;
  const stack = archetype ? (getTemplateById(archetype)?.suggestedStack ?? []) : [];
  return { archetype, stack, projectId: path.basename(workspacePath) };
}

/**
 * Trailing "Known pitfalls" advisory block for a persona's prompt, or '' when nothing
 * confirmed matches (the common early-build case → prompts stay byte-identical). Shared by
 * the Bullpen build loop, the chat rooms, and the intervention chats so every persona is
 * steered by the same cross-build lessons store. Best-effort — never throws.
 */
export async function pitfallsSuffix(workspacePath: string, roleId: RoleId): Promise<string> {
  try {
    const tc = await loadTechContext(workspacePath);
    const tags = techTagsFor({ archetype: tc.archetype, stack: tc.stack, roleId });
    const block = await knownPitfallsBlock(tags, roleId, tc.archetype ?? '');
    return block ? `\n\n${block}` : '';
  } catch {
    return '';
  }
}
