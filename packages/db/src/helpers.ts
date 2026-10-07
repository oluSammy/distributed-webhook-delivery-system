export function firstRow<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error("query returned no rows");
  }
  return row;
}

export function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    console.error(`${name} is not set`);
    process.exit(1);
  }

  return value;
}
