-- Shared, tenant-scoped cache for machine-generated image descriptions.
-- One row per identical image byte sequence per user/companion.
-- This intentionally uses a three-column uniqueness boundary:
--   (user_id, companion_id, sha256)
-- so the same bytes can be described once for chat and Moments, while
-- different tenants never share a row.
create table if not exists public.image_descriptions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.user_profiles(id) on delete cascade,
    companion_id uuid not null,
    sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
    mime_type text not null check (char_length(mime_type) between 3 and 100),
    byte_size bigint not null check (byte_size > 0),
    description text not null check (char_length(description) between 1 and 8000),
    source text not null default 'vision'
        check (source in ('vision', 'model')),
    model text not null default '' check (char_length(model) <= 160),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade,
    constraint image_descriptions_tenant_sha_uidx
        unique (user_id, companion_id, sha256)
);

create index if not exists image_descriptions_tenant_recent_idx
    on public.image_descriptions (user_id, companion_id, updated_at desc);

alter table public.image_descriptions enable row level security;
revoke all on table public.image_descriptions from anon, authenticated;
grant all on table public.image_descriptions to service_role;
