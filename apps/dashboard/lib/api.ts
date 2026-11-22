import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

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
    redirect("/sign-in?error=expired");
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
};

// The signed-in person. cache() makes it one request per page view, however many components ask.
export const getMe = cache(() => apiGet<Me>("/api/me"));
