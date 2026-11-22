-- Immersive chat visibility preferences, scoped per account and companion.
-- Existing rows and new companions default to hiding generation process and
-- hiding technical error details.

alter table if exists public.companion_chat_preferences
    add column if not exists hide_generation_process boolean not null default true;
alter table if exists public.companion_chat_preferences
    add column if not exists show_error_details boolean not null default false;

comment on column public.companion_chat_preferences.hide_generation_process is
    'Hide thinking, streaming progress, monologue and empty assistant drafts until visible content arrives.';
comment on column public.companion_chat_preferences.show_error_details is
    'Show technical error code and logs for chat failures. Details are stored even when hidden.';

notify pgrst, 'reload schema';
