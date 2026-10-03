import postgres from 'postgres'

export function createDb(env: Env) {
    return postgres(env.HYPERDRIVE.connectionString, {
        max: 5,
        fetch_types: false // by default, postgres runs extra queries to learn about custom types in the db.
    })
}