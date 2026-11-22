-- Allows the tenant-private voice provider profile to use OpenAI TTS.
-- The `model` column stores the OpenAI voice id (alloy/ash/...), because the
-- profile table is intentionally one-row-per-companion and the OpenAI model is
-- fixed by the DengTa adapter.

alter table public.voice_provider_profiles
    drop constraint if exists voice_provider_profiles_provider_check;

alter table public.voice_provider_profiles
    add constraint voice_provider_profiles_provider_check
    check (provider in ('server_default', 'deepgram', 'openai'));

notify pgrst, 'reload schema';
