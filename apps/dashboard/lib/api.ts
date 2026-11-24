import "server-only";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { PATH_HEADER } from "./path-header";

const apiUrl = process.env.API_URL ?? "http://localhost:8787";

// GETs from the API Worker on the server, as the signed-in person: their session cookie goes
// along, so the API decides what they may see. A 401 (signed out, or the session ended) goes to the
// sign-in page.
export async function apiGet<T>(path: string): Promise<T> {
  const session = (await cookies()).get("session");
  const response = await fetch(`${apiUrl}${path}`, {
    headers: session ? { cookie: `session=${session.value}` } : {},
  });

  if (response.status === 401) {
    const here = (await headers()).get(PATH_HEADER) ?? "/";
    redirect(`/sign-in?error=expired&next=${encodeURIComponent(here)}`);
  }

  if (response.status === 404) {
    notFound();
  }
  if (!response.ok) {
    throw new Error(`GET ${path} answered ${response.status}`);
  }
  return response.json() as Promise<T>;
}

// GET /api/me's answer.
export type Me = {
  user: {
    id: string;
    login: string;
    name: string | null;
    avatar_url: string | null;
    is_operator: boolean;
  };
  tenant_id: string;
  tenants: { id: string; name: string; role: "owner" | "member" }[];
  paused: { workspace: boolean; everyone: boolean }; // sending held, by an operator
};

// The signed-in person. cache() makes it one request per page view, however many components ask.
export const getMe = cache(() => apiGet<Me>("/api/me"));
