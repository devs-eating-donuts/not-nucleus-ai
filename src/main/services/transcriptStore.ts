import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChatMessage } from '../../shared/room';
import { writeJsonAtomic } from './atomicWrite';

/**
 * Shared chat-transcript persistence for the three conversation engines
 * (design rooms / Punch List intake / intervention chats) — one copy of the
 * sanitize + read + write each engine used to hand-roll. Writes ride the
 * hardened writeJsonAtomic (unique temp + retried rename), so a transient
 * Windows file lock can no longer lose an already-paid-for CLI reply to a
 * single failed rename.
 */

/**
 * Persistence caps. Deliberately far above the PROMPT window (below): the old shared
 * 40-message / 8000-char cap silently rolled a long design session's EARLIEST
 * decisions off disk — and out of Richard's plan input — while the renderer still
 * showed them. Disk keeps the working history (a thorough Whiteboard
 * session with 6-14 lettered decisions realistically exceeds 40 turns; 24000 chars
 * fits a pasted spec); prompts apply `promptWindow` to stay bounded.
 */
const PERSIST_MESSAGE_CAP = 200;
const PERSIST_CHAR_CAP = 24000;
/** Interactive chat turns embed only the newest N messages (latency/cost bound). */
const PROMPT_MESSAGE_WINDOW = 40;

export function sanitizeChatMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(
      (m): m is ChatMessage =>
        m !== null &&
        typeof m === 'object' &&
        typeof (m as ChatMessage).text === 'string' &&
        ((m as ChatMessage).role === 'user' || (m as ChatMessage).role === 'persona'),
    )
    .map((m) => ({ role: m.role, text: m.text.slice(0, PERSIST_CHAR_CAP) }))
    .slice(-PERSIST_MESSAGE_CAP);
}

/**
 * The chat-turn prompt window: the newest 40 messages. Applied where a transcript is
 * rendered into an INTERACTIVE prompt (chat turns + cross-room context) — one-shot
 * consumers that need the whole history (Richard's plan draft) read the full log.
 */
export function promptWindow(messages: ChatMessage[]): ChatMessage[] {
  return messages.slice(-PROMPT_MESSAGE_WINDOW);
}

/** Read + sanitize a transcript file; [] when absent or corrupt (a fresh room). */
export async function readTranscript(absPath: string): Promise<ChatMessage[]> {
  try {
    const raw = await fs.readFile(absPath, 'utf8');
    return sanitizeChatMessages((JSON.parse(raw) as { messages?: unknown }).messages);
  } catch {
    return [];
  }
}

/**
 * Atomically persist a transcript. `extra` carries the channel's identity fields
 * (roleId / taskId), spread between schemaVersion and messages so the on-disk
 * shape stays byte-identical to each engine's previous writer.
 */
export async function writeTranscript(
  absPath: string,
  messages: ChatMessage[],
  extra: Record<string, unknown> = {},
): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await writeJsonAtomic(absPath, { schemaVersion: 1, ...extra, messages });
}
