-- Custom OpenAI-compatible TTS endpoint for the current voice provider.
-- Apply after 066. Both migrations are idempotent.

alter table public.voice_provider_profiles
    drop constraint if exists voice_provider_profiles_provider_check;

alter table public.voice_provider_profiles
    add constraint voice_provider_profiles_provider_check
    check (provider in ('server_default', 'deepgram', 'openai'));

alter table public.voice_provider_profiles
    add column if not exists base_url text;

alter table public.voice_provider_profiles
    add column if not exists tts_model text;

comment on column public.voice_provider_profiles.base_url is
    'Optional public HTTPS base URL for an OpenAI-compatible TTS endpoint; empty means official OpenAI.';
comment on column public.voice_provider_profiles.tts_model is
    'TTS model id for OpenAI-compatible endpoints; voice remains in model column.';

notify pgrst, 'reload schema';
