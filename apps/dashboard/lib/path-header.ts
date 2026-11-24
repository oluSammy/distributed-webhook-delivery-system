// The request header that carries the page's address from proxy.ts to lib/api.ts, so a page whose
// session has ended can send the person to sign in and back to it.
export const PATH_HEADER = "x-dashboard-path";
