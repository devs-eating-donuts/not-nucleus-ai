import { useEffect, useRef, useState } from 'react';

/** A copy-to-clipboard button that flashes "Copied!" briefly on success. */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onCopy = () => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };

  return (
    <button type="button" className="btn sm" onClick={onCopy}>
      {copied ? 'Copied!' : label}
    </button>
  );
}
