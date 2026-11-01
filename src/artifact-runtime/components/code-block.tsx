import { useState } from 'react';

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  showLineNumbers?: boolean;
}

/**
 * A plain code block: the frame has no clipboard permission by default, so
 * the copy button uses `navigator.clipboard` and reports failure honestly
 * instead of pretending it copied. Syntax highlighting is deliberately absent
 * in the sandbox runtime — a highlighter would triple the vendored bundle for
 * a component agents rarely use.
 */
export function CodeBlock({
  code,
  language = 'text',
  filename,
  showLineNumbers = true,
}: CodeBlockProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const lines = code.replace(/\n$/, '').split('\n');

  function handleCopy(): void {
    navigator.clipboard
      .writeText(code)
      .then(() => setCopyState('copied'))
      .catch(() => setCopyState('failed'))
      .finally(() => {
        window.setTimeout(() => setCopyState('idle'), 2000);
      });
  }

  return (
    <div className="chord-code">
      <div className="chord-code-header">
        <span className="chord-code-label">{filename ?? language}</span>
        <button type="button" className="chord-code-copy" onClick={handleCopy}>
          {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy'}
        </button>
      </div>
      <pre className="chord-code-body" data-language={language}>
        {lines.map((line, index) => (
          <span key={index} className="chord-code-line">
            {showLineNumbers && <span className="chord-code-number">{index + 1}</span>}
            <span className="chord-code-text">{line}</span>
          </span>
        ))}
      </pre>
    </div>
  );
}
