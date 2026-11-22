alter table public.channel_sync_preferences
    add column if not exists qq_include_persona_prompt boolean not null default false;

create table public.qq_cloud_connections (
    id uuid primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    companion_id uuid not null references public.companions(id) on delete cascade,
    app_id text not null unique,
    app_secret_encrypted text not null,
    stage text not null check (stage in ('awaiting_owner', 'active')),
    qq_owner text,
    pair_nonce uuid,
    pair_expires_at timestamptz,
    conversation_id text,
    lease_owner uuid,
    lease_until timestamptz,
    online boolean not null default false,
    created_at timestamptz not null default now(),
    unique (user_id, companion_id),
    check (
        (stage = 'awaiting_owner' and qq_owner is null and pair_nonce is not null and pair_expires_at is not null)
        or (stage = 'active' and qq_owner is not null and pair_nonce is null and pair_expires_at is null)
    )
);
create index qq_cloud_connections_lease_idx on public.qq_cloud_connections (lease_until);

create table public.qq_cloud_receipts (
    connection_id uuid not null references public.qq_cloud_connections(id) on delete cascade,
    message_id text not null,
    created_at timestamptz not null default now(),
    primary key (connection_id, message_id)
);
create index qq_cloud_receipts_age_idx on public.qq_cloud_receipts (created_at);

alter table public.qq_cloud_connections enable row level security;
alter table public.qq_cloud_receipts enable row level security;
revoke all on public.qq_cloud_connections, public.qq_cloud_receipts from public, anon, authenticated;
grant select, insert, update, delete on public.qq_cloud_connections, public.qq_cloud_receipts to service_role;

alter table public.channel_sync_preferences
    add column if not exists qq_receive_memory_candidates boolean not null default false;

alter table public.stable_memory_candidates
    add column if not exists qq_available_at timestamptz;

create index if not exists stable_memory_candidates_qq_pending_idx
    on public.stable_memory_candidates (user_id, companion_id, qq_available_at)
    where qq_available_at is not null and status = 'pending';

create or replace function public.queue_qq_memory_candidate(
    p_connection_id uuid, p_worker_id uuid, p_owner text, p_id uuid, p_summary text
) returns boolean
language sql
security invoker
set search_path = ''
as $$
    with queued as (
        insert into public.stable_memory_candidates
            (id, user_id, companion_id, summary, qq_available_at)
        select p_id, b.user_id, b.companion_id, btrim(p_summary), now() + interval '5 minutes'
        from public.qq_cloud_connections b
        join public.channel_sync_preferences p
          on p.user_id = b.user_id and p.companion_id = b.companion_id and p.channel = 'qq'
        where b.id = p_connection_id and b.lease_owner = p_worker_id and b.lease_until > now()
          and b.stage = 'active' and b.qq_owner = p_owner and p.qq_receive_memory_candidates
          and char_length(btrim(p_summary)) between 1 and 500
        on conflict (id) do nothing
        returning id
    )
    select exists (select 1 from queued);
$$;

create or replace function public.decide_qq_memory_candidate(
    p_user_id uuid, p_companion_id uuid, p_id uuid, p_accept boolean
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
    candidate_summary text;
begin
    update public.stable_memory_candidates
    set status = case when p_accept then 'confirmed' else 'rejected' end, decided_at = now()
    where id = p_id and user_id = p_user_id and companion_id = p_companion_id
      and status = 'pending' and qq_available_at <= now()
    returning summary into candidate_summary;

    if not found then return false; end if;

    if p_accept then
        insert into public.memories (user_id, companion_id, summary, confirmation_status)
        values (p_user_id, p_companion_id, candidate_summary, 'confirmed');
    end if;
    return true;
end;
$$;

grant select, insert, update on public.stable_memory_candidates to service_role;
revoke all on function public.queue_qq_memory_candidate(uuid, uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.decide_qq_memory_candidate(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.queue_qq_memory_candidate(uuid, uuid, text, uuid, text) to service_role;
grant execute on function public.decide_qq_memory_candidate(uuid, uuid, uuid, boolean) to service_role;
notify pgrst, 'reload schema';
