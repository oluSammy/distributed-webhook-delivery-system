export function firstRow<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error("query returned no rows");
  }
  return row;
}
