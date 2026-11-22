# llm-nursery for DengTa: source audit and low-cost native design

Status: implementation-ready research. This document did not change production code, database schema, prompts, user data, provider settings, or deployment.

Reviewed upstream repository: `tsuru0805/llm-nursery`

Reviewed upstream commit: [`4a4549ae68117b6367eeba9dff4f2dac2bce8f7d`](https://github.com/tsuru0805/llm-nursery/commit/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d), the repository `HEAD` observed on 2026-08-02. The package version at that commit is `0.2.1`.

## Decision

Do not deploy the upstream Python/MCP server as a second DengTa backend, and do not make the companion's normal chat use the upstream Markov model.

Implement the useful nursery mechanics natively in the existing Node/Supabase service:

1. Supabase remains the only production source of truth.
2. Every nursery row is owned by the authenticated `user_id + companion_id` pair.
3. The companion continues to use DengTa's current provider-compatible chat path.
4. The child's own babble/early speech may use an independently implemented local character learner, so it adds no provider request.
5. User custom instructions, `user_details`, and existing first-person companion memories are read-only from the nursery feature's perspective. Nursery code must never overwrite or append to those fields.
6. Nursery state enters an existing model request only as a small, explicitly bounded dynamic context block when that turn concerns the child. It is not a new system-persona layer and does not create a second model call.
7. The optional upstream LLM "psyche" call is off in the DengTa MVP. Deterministic state transitions provide the child psychology/gameplay without extra tokens or provider compatibility problems.

This preserves the requested companion experience while making the nursery feature inexpensive, inspectable, and compatible with every provider DengTa already supports.

## What the upstream project actually is

The project is a 36-day parenting simulation. Its child learns characters from caregiver corpus in a local variable-order Markov model, gains speaking capability by age stage, receives scheduled night events, tracks caregiver behavior, may run away, and eventually reaches one of five endings. It explicitly says the child cannot have normal semantic chat; its apparent reactions come from timing, local text recombination, a state machine, and an optional LLM anchor-word layer ([README lifecycle](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/README.md#L20-L33), [normal-chat limitation](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/README.md#L140-L155)).

The useful distinction for DengTa is therefore:

- **Companion voice:** keep DengTa's normal LLM conversation.
- **Child voice:** a deliberately immature, locally learned voice can be a separate nursery feature.
- **Narration:** the existing companion may react to child state during an already-required chat call; the nursery does not need its own narrator model.

## License and implementation boundary

Upstream is MIT licensed ([LICENSE](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/LICENSE#L1-L20)). MIT permits use, modification, distribution, sublicensing, and sale, provided copies or substantial portions retain the copyright and permission notice.

There is no license incompatibility that forces a clean-room rewrite. Nevertheless, a DengTa-native independent implementation is the better engineering choice because the upstream runtime, storage, identity model, and provider path do not match DengTa. If any upstream source is copied substantially, its MIT notice must be included in DengTa's third-party notices. General ideas, state-machine concepts, and standard algorithms can be implemented independently with DengTa names, schema, interfaces, and tests.

Recommended source boundary:

- do not vendor the Python package or MCP server;
- do not copy player-facing prose, prompts, comments, or tests;
- do not copy the `papa`/`mama` identity assumptions;
- independently implement deterministic stage calculation, state settlement, idempotent events, and a local child-language learner;
- retain this audit as design provenance;
- this is technical guidance, not legal advice.

## Runtime and entry points

The package declares Python `>=3.10`, no core dependencies, optional `mcp>=1.0`, optional `python-dotenv`, and `pytest` for development ([pyproject](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/pyproject.toml#L1-L23)).

Its runtime surfaces are:

- short-lived CLI processes for birth, status, feeding, care, naming, and maintenance;
- a `--tick` process expected every 1-5 minutes;
- a thin MCP wrapper over stdio or unauthenticated Streamable HTTP ([server](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/server.py#L1-L45));
- one SQLite file per configured caregiver persona;
- POSIX `fcntl` locks, so the upstream runtime is macOS/Linux oriented and is not portable as-is to Windows/Android ([driver](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/driver.py#L1-L27)).

These are all reasons to use the current DengTa Node process, Supabase, and background-job worker instead of adding a Python sidecar.

## Upstream data model

The SQLite v8 schema is documented and implemented in [`nursery/db.py`](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/db.py#L14-L247).

| Area | Upstream tables | Purpose |
|---|---|---|
| Identity/lifecycle | `child`, `child_state` | Name, lifecycle status, birth/pause time, RNG, ending, appearance, current state |
| Auditable actions | `action_log` | Append-only caregiver/system actions with idempotency and before/after state versions |
| Learned language | `corpus_item`, `model_snapshot`, `utterance` | PII-scrubbed corpus, compressed model snapshots, generated speech and rejection evidence |
| Time/events | `scheduled_event`, `outbox` | Due/expiry state and at-least-once webhook delivery |
| Durable game history | `growth_album` | Naming, first words, stage changes, appearance, and endings |
| Deterministic psyche | `psyche_axis`, `psyche_axis_log` | Anxiety, independence, and esteem plus append-only changes |
| Optional model psyche | `psyche_decision` | Prompt digest, structured LLM result, model/usage/latency/error audit |
| Language texture | `chunk_index`, `parenting_meta` | Derived family phrases and once-per-period markers |
| Relationships | `caregiver_bond`, `caregiver_bond_log` | Attachment, trust, predictability, resentment for fixed caregiver slots |

Important implementation properties:

- the database requires an explicit path and uses WAL, foreign keys, busy timeout, and transactional schema migration ([database open](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/db.py#L250-L267));
- public writes open `BEGIN IMMEDIATE`, reject nested top-level transactions, and roll back atomically ([transaction helper](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/child.py#L46-L57));
- corpus and action writes are idempotent and model state is replayable from corpus when a snapshot is missing or invalid ([brain load](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/child.py#L442-L518), [feeding transaction](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/child.py#L544-L633));
- the upstream code creates a full model snapshot on a normal feed and retains older snapshot rows. That is reasonable for a local toy but can cause avoidable hosted storage growth ([snapshot write](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/child.py#L520-L532), [feed snapshot](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/child.py#L605-L628)).

## Lifecycle and state transitions

### Identity and name

Upstream supports an unnamed active child as well as an embryo placeholder. `embryo -> active` creates state; naming is one-time and may be chosen directly or deterministically weighted by characters the child has heard ([create/hatch](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/child.py#L62-L170)).

For the requested DengTa flow, create one **unnamed active child** now (`name = null`, `born_at = now`) and expose naming later. An embryo state is optional and is not required to satisfy “name later.”

### Age stages

Stage is derived from logical age rather than stored: infant 0-4 days, toddler 4-12, child 12-24, teen 24-36, adult thereafter. The policy is versioned so later duration changes do not silently rewrite an existing child's history ([stage policy](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/config.py#L1-L43)).

### State and care

Mood, health, intimacy, nutrition, fatigue, darkness, and digest load settle lazily from elapsed time. Care actions apply bounded deltas; repeated same-day care decays; corpus overload reduces training weight. Each action is recorded with an idempotency key and state-version transition. These are deterministic local computations, not prompt behavior.

### Speech growth

The local model counts character transitions at orders 0-5 and samples from the highest available order with probabilistic backoff ([model](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/model.py#L22-L104)). Age controls maximum order, length, temperature, vocabulary unlock ratio, repetition, and overlap limit. Output retries up to 30 times and rejects recent duplicates or excessive source overlap ([decoder](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/decoder.py#L32-L108), [overlap implementation](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/guard.py#L58-L124)).

For DengTa, this local learner should generate only the child's nursery utterances. It must not replace, filter, or rewrite the companion's LLM reply.

### Scheduled events and endings

Night events use a deterministic `(child_id, date)` seed, idempotency keys, explicit expiry, and drop-late behavior ([night scheduling](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/scheduler.py#L60-L163)). The scheduler also performs optional corpus sampling, daily phrase consolidation, observation derivation, event evaluation, outbox delivery, and optional psyche calls ([tick](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/scheduler.py#L254-L339)).

In teen stage, high darkness can move `active -> runaway`; after at least 12 hours, a sufficiently overlapping caregiver phrase can move `runaway -> active` ([runaway](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/events.py#L458-L482), [homecoming](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/child.py#L721-L758)). Adult state lasts 1.5 days before `active -> graduated`, with five endings derived from intimacy, darkness, language diversity, night-response rate, refusal rate, and runaways ([ending](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/events.py#L485-L555)).

The growth portrait is read-only and derived from state, relationships, night responses, corpus, language statistics, and milestone rows ([portrait](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/portrait.py#L23-L118)). This is a strong concept to reproduce.

## Prompt/model calls and cost

### Core upstream cost

Core child speech, state settlement, scheduling, milestones, portrait, and endings require **zero model/API calls**. They use Python/SQLite CPU and storage only.

### Optional upstream psyche cost

The optional psyche layer builds a prompt from stage, age, appearance, relationship/psyche trends, recent actions/events, growth album, and recent child utterances ([input assembly](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/psyche.py#L215-L297)). It sends one `user` message to an OpenAI-compatible `/chat/completions` endpoint, defaults to `deepseek-v4-flash`, disables thinking, sets `max_tokens=500`, and has a 20-second timeout ([request](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/psyche.py#L300-L327)).

Calls start at toddler stage, require new activity, are throttled to at most once per hour, and are capped at 24 real network calls per day. Failures are recorded and child speech falls back to the local model ([gates](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/psyche.py#L401-L498)).

Maximum configured call count is `24 * 30 = 720` calls in a 30-day month. The output-token ceiling is `720 * 500 = 360,000` tokens, although normal JSON decisions should be shorter. At the official DeepSeek price visible on 2026-08-02 for `deepseek-v4-flash` ($0.14 per 1M cache-miss input tokens, $0.28 per 1M output tokens), the maximum configured output alone would be about `$0.1008`; dynamic input is billed separately. DeepSeek says prices may change, so deployment estimates must be recalculated from the [official pricing page](https://api-docs.deepseek.com/quick_start/pricing).

The upstream repository's roughly `$0.4/month` statement is an author estimate, not a fixed guarantee.

### DengTa MVP cost contract

The DengTa nursery MVP should have:

- zero additional model calls per normal chat turn;
- zero embedding calls;
- zero nursery-specific API keys;
- zero provider-specific nursery code;
- deterministic child events and speech computed locally;
- at most 800 characters of nursery dynamic context, and only on child-relevant turns;
- no automatic LLM narration for background child events.

An optional later “companion narrates this milestone” feature may use DengTa's existing `generateReply` path behind an explicit per-tenant budget, but it is not part of the zero-extra-call MVP.

## Security and multitenancy audit

### Upstream gaps that must not be imported

1. **Self-asserted identity.** The driver explicitly says identity is reported by the caller and real authentication must be added by the integration layer ([driver identity note](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/driver.py#L3-L7)).
2. **No HTTP authentication.** The MCP HTTP wrapper says public exposure needs an external authentication/tunnel layer ([server](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/server.py#L3-L10)).
3. **Persona is not a tenant.** `player` only has to exist in a process-wide environment whitelist; it is not bound to an authenticated account ([toolface](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/toolface.py#L39-L68)).
4. **Physical SQLite files are not hosted multitenancy.** There is no required `user_id + companion_id`, RLS contract, or authenticated database scope.
5. **Fixed caregiver slots.** Relationship rows only accept `papa` and `mama`; other configured personas collapse into a main slot. DengTa must instead use neutral `user` and `companion` actor identities.
6. **Potential data egress.** Optional psyche input includes appearance, event history, album records, and recent utterances. The corpus path masks selected credential/contact patterns, but appearance is stored directly, so not every psyche field is guaranteed to be scrubbed ([PII patterns](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/guard.py#L23-L55), [appearance write](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/driver.py#L300-L319)).
7. **Hosted storage growth.** Full retained model snapshots after feeds are not appropriate for unbounded Supabase storage.
8. **Local time assumptions.** The project uses host local time and documents no DST handling. DengTa should use each tenant's configured IANA timezone for event scheduling.

### Positive upstream patterns worth preserving

- parameterized read-only archive access with `mode=ro`, `query_only=ON`, and a viewer filter ([sampler](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/sampler.py#L28-L69));
- command allowlisting and no shell command construction;
- append-only action/axis/bond histories;
- idempotency keys for actions, events, and delivery;
- deterministic RNG seeds for replayable schedules;
- no network call while a database write transaction is open;
- model snapshots use compressed JSON and checksums rather than executable deserialization;
- expired real-time events are dropped instead of delivered late;
- failed optional layers do not block core gameplay.

## DengTa architecture fit

DengTa already has the infrastructure the upstream project lacks:

- [`services/request-scope.js`](../services/request-scope.js#L17-L123) injects authenticated ownership into every allowed table read/write and rejects unregistered unscoped tables.
- [`supabase/012_multitenant_foundation.sql`](../supabase/012_multitenant_foundation.sql#L43-L87) and [`supabase/013_multitenant_finalize.sql`](../supabase/013_multitenant_finalize.sql#L40-L102) establish required `user_id + companion_id` ownership and composite foreign keys.
- [`services/background-job-worker.js`](../services/background-job-worker.js#L188-L360) and [`supabase/014_background_job_leases.sql`](../supabase/014_background_job_leases.sql#L23-L123) provide tenant-specific claims, leases, retries, and `SKIP LOCKED` concurrency.
- [`services/ai-service.js`](../services/ai-service.js#L2952-L3132) already normalizes Gemini, Anthropic, OpenAI Responses, and OpenAI-compatible providers.
- [`services/ai-service.js`](../services/ai-service.js#L3137-L3177) already writes durable companion memory in first person and rejects backend wording such as “user/AI/conversation summary.”
- [`services/context-reset.js`](../services/context-reset.js#L47-L84) loads tenant-scoped recent messages and budgeted memories without an extra model call.

The nursery should therefore be another tenant-owned domain module, not a gateway and not a prompt replacement.

## Clean-room concept adoption matrix

| Upstream concept | DengTa MVP | Adaptation |
|---|---|---|
| Versioned time-derived stages | Adopt | Keep age calculation pure; persist `stage_policy_version` |
| Unnamed birth and one-time naming | Adopt | Create unnamed active child now; one name change from null only |
| Lazy state settlement | Adopt | Pure Node function with injected clock and tenant-local timezone |
| Append-only action truth | Adopt | Supabase table plus state version and idempotency |
| Local character learner | Adopt for child only | Independent Node implementation; never replace companion LLM |
| Per-feed full snapshot history | Replace | Corpus is truth; keep one periodic compressed checkpoint |
| Growth album and firsts | Adopt | Tenant-scoped milestones, deterministic dedupe key |
| Deterministic scheduled events | Adopt | Exact due jobs in existing background worker, not 5-minute global polling |
| Outbox/idempotent delivery | Reuse DengTa infrastructure | Save nursery event and use existing notification/delivery path |
| User/companion relationship axes | Adopt | Neutral actor roles, not gendered fixed slots |
| Read-only derived portrait | Adopt | API response from authoritative rows; no model call |
| Runaway/homecoming/endings | Adopt after core MVP | Pure local rules with fake-clock tests |
| Optional LLM psyche | Defer/off | It increases cost and assumes one compatible protocol |
| MCP/CLI/Python sidecar | Do not adopt | Existing authenticated app/backend is the integration surface |
| Automatic chat-archive stealing | Do not enable by default | Only explicit nursery-room speech enters corpus in MVP |

## Concrete MVP interface

### HTTP routes

All routes use `requireRequestScope(req)` and `req.scope.db`. No route accepts `user_id` or `companion_id` from the body.

```text
POST /api/v2/nursery/children
  body: { client_action_id }
  creates: unnamed active child, born now

GET /api/v2/nursery
  returns: child, derived stage/age, settled state, relationships,
           recent utterances, next event, latest milestones

POST /api/v2/nursery/children/:childId/name
  body: { candidates: ["..."], client_action_id }
  one candidate: user chooses; multiple: deterministic familiarity-weighted choice

POST /api/v2/nursery/children/:childId/actions
  body: {
    action: "feed|soothe|diaper|burp|play|teach|talk|discipline",
    text?: "...",
    actor: "user|companion",
    client_action_id
  }
  returns: action receipt, settled state, optional local child utterance,
           newly created milestones

GET /api/v2/nursery/children/:childId/album
GET /api/v2/nursery/children/:childId/portrait
GET /api/v2/nursery/children/:childId/events?after=<cursor>
```

The server, not the client, decides actor authorization. A normal app user may act as `user`; `companion` actions may only be created by an internal companion/background path with a server-issued idempotency key.

### Service interfaces

```js
createUnnamedChild({ database, now, clientActionId })
deriveNurseryStage(child, now)
settleNurseryState(state, child, now)
applyNurseryAction({ database, childId, actor, action, text, idempotencyKey, now })
feedNurseryCorpus({ database, childId, speaker, text, sourceMessageId, now })
generateChildUtterance({ corpus, checkpoint, stage, recentUtterances, rngSeed })
scheduleNurseryEvent({ database, childId, kind, dueAt, expiresAt, dedupeKey })
processNurseryEvent({ database, job, lease, now })
buildNurseryPortrait({ database, childId, now })
buildNurseryRuntimeContext({ database, messages, childId, maxChars: 800 })
```

`buildNurseryRuntimeContext` returns an empty string unless the newest turn explicitly concerns the child or came from the nursery UI. It reads state but never writes settings or memories.

## Concrete Supabase schema

Suggested migration: `supabase/023_nursery.sql` (adjust the number to the next unused migration at implementation time).

### `nursery_children`

```text
id uuid primary key
user_id uuid not null
companion_id uuid not null
name text null check 1..20 characters
status text not null check embryo|active|runaway|graduated
born_at timestamptz null
paused_at timestamptz null
total_paused_seconds bigint not null default 0
stage_policy_version smallint not null default 1
rng_seed bigint not null
state_version bigint not null default 0
celebrated_stage text null
runaway_at timestamptz null
ending text null
appearance text not null default ''
created_at, updated_at timestamptz
unique (user_id, companion_id, id)
foreign key (user_id, companion_id) -> companions(user_id, id)
```

Add a partial unique index permitting at most one non-graduated child per companion in MVP.

### `nursery_child_state`

```text
user_id, companion_id, child_id
mood, health, intimacy, nutrition, fatigue, darkness, digest_load numeric
last_settled_at, last_fed_at, last_interaction_at, updated_at
primary key (user_id, companion_id, child_id)
composite foreign key -> nursery_children(user_id, companion_id, id)
```

### `nursery_actions`

```text
id bigint generated identity
user_id, companion_id, child_id
actor text check user|companion|system
kind text
payload jsonb
effective_at timestamptz
idempotency_key text
state_version_before, state_version_after bigint
unique (user_id, companion_id, child_id, idempotency_key)
```

### `nursery_corpus`

```text
id bigint generated identity
user_id, companion_id, child_id
source_kind text check direct|night|book|conversation_opt_in|system
source_message_id bigint null
speaker text check user|companion|system
text text not null
content_sha256 text not null
char_count integer
training_weight numeric
scene text
created_at timestamptz
unique (user_id, companion_id, child_id, content_sha256)
```

Do not auto-copy all chat history. `conversation_opt_in` requires an explicit action. If message provenance is stored, add a composite message ownership index/foreign key or validate ownership through the scoped database before insert.

### `nursery_model_checkpoints`

```text
user_id, companion_id, child_id primary key
trained_through_corpus_id bigint
format_version smallint
tokenizer_version text
model_blob bytea
checksum_sha256 text
updated_at timestamptz
```

Keep only the latest checkpoint. Rebuild from tenant-scoped corpus on checksum/cursor failure. Checkpoint every 20 new corpus rows or when the serialized model changes materially, not on every feed.

### `nursery_utterances`

```text
id bigint generated identity
user_id, companion_id, child_id
trigger text
stage text
text text
generation_parameters jsonb
accepted boolean
rejection_reason text
created_at timestamptz
```

### `nursery_events`

```text
id uuid primary key
user_id, companion_id, child_id
kind text
due_at, expires_at timestamptz null
status text check pending|fired|expired|cancelled
payload jsonb
dedupe_key text
created_at, fired_at timestamptz
unique (user_id, companion_id, child_id, dedupe_key)
```

Schedule a matching `background_jobs` row with a new `nursery_event` job type and a dedupe key containing the child/event/date. Reuse the existing tenant lease worker. Do not run one Python/SQLite tick process per child.

### `nursery_milestones` and `nursery_caregiver_bonds`

```text
nursery_milestones:
  id, user_id, companion_id, child_id, kind, title, note,
  source_utterance_id, dedupe_key, created_at, pinned_at

nursery_caregiver_bonds:
  user_id, companion_id, child_id, caregiver_kind(user|companion),
  attachment, trust, predictability, resentment, updated_at
```

Every table must be added to `TABLE_SCOPES`, carry both ownership columns, use composite ownership foreign keys, enable RLS, revoke browser roles if service-role-only, and receive multitenant isolation tests.

## Prompt and memory contract

The nursery feature must not change these existing values:

- `unified_system_prompt` / custom instructions;
- `user_details`;
- legacy configured prompt fields;
- stored first-person `memories`;
- provider profile, model, reasoning effort, or API key.

Nursery state is authoritative structured application data, not companion identity. A compact example dynamic block is:

```text
[nursery_state]
child_id=<uuid>; name=unnamed; stage=infant; age_days=0.7; status=active
recent: user fed 2h ago; companion soothed 40m ago
current: mood=64; nutrition=52; next_event=none
[/nursery_state]
```

Rules for this block:

- maximum 800 characters;
- only include facts read from the current tenant;
- only include it on child-relevant turns;
- insert through the existing dynamic-context path before the latest user message;
- do not write it into system personalization, `user_details`, or durable memory;
- do not label memory or conversation summaries as `user`/`AI`;
- if a nursery milestone is ever deliberately mirrored into durable memory, use the existing first-person companion memory generator, for example “I want to remember that we named our child today,” and keep the nursery event row as the factual source.

Provider compatibility remains automatic because only plain dynamic text is added before [`generateReply`](../services/ai-service.js#L2952-L3132) chooses the provider transport.

## Background/event design

Use exact due jobs rather than frequent global polling:

1. Birth or daily reconciliation deterministically selects the next eligible event.
2. Insert `nursery_events` and `background_jobs` in one idempotent workflow.
3. Existing tenant worker claims the due job with a lease.
4. The handler re-reads the scoped child, verifies the event is still pending and unexpired, applies the local transition, generates local child speech if needed, writes the event/milestone, then completes the lease.
5. Expired time-sensitive events become `expired`; they are not replayed later.
6. The existing local notification/delivery layer announces the event. The default event text is deterministic and does not call a model.

Reconciliation should ensure at most one pending nursery event per child and repair missing future jobs. The existing recurring-job uniqueness pattern can be extended to `nursery_event` or enforced with a nursery-specific partial index.

## MVP implementation sequence

1. **Schema and scoped data access**
   - Add nursery tables, composite ownership constraints, request-scope entries, and tenant tests.
2. **Pure state engine**
   - Versioned stages, fake clock, lazy settlement, action deltas, idempotency, and one unnamed active child.
3. **Nursery APIs**
   - Create/status/name/action/album/portrait with no provider calls.
4. **Local child language**
   - Independent character transition learner, bounded generation, recent duplicate rejection, one latest checkpoint, corpus replay.
5. **Events and notifications**
   - Exact due jobs, expiry, lease-safe handler, local event text, and mobile display.
6. **Chat integration**
   - Child-relevance gate and <=800-character dynamic context; prove custom instructions/details/memories are byte-for-byte unchanged.
7. **Lifecycle completion**
   - Stage milestones, relationship axes, runaway/homecoming, adult endings, and derived portrait.
8. **Only after measured need**
   - Optional companion narration or semantic child cognition through the existing provider layer with a visible budget. Never enable a second hidden per-hour model loop by default.

## Required tests

### Pure state/lifecycle

- unnamed active birth sets `born_at`, baseline state, policy version, and deterministic seed;
- one child maximum per tenant in MVP;
- naming changes null to a valid name once and is idempotent;
- two simultaneous naming requests produce one winner;
- fake-clock boundaries derive infant/toddler/child/teen/adult exactly;
- pause time is excluded from logical age;
- state settlement is independent of read frequency and never leaves configured bounds;
- repeated actions use the intended daily decay without double application;
- the same idempotency key cannot change state twice;
- state version increments exactly once per committed action.

### Local child language

- corpus rows and model/checkpoint never cross tenants;
- a fixed corpus, seed, stage, and recent-output list gives deterministic output;
- infant output remains within its length/order/vocabulary bounds;
- later stages unlock the configured capability without changing old policy versions;
- generated output cannot be an excessive continuous copy of one source row;
- recent duplicate output is retried with a hard attempt limit;
- invalid checksum/cursor rebuilds from scoped corpus;
- checkpoint cadence does not write one full retained snapshot per feed;
- child speech makes zero network/model calls.

### Events/background work

- `(child_id, local_date, kind)` scheduling is deterministic;
- duplicate scheduling creates one event/job;
- two workers cannot fire one event twice;
- lost leases do not commit a second result;
- expired night events are dropped and never delivered late;
- retries preserve the event idempotency key;
- tenant A's worker cannot claim or update tenant B's child event;
- notification failure does not roll back committed child state.

### Multitenancy

- every nursery table is denied by `RequestScope` until explicitly registered;
- all reads, inserts, updates, and deletes inject `user_id + companion_id`;
- a body-supplied ownership value cannot override request scope;
- one user's child/corpus/checkpoints/events/milestones are invisible to another;
- two companions owned by one user remain isolated;
- every child-owned row has a composite foreign key to the same tenant's child;
- background RPC parameters always include both tenant identifiers.

### Prompt/provider/memory regression

- ordinary non-child chat has no nursery block and identical provider call count;
- child-relevant chat includes at most one <=800-character dynamic block;
- `unified_system_prompt`, `user_details`, and existing memories are byte-for-byte unchanged;
- no nursery operation inserts into or updates `settings` or `memories`;
- prompt receipts show the same personalization blocks and provider selection;
- OpenAI Chat, OpenAI Responses, Anthropic, Gemini, and custom-compatible transports all receive the same normalized nursery context;
- no nursery-specific API key, endpoint, model name, or reasoning effort is introduced;
- first-person memory compression still uses “I” and never backend labels.

### End-to-end acceptance

- create an unnamed child on one test tenant;
- user and companion can perform separate care actions;
- child emits locally learned stage-appropriate speech;
- a scheduled event appears once and can notify the device;
- the status/album/portrait survive backend restart;
- a second tenant cannot observe any of it;
- normal companion chat remains unchanged when the child is not relevant;
- provider/embedding call counters remain unchanged for all nursery-only operations.

## Explicit non-goals for MVP

- no Python sidecar, MCP exposure, or per-persona SQLite files;
- no automatic ingestion of all private conversations;
- no second AI provider or separate nursery API key;
- no hourly/deferred LLM psyche loop;
- no change to the companion persona, custom instructions, user details, or durable memory;
- no attempt to make the local child model a fully semantic chatbot;
- no model-generated mutation of child state without deterministic validation;
- no copied upstream UI or player-facing text.

## Acceptance criteria

The integration is ready only when:

- Supabase remains the sole production database;
- all nursery data is scoped by authenticated user and selected companion;
- the requested child exists unnamed and can be named later;
- nursery-only actions and child speech add zero provider/embedding calls;
- custom instructions, `user_details`, and first-person memory are unchanged;
- normal companion chat still uses the selected existing provider/model;
- exact due events are lease-safe, idempotent, and not delivered after expiry;
- provider, multitenant, prompt, cost, and lifecycle tests pass;
- no feature is reported live until deployment and device evidence confirm it.

## Primary sources

- [Reviewed llm-nursery tree](https://github.com/tsuru0805/llm-nursery/tree/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d)
- [MIT license](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/LICENSE)
- [Runtime and dependencies](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/pyproject.toml)
- [Project architecture and invariants](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/AGENTS.md)
- [User-facing lifecycle and limitations](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/README.md)
- [SQLite schema](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/db.py)
- [Child lifecycle and corpus/speech transactions](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/child.py)
- [Stage and cost constants](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/config.py)
- [Local language model](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/model.py)
- [Decoder](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/decoder.py)
- [PII and overlap guard](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/guard.py)
- [Scheduler and outbox](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/scheduler.py)
- [Milestones, runaway, and endings](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/events.py)
- [Optional psyche input and provider call](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/psyche.py)
- [Derived portrait](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/portrait.py)
- [MCP wrapper](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/server.py)
- [Tool allowlist](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/toolface.py)
- [Read-only archive sampler](https://github.com/tsuru0805/llm-nursery/blob/4a4549ae68117b6367eeba9dff4f2dac2bce8f7d/nursery/sampler.py)
- [Official DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing)
