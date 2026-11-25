"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { isSettingsSection } from "@/lib/settings";

// /settings on its own: go to a section. An old address like /settings#api-keys goes to that
// section's page. The part after # never reaches the server, so this has to happen in the browser.
export function SettingsRedirect() {
  const router = useRouter();
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    router.replace(`/settings/${isSettingsSection(hash) ? hash : "general"}`);
  }, [router]);
  return null;
}
