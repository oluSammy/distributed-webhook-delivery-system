import type { Metadata } from "next";
import { SettingsLoading } from "./SettingsLoading";
import { SettingsRedirect } from "./SettingsRedirect";

export const metadata: Metadata = { title: "Settings · Webhooks" };

// Each section has its own page (/settings/general, /settings/api-keys…); this one only sends you
// on to one of them.
export default function SettingsPage() {
  return (
    <>
      <SettingsRedirect />
      <SettingsLoading />
    </>
  );
}
