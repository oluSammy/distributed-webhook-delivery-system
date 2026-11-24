"use client";

import "./globals.css";
import { useEffect } from "react";

// The last resort, when even the root layout fails. It replaces the whole document, so it brings
// its own <html>, <body> and styles, and plain elements: nothing that could fail the same way.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <title>Something went wrong · Webhooks</title>
        <main className="mx-auto flex max-w-lg flex-col items-center gap-3 px-5 py-24 text-center">
          <h1 className="text-[22px] font-semibold">Something went wrong</h1>
          <p className="text-fg-2">
            The dashboard couldn't start. Trying again in a moment usually works.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            className="mt-2 h-10 cursor-pointer rounded-full bg-accent px-5 font-medium text-accent-ink"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
