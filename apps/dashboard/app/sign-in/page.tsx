import { CircleAlert, Webhook } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export const metadata: Metadata = { title: "Sign in · Webhooks" };

// What went wrong, for each ?error= the API's GitHub callback (and lib/api.ts) can send here.
const errors: Record<string, string> = {
  denied: "You cancelled on GitHub, so you're not signed in.",
  state: "That sign-in didn't start here, or took too long. Try again.",
  github: "GitHub didn't confirm who you are. Try again in a moment.",
  expired: "You've been signed out. Sign in again to carry on.",
};

export default function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      {/* The address's ?error and ?next are only known per request: the card waits for them,
          and shows without a message meanwhile. */}
      <Suspense fallback={<SignInCard />}>
        <SignInFromAddress searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function SignInFromAddress({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  return <SignInCard error={error ? errors[error] : undefined} next={next} />;
}

function SignInCard({ error, next = "/" }: { error?: string; next?: string }) {
  return (
    <Card className="flex w-full max-w-100 flex-col gap-5 p-7">
      <div className="flex items-center gap-2.5 text-[17px] font-semibold">
        <Webhook aria-hidden className="size-5 text-accent" />
        Webhooks
      </div>
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-fg-2">
          Signed, retried webhooks for your customers, and a clear view of every one.
        </p>
      </div>
      {error && (
        <p role="alert" className="flex items-start gap-2 text-[13px] text-dead">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
      {/* A plain link, not next/link: the API answers with a redirect to GitHub, which needs a
          full page load. The API checks next too, so it can only lead back to this site. */}
      <Button asChild variant="primary" size="lg">
        <a href={`/api/auth/github?next=${encodeURIComponent(next)}`}>
          <GitHubMark />
          Continue with GitHub
        </a>
      </Button>
    </Card>
  );
}

// GitHub's mark (from GitHub's Octicons, MIT licence): Lucide no longer has brand logos.
function GitHubMark() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  );
}
