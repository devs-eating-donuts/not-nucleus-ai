import { rankLessonsForInjection, renderPitfallsBlock } from '../../shared/lessons';
import { lessonsStore } from './lessonsStore';

/**
 * The injected "Known pitfalls" block for a build step, or '' when nothing confirmed
 * matches. Queries the store for confirmed lessons sharing a tag, ranks them
 * (role-match first, then overlap/occurrences/recency), enforces the char budget, and
 * renders the advisory free-text block. Empty string = inject nothing (the common case
 * for early builds, so prompts stay byte-identical until lessons actually exist).
 */
export async function knownPitfallsBlock(
  techTags: string[],
  roleId: string,
  stackLabel: string,
): Promise<string> {
  if (techTags.length === 0) {
    return '';
  }
  const confirmed = await lessonsStore.confirmedFor(techTags);
  if (confirmed.length === 0) {
    return '';
  }
  const ranked = rankLessonsForInjection(confirmed, techTags, roleId);
  return renderPitfallsBlock(ranked, stackLabel);
}
