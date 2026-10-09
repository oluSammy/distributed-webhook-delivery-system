export function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    console.error(`${name} is not set`);
    process.exit(1);
  }

  return value;
}
