-- next_auth schema
--
-- @auth/supabase-adapter が要求する公式 schema をそのまま採用する。
-- 出典: https://authjs.dev/getting-started/adapters/supabase (Auth.js 公式ドキュメント, 2026-08-08 取得)
-- テーブル定義・カラム名・制約は Adapter 側の実装 (@auth/supabase-adapter 1.11.3, index.js) が
-- 前提とする camelCase カラム名 (`emailVerified` / `sessionToken` / `providerAccountId` など) と一致させる。
--
-- 参考: docs/migration-design.md §5.1 (next_auth_schema)、docs/auth-design.md §4 (next_auth schema)

-- uuid_generate_v4() を使うため uuid-ossp を有効化する。
-- (公式 schema.sql は前提として触れていないが、id のデフォルト生成に必須のため追加する)
create extension if not exists "uuid-ossp" with schema extensions;

--
-- Name: next_auth; Type: SCHEMA;
--
create schema next_auth;

grant usage on schema next_auth to service_role;
grant all on schema next_auth to postgres;

--
-- Create users table
--
create table if not exists next_auth.users
(
    id uuid not null default extensions.uuid_generate_v4(),
    name text,
    email text,
    "emailVerified" timestamp with time zone,
    image text,
    constraint users_pkey primary key (id),
    constraint email_unique unique (email)
);

grant all on table next_auth.users to postgres;
grant all on table next_auth.users to service_role;

--- uid() function to be used in RLS policies
create function next_auth.uid() returns uuid
    language sql stable
    as $$
  select
    coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
$$;

--
-- Create sessions table
--
create table if not exists next_auth.sessions
(
    id uuid not null default extensions.uuid_generate_v4(),
    expires timestamp with time zone not null,
    "sessionToken" text not null,
    "userId" uuid,
    constraint sessions_pkey primary key (id),
    constraint sessiontoken_unique unique ("sessionToken"),
    constraint sessions_userid_fkey foreign key ("userId")
        references next_auth.users (id) match simple
        on update no action
        on delete cascade
);

grant all on table next_auth.sessions to postgres;
grant all on table next_auth.sessions to service_role;

--
-- Create accounts table
--
create table if not exists next_auth.accounts
(
    id uuid not null default extensions.uuid_generate_v4(),
    type text not null,
    provider text not null,
    "providerAccountId" text not null,
    refresh_token text,
    access_token text,
    expires_at bigint,
    token_type text,
    scope text,
    id_token text,
    session_state text,
    oauth_token_secret text,
    oauth_token text,
    "userId" uuid,
    constraint accounts_pkey primary key (id),
    constraint provider_unique unique (provider, "providerAccountId"),
    constraint accounts_userid_fkey foreign key ("userId")
        references next_auth.users (id) match simple
        on update no action
        on delete cascade
);

grant all on table next_auth.accounts to postgres;
grant all on table next_auth.accounts to service_role;

--
-- Create verification_tokens table
--
create table if not exists next_auth.verification_tokens
(
    identifier text,
    token text,
    expires timestamp with time zone not null,
    constraint verification_tokens_pkey primary key (token),
    constraint token_unique unique (token),
    constraint token_identifier_unique unique (token, identifier)
);

grant all on table next_auth.verification_tokens to postgres;
grant all on table next_auth.verification_tokens to service_role;

--
-- entodo 固有の追加 grant (公式 schema.sql には含まれない)
--
-- public.tasks / public.task_dependencies の RLS Policy (req.md §40〜43) は
-- `user_id = next_auth.uid()` を authenticated ロールとして評価する。
-- そのためには authenticated / anon ロールが next_auth schema を参照 (USAGE) でき、
-- next_auth.uid() を実行 (EXECUTE) できる必要がある。
-- 公式 schema.sql は Adapter 自身 (service_role 経由) の利用のみを想定しており、
-- これらの grant を含まないため、entodo 側で明示的に追加する。
grant usage on schema next_auth to authenticated, anon;
grant execute on function next_auth.uid() to authenticated, anon;
