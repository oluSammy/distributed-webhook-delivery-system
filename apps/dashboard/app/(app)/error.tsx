"use client";

import { CloudOff } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Problem } from "@/components/Problem";
import { Button } from "@/components/ui/Button";

// When a page fails to load: the API didn't answer, answered with an error, or a bug. In
// production Next.js hides a server error's details from the browser and sends a digest instead,
// which matches the line in the server's logs, so that's the reference shown.
export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const reference =
    error instanceof Error && "digest" in error && typeof error.digest === "string"
      ? error.digest
      : null;

  return (
    <Problem
      icon={CloudOff}
      title="This page couldn't load"
      actions={
        <>
          <Button variant="primary" onClick={() => retry()}>
            Try again
          </Button>
          <Button asChild>
            <Link href="/">Go to Overview</Link>
          </Button>
        </>
      }
    >
      <p>
        The service didn't answer, or something went wrong on our side. Trying again in a moment
        usually works.
      </p>
      {reference && (
        <p className="mt-3 text-[13px] text-fg-3">
          If it keeps happening, mention this reference:{" "}
          <code className="font-mono text-fg-2">{reference}</code>
        </p>
      )}
    </Problem>
  );
}
