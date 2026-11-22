# Deepgram tenant voice output

DengTa can use a separate Deepgram Aura-2 profile for each authenticated
account and companion. MiniMax remains the server-wide fallback when a
Deepgram profile is absent or disabled.

## Deployment

1. Apply `supabase/027_voice_provider_profiles.sql` after migration 026.
2. Keep `MCP_ENCRYPTION_KEY` (or `AI_PROVIDER_ENCRYPTION_KEY`) configured with
   at least 32 characters. It is used by the existing AES-256-GCM credential
   vault. Do not place a Deepgram API key in environment files or source code.
3. Deploy the backend. The authenticated app configures the provider through
   `GET/PUT/POST/DELETE /api/v2/voice-output`.

An empty `credential` in a PUT request preserves the encrypted key already in
the profile. API responses expose only `credential_configured`; ciphertext and
plaintext credentials never leave the backend.

## Runtime

`POST /voice/speech` resolves the active tenant profile before generating
audio. A cache entry is partitioned by user, companion, provider, model,
region, speed, and profile update timestamp. Deepgram requests use only these
official hosts:

- `https://api.deepgram.com/v1/speak`
- `https://api.eu.deepgram.com/v1/speak`
- `https://api.au.deepgram.com/v1/speak`

No saved profile means “use the server default”. A saved profile whose
`enabled` value is false is an explicit opt-out: speech requests return
`VOICE_OUTPUT_DISABLED` and do not fall back to MiniMax.

Requests use `Authorization: Token ...`, MP3 output, a 2,000-character input
limit, a bounded timeout, and a 10 MiB output limit. Stored and public errors do
not include upstream response bodies or credentials.

Aura-2 currently supports English, Spanish, German, French, Dutch, Italian,
and Japanese. It does not currently provide an official Chinese TTS model, so
an enabled non-Japanese Aura profile automatically routes Chinese text through
the global MiniMax fallback without translating it. Chinese-first companions
therefore need MiniMax to remain configured.
