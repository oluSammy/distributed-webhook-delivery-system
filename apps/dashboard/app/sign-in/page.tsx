import { CircleAlert, LogOut, Webhook } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Banner } from "@/components/ui/Banner";
import { Card } from "@/components/ui/Card";
import { GitHubButton } from "./GitHubButton";

export const metadata: Metadata = { title: "Sign in · Webhooks" };

// What went wrong, for each ?error= the API's GitHub callback can send here. "expired" (sent by
// lib/api.ts when a session ends) isn't something that went wrong: it has its own banner.
const errors: Record<string, string> = {
  denied: "You cancelled on GitHub, so you're not signed in.",
  state: "That sign-in didn't start here, or took too long. Try again.",
  github: "GitHub didn't confirm who you are. Try again in a moment.",
};

type SearchParams = Promise<{ error?: string; next?: string }>;

export default function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4 sm:p-6">
      <div className="flex w-full max-w-270 flex-wrap items-stretch gap-5">
        {/* The address's ?error and ?next are only known per request: the card waits for them,
            and shows without a message meanwhile. */}
        <Suspense fallback={<SignInCard />}>
          <SignInFromAddress searchParams={searchParams} />
        </Suspense>
        <AttemptsPreview />
      </div>
    </main>
  );
}

async function SignInFromAddress({ searchParams }: { searchParams: SearchParams }) {
  const { error, next } = await searchParams;
  return <SignInCard error={error} next={next} />;
}

function SignInCard({ error, next = "/" }: { error?: string; next?: string }) {
  const problem = error ? errors[error] : undefined;
  const back = pageName(next);
  return (
    <Card
      aria-labelledby="sign-in-h"
      className="flex flex-[1_1_380px] flex-col justify-center gap-6 p-7 sm:p-10"
    >
      <div className="flex items-center gap-2.5 text-[22px] font-semibold tracking-tight">
        <span
          aria-hidden
          className="grid size-9 place-items-center rounded-[11px] border border-accent-line"
        >
          <Webhook className="size-5 text-accent" />
        </span>
        Webhooks
      </div>
      <div className="flex flex-col gap-2">
        <h1 id="sign-in-h" className="text-[28px] font-semibold tracking-tight">
          Sign in
        </h1>
        <p className="text-[15px] text-fg-2">
          Signed, retried webhooks for your customers, and a clear view of every one.
        </p>
      </div>
      {error === "expired" && (
        <Banner tone="fail" icon={LogOut}>
          <strong>Signed out — sign in again.</strong> We'll take you back to {back}
          {back.endsWith("…") ? "" : "."}
        </Banner>
      )}
      {problem && (
        <Banner tone="dead" icon={CircleAlert}>
          {problem}
        </Banner>
      )}
      <GitHubButton next={next} retry={problem !== undefined} />
      <p className="text-[12.5px] text-fg-3">New here? Signing in creates your own workspace.</p>
    </Card>
  );
}

// Where "next" leads, in words: "/deliveries/3f9d2a10-…" → "Delivery 3f9d2a10…".
function pageName(next: string): string {
  const [section, id] = (next.split(/[?#]/)[0] ?? "").split("/").filter(Boolean);
  const names: Record<string, [list: string, one: string]> = {
    endpoints: ["Endpoints", "Endpoint"],
    deliveries: ["Deliveries", "Delivery"],
    events: ["Events", "Event"],
    dlq: ["the dead-letter queue", "the dead-letter queue"],
    settings: ["Settings", "Settings"],
  };
  const name = section ? names[section] : undefined;
  if (!name) {
    return "the Overview";
  }
  return id ? `${name[1]} ${id.slice(0, 8)}…` : name[0];
}

// Beside the sign-in card: one delivery's attempts failing, slowed down, then arriving, which is
// what the service does. Hidden from screen readers: it's an example, not data.
function AttemptsPreview() {
  return (
    <Card
      aria-hidden
      className="flex flex-[1_1_420px] flex-col justify-center gap-3.5 overflow-hidden bg-[radial-gradient(420px_300px_at_80%_10%,var(--accent-soft),transparent_70%),radial-gradient(300px_260px_at_10%_100%,color-mix(in_srgb,var(--accent)_8%,transparent),transparent_70%)] p-8"
    >
      <p className="text-[11.5px] font-medium tracking-wider text-fg-3 uppercase">
        order.paid → Billing service
      </p>
      <Attempt tone="fail" outcome="Failure" status="500" took="812 ms" />
      <p className="pl-3.5 text-[12.5px] text-fg-3">retried 23 s later</p>
      <Attempt tone="pend" outcome="Throttled" status="429" took="95 ms" />
      <p className="pl-3.5 text-[12.5px] text-fg-3">waited 15 s, as asked</p>
      <Attempt tone="ok" outcome="Success" status="200" took="143 ms" />
      <svg aria-hidden viewBox="0 0 400 80" preserveAspectRatio="none" className="mt-2 h-20 w-full">
        <path
          d="M0 60 C60 58 90 20 140 30 S220 70 270 40 S350 12 400 18"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M0 70 C70 66 110 44 160 50 S240 72 290 58 S360 40 400 44"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.5"
          opacity={0.4}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </Card>
  );
}

function Attempt({
  tone,
  outcome,
  status,
  took,
}: {
  tone: BadgeTone;
  outcome: string;
  status: string;
  took: string;
}) {
  return (
    <div
      className={`flex items-center gap-2.5 rounded-inset border bg-card-2 p-3.5 ${tone === "ok" ? "border-ok/40" : "border-line"}`}
    >
      <Badge tone={tone}>{outcome}</Badge>
      <span className="font-mono text-[12.5px]">{status}</span>
      <span className="ml-auto text-fg-3 tabular-nums">{took}</span>
    </div>
  );
}
