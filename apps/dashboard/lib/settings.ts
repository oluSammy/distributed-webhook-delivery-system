export const SETTINGS_SECTIONS = [
  { id: "general", label: "General" },
  { id: "api-keys", label: "API keys" },
  { id: "event-types", label: "Event types" },
  { id: "delivery", label: "Delivery settings" },
  { id: "usage", label: "Usage & limits" },
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"];

export function isSettingsSection(value: string): value is SettingsSection {
  return SETTINGS_SECTIONS.some((section) => section.id === value);
}
