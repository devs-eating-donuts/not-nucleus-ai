import type { ReactNode } from 'react';

/**
 * Renders the small slice of Markdown the CLIs actually emit in conversational
 * replies — **bold**, `inline code`, blank-line paragraphs, single-line breaks,
 * and `-`/`*`/`1.` bullet lists. No HTML injection: everything is built from
 * React nodes, never dangerouslySetInnerHTML (CLI output is untrusted text).
 */

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`)/g;
const BULLET = /^\s*([-*]|\d+\.)\s+/;

function renderInline(text: string, keyBase: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const key = `${keyBase}-${i}`;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

export function MessageText({ text }: { text: string }) {
  // Blank lines separate paragraphs / blocks.
  const blocks = text.trim().split(/\n\s*\n/);

  return (
    <div className="msg-text">
      {blocks.map((block, bi) => {
        const lines = block.split('\n');
        const bulletLines = lines.filter((l) => BULLET.test(l));

        // A block that's mostly bullets becomes a list.
        if (bulletLines.length > 0 && bulletLines.length >= lines.filter((l) => l.trim()).length) {
          return (
            <ul key={bi} className="msg-list">
              {bulletLines.map((l, li) => (
                <li key={li}>{renderInline(l.replace(BULLET, ''), `${bi}-${li}`)}</li>
              ))}
            </ul>
          );
        }

        return (
          <p key={bi} className="msg-p">
            {lines.map((l, li) => (
              <span key={li}>
                {li > 0 && <br />}
                {renderInline(l, `${bi}-${li}`)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
