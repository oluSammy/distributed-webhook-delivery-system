// The cookie that remembers a collapsed sidebar. A cookie, not localStorage, so the server draws
// the sidebar the right width from the start. In a plain module, not components/Sidebar.tsx: a
// server component (app/(app)/layout.tsx) importing a value from a "use client" file gets a
// reference for the browser instead of the value itself.
export const COLLAPSED_COOKIE = "sidebar";
