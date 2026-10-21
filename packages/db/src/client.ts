import postgres from "postgres";

// A connection pool for one Worker call. Each Worker passes its Hyperdrive connection string.
export function createDb(connectionString: string) {
  return postgres(connectionString, {
    max: 5,
    fetch_types: false, // by default, postgres runs extra queries to learn about custom types in the db.
  });
}
