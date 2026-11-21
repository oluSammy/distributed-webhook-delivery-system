import { z } from "@hono/zod-openapi";
import {
  firstRow,
  generateSessionToken,
  hashSessionToken,
  randomBytes,
  toBase64Url,
} from "@wds/core";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Sql } from "postgres";
import { ApiError } from "../errors";
import { fromDashboard } from "../middleware/auth";
import { withDb } from "../middleware/db";
import type { AppEnv } from "../types";

// How long a sign-in lasts.
const SESSION_DAYS = 30;

export const SESSION_COOKIE = "session";

// Holds the state value (and where to go after) between /github and its callback, for 10 minutes.
const STATE_COOKIE = "oauth_state";
const STATE_COOKIE_OPTIONS = { path: "/api/auth", httpOnly: true, secure: true } as const;

// Sign in with GitHub. These are plain redirects, not JSON, so the router is a plain Hono one.
export const auth = new Hono<AppEnv>();

// GET /api/auth/github?next=/deliveries/3f9d…: sends the browser to GitHub to sign in.
auth.get("/github", (c) => {
  // A random value GitHub hands back unchanged. The callback checks it against this cookie, so a
  // callback this browser didn't start (a forged link) is refused.
  const state = toBase64Url(randomBytes(32));
  const next = safeNext(c.req.query("next"));
  setCookie(c, STATE_COOKIE, JSON.stringify({ state, next }), {
    ...STATE_COOKIE_OPTIONS,
    sameSite: "Lax",
    maxAge: 600,
  });

  const github = new URL("https://github.com/login/oauth/authorize");
  github.searchParams.set("client_id", c.env.GITHUB_CLIENT_ID);
  github.searchParams.set("redirect_uri", callbackUrl(c.env));
  github.searchParams.set("state", state);
  // No scope: the app asks only for the public profile (id, login, name, avatar).
  return c.redirect(github.toString());
});

// GET /api/auth/github/callback?code=…&state=…: GitHub sends the browser back here. Checks the
// state, asks GitHub who signed in, creates or updates the user and starts a session.
auth.get("/github/callback", withDb, async (c) => {
  const toSignIn = (error: string) => c.redirect(`${c.env.DASHBOARD_URL}/sign-in?error=${error}`);
  const saved = readState(getCookie(c, STATE_COOKIE));
  deleteCookie(c, STATE_COOKIE, STATE_COOKIE_OPTIONS);

  const { code, state, error } = c.req.query();
  if (error) {
    return toSignIn("denied"); // the person pressed Cancel on GitHub
  }
  if (!saved || !code || state !== saved.state) {
    return toSignIn("state");
  }
  const person = await githubUser(c.env, code);
  if (!person) {
    return toSignIn("github");
  }

  const token = await startSession(c.get("sql"), person);
  setCookie(c, SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true, // page scripts can't read it
    secure: true, // only sent over https (browsers make an exception for localhost)
    sameSite: "Lax", // not sent with other sites' form posts or fetches
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  return c.redirect(`${c.env.DASHBOARD_URL}${saved.next}`);
});

auth.post("/sign-out", withDb, async (c) => {
  if (!fromDashboard(c)) {
    throw new ApiError(403, "cross_site_request", "Sign out from the dashboard");
  }
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await c.get("sql")`delete from sessions where token_hash = ${await hashSessionToken(token)}`;
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
  return c.body(null, 204);
});

// Where GitHub sends the browser back to: the dashboard's address, which passes /api/… on to us.
function callbackUrl(env: Env): string {
  return `${env.DASHBOARD_URL}/api/auth/github/callback`;
}

// Only a path on the dashboard itself, like /deliveries/3f9d…; anything else becomes /. Without
// this, ?next=//evil.example would send people to another site after signing in.
function safeNext(next: string | undefined): string {
  return next?.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

const stateSchema = z.object({ state: z.string(), next: z.string() });

function readState(cookie: string | undefined): z.infer<typeof stateSchema> | null {
  try {
    return stateSchema.parse(JSON.parse(cookie ?? ""));
  } catch {
    return null;
  }
}

// The parts of GitHub's GET /user answer we keep.
const githubUserSchema = z.object({
  id: z.number().int(),
  login: z.string(),
  name: z.string().nullable(),
  avatar_url: z.string(),
});

type GitHubUser = z.infer<typeof githubUserSchema>;

// Trades the code for an access token, then reads the person's profile with it. null when GitHub
// refuses (a code that's expired or already used) or can't be reached. The token is used once and
// not kept: we need nothing else from GitHub.
async function githubUser(env: Env, code: string): Promise<GitHubUser | null> {
  try {
    const exchange = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: callbackUrl(env),
      }),
    });
    // A refused code still comes back as 200, with {"error": "bad_verification_code"}.
    const { access_token } = (await exchange.json()) as { access_token?: string };
    if (!access_token) {
      return null;
    }
    const profile = await fetch("https://api.github.com/user", {
      headers: {
        authorization: `Bearer ${access_token}`,
        accept: "application/vnd.github+json",
        "user-agent": "webhooks-dashboard", // GitHub's API refuses requests without one
      },
    });
    return profile.ok ? githubUserSchema.parse(await profile.json()) : null;
  } catch (err) {
    console.error("github sign-in failed", err);
    return null;
  }
}

// Creates the user, or refreshes their login, name and avatar (GitHub accounts can be renamed),
// then a session on their first tenant. At someone's first sign-in they have no tenant yet, so they
// get their own, as owner. Returns the token for the cookie.
async function startSession(sql: Sql, person: GitHubUser): Promise<string> {
  return sql.begin(async (tx) => {
    const { id: userId } = firstRow(
      await tx<{ id: string }[]>`
          insert into users (github_id, login, name, avatar_url)
          values (${person.id}, ${person.login}, ${person.name}, ${person.avatar_url})
          on conflict (github_id) do update
            set login = excluded.login, name = excluded.name, avatar_url = excluded.avatar_url
          returning id
        `,
    );

    let [membership] = await tx<{ tenant_id: string }[]>`
        select tenant_id from memberships where user_id = ${userId} order by created_at limit 1
      `;
    if (!membership) {
      membership = firstRow(
        await tx<{ tenant_id: string }[]>`
            with tenant as (
              insert into tenants (name) values (${`${person.name ?? person.login}'s workspace`})
              returning id
            )
            insert into memberships (tenant_id, user_id, role)
            select id, ${userId}, 'owner' from tenant
            returning tenant_id
          `,
      );
    }

    const { token, hash } = await generateSessionToken();
    await tx`
        insert into sessions (token_hash, user_id, tenant_id, expires_at)
        values (${hash}, ${userId}, ${membership.tenant_id},
                now() + make_interval(days => ${SESSION_DAYS}))
      `;
    return token;
  });
}
