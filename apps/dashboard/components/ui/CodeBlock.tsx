"use client";

import { type ReactNode, useEffect, useState } from "react";
import type { ThemedToken } from "shiki/core";
import type { Language } from "@/lib/highlight";
import { CopyButton } from "./CopyButton";

// Colouring a very large payload would freeze the page for a moment: above this, show it plain.
const MAX_COLOURED_LENGTH = 100_000;

// Monospace text in a box with a copy button: a payload, a response body, a curl command.
// language colours it with Shiki; leave it out for plain text. The text shows straight away, and
// the colours follow once Shiki has loaded (in its own file, only on pages with a code block).
export function CodeBlock({
  code,
  language,
  copyLabel,
}: {
  code: string;
  language?: Language;
  copyLabel: string;
}) {
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null);

  useEffect(() => {
    setTokens(null);
    if (!language || code.length > MAX_COLOURED_LENGTH) return;
    let current = true;
    import("@/lib/highlight")
      .then(({ tokenize }) => tokenize(code, language))
      .then((lines) => current && setTokens(lines))
      // If Shiki fails to load, the plain text is already showing.
      .catch(() => {});
    // A newer code or language replaced this one: drop this result if it arrives late.
    return () => {
      current = false;
    };
  }, [code, language]);

  return (
    <div className="relative">
      <pre className="overflow-auto whitespace-pre-wrap break-words rounded-inset border border-line bg-card-2 py-3.5 pr-12 pl-4 font-mono text-[12.5px] leading-[1.65]">
        {tokens ? coloured(tokens) : code}
      </pre>
      <div className="absolute top-1.5 right-1.5">
        <CopyButton value={code} label={copyLabel} />
      </div>
    </div>
  );
}

// Each piece as a span in its colour, with a line break between lines. offset (where the piece
// starts in the code) is unique, so it serves as React's key.
function coloured(lines: ThemedToken[][]): ReactNode[] {
  return lines.flatMap((line, index) => [
    index > 0 && "\n",
    ...line.map((token) => (
      <span key={token.offset} style={{ color: token.color }}>
        {token.content}
      </span>
    )),
  ]);
}
