-- Per-account, per-companion custom vision endpoint used only to describe
-- images for text-only chat models. Credentials are encrypted by the backend.

create table if not exists public.vision_provider_profiles (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    name text not null default '自定义视觉接口'
        check (char_length(name) between 1 and 80),
    base_url text not null,
    auth_type text not null default 'bearer'
        check (auth_type in ('bearer', 'none')),
    secret_ciphertext text,
    model text not null default '',
    enabled boolean not null default false,
    last_status text not null default 'untested'
        check (last_status in ('untested', 'configuration_ok', 'connected', 'error')),
    last_error_code text,
    last_checked_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade,
    unique (user_id, companion_id)
);

alter table public.vision_provider_profiles enable row level security;

revoke all on table public.vision_provider_profiles from anon, authenticated;
grant all on table public.vision_provider_profiles to service_role;

comment on table public.vision_provider_profiles is
    'Per-companion OpenAI-compatible vision endpoint used for image descriptions.';

notify pgrst, 'reload schema';
