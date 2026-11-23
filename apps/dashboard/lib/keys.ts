// An API key as GET /api/keys lists it: never the key itself.
export type ApiKey = {
  id: string;
  name: string;
  prefix: string; // its first characters, like whk_live_a1B2
  created_at: string;
  last_used_at: string | null; // to the minute; null if never used
};

// POST /api/keys' answer: the key, and the key itself, shown only this once.
export type CreatedApiKey = ApiKey & { key: string };
