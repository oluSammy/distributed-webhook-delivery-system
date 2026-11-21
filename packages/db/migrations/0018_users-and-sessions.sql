-- Up Migration

-- People who sign in to the dashboard, with GitHub. github_id is GitHub's own number for the
-- account: it never changes, while the login (the username) can be renamed on GitHub, so the login,
-- name and avatar are refreshed at each sign-in. is_operator marks the service's own staff.
create table users (
    id          uuid primary key default uuidv7(),
    github_id   bigint not null unique,
    login       text not null,
    name        text,
    avatar_url  text,
    is_operator boolean not null default false,
    created_at  timestamptz not null default now()
);

-- Who belongs to which tenant, and as what: an owner also manages the team and the settings.
create table memberships (
    tenant_id  uuid not null references tenants (id) on delete cascade,
    user_id    uuid not null references users (id) on delete cascade,
    role       text not null constraint memberships_role_valid check (role in ('owner', 'member')),
    created_at timestamptz not null default now(),
    primary key (tenant_id, user_id)
);

-- "Which tenants is this person in?", asked on every sign-in. The primary key starts with
-- tenant_id, so it can't answer that.
create index memberships_by_user on memberships (user_id);

-- A signed-in browser. The cookie holds a random token; only its SHA-256 is stored, like API keys,
-- so someone who reads the database still can't sign in. tenant_id is the tenant the dashboard is
-- showing. It must be one of the person's memberships (the foreign key), and removing someone from
-- a tenant ends their sessions on it (on delete cascade).
create table sessions (
    id         uuid primary key default uuidv7(),
    token_hash bytea not null unique,
    user_id    uuid not null,
    tenant_id  uuid not null,
    expires_at timestamptz not null,
    created_at timestamptz not null default now(),
    foreign key (tenant_id, user_id) references memberships (tenant_id, user_id) on delete cascade
);

-- For the maintenance job that deletes expired sessions.
create index sessions_by_expiry on sessions (expires_at);