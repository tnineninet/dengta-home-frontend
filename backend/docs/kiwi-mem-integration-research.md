# kiwi-mem for DengTa: source audit and low-cost integration design

Status: implementation-ready research, no production code or database state changed by this document
Reviewed upstream snapshot: `LucieEveille/kiwi-mem` at commit `ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421` (`v1.6.1-8-gac3a860`) on 2026-08-02
Local read-only research copy: `E:\chatgpt\DengTa-production-tools\research-sources\kiwi-mem`

## Decision

Do **not** deploy kiwi-mem as DengTa's public proxy, replace DengTa's Supabase schema, or copy its Python implementation into the backend.

Instead, implement a clean-room, DengTa-native **memory economy layer** in the existing Node/Supabase request path:

1. Keep user personalization (`unified_system_prompt` and `user_details`) unchanged and in their current application-level instruction positions.
2. Keep memory text in the companion's first person.
3. Retrieve a larger tenant-scoped candidate pool in the backend, but inject only the most relevant/warm memories under a hard character/token budget.
4. Do not add an embedding request on every chat turn in the first release.
5. Separate conversation compression from the companion's decision to keep something as durable memory.
6. Add vector/RRF retrieval, calendar hierarchy, tool routing, and consolidation only as independently switchable later phases.

This gives DengTa most of the immediate token-saving benefit without a new runtime, a second database, a second provider gateway, or an AGPL-covered code merge.

## What the upstream project actually does

kiwi-mem is a Python 3.12/FastAPI gateway placed between a chat client and an LLM provider. Its documented stack is PostgreSQL, pgvector, Docker, OpenAI-compatible providers, and Anthropic-native providers. It describes heat-based forgetting, Dream consolidation, calendar summaries, hybrid retrieval, prompt ordering, and a tool drawer ([README](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/README_EN.md#L10-L19), [feature overview](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/README_EN.md#L177-L224)).

The source implements the following useful mechanisms:

- **Heat**: importance and emotional weight set an initial temperature; time applies exponential half-life decay; recall count and query diversity add a bounded bonus. Locked memories stay at heat 1.0 ([source](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/database.py#L776-L908)).
- **Hybrid retrieval**: vector and keyword candidate lists are combined with Reciprocal Rank Fusion, `sum(1 / (k + rank))`, using `k=60` ([source](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/database.py#L1308-L1382), [RRF implementation](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/database.py#L1495-L1541)).
- **Tiered injection**: hot or locked items are injected in full, warm items are truncated, and cold items are skipped ([source](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/main.py#L816-L923)).
- **Recall accounting**: only selected memories are marked recalled; the update refreshes access time and extends softened memory lifetime ([source](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/database.py#L1221-L1284)).
- **Deduplication and contradiction handling**: exact, containment, character-overlap, title, and similarity heuristics are applied before saving; replaced memories are invalidated rather than physically deleted ([deduplication](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/database.py#L1979-L2071), [invalidation and contradiction detection](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/database.py#L3804-L3937)).
- **Hierarchical time memory**: detailed recent days and progressively coarser week/month/quarter/year pages are selected with overlap handling ([source](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/database.py#L3189-L3340)).
- **Tool drawer**: category embeddings are precomputed once, a user-message embedding is reused for routing, and keyword matching is the fallback ([source](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/tool_drawer.py#L601-L639), [routing](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/tool_drawer.py#L753-L917)).
- **Cost-aware prompt ordering**: the project places stable content before dynamic retrieval to improve prompt-cache reuse. The README claims savings of up to 90%, but that is an upstream claim, not a guaranteed whole-request saving for DengTa ([README](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/README_EN.md#L55-L70), [prompt assembly](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/main.py#L710-L727)).

## Important upstream limitations

These are reasons not to deploy it unchanged inside DengTa:

1. **No built-in authentication.** The README says the gateway, admin panel, export, and import endpoints are unauthenticated and must be protected externally ([README](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/README_EN.md#L120-L132)). DengTa already has authenticated user/companion request scope and must not bypass it.
2. **Not DengTa-multitenant.** Upstream memories are scoped by optional `project_id`, not by required `user_id + companion_id`. Its base memory and conversation tables do not contain DengTa ownership columns ([schema](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/database.py#L91-L147)).
3. **Vector search is an application full scan.** Despite the Docker image using pgvector, embeddings are stored as serialized text and the vector path loads candidate rows then computes cosine similarity in Python ([schema](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/database.py#L116-L125), [search](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/database.py#L1385-L1492)). That is unsuitable for a growing multi-user hosted service.
4. **Memory extraction is not first-person.** Its extractor serializes turns as `用户:` and `AI:` and primarily extracts user facts ([source](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/memory_extractor.py#L25-L78), [formatting](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/memory_extractor.py#L109-L144)). This conflicts with DengTa's first-person companion-memory requirement.
5. **Background cognition can add substantial model cost.** Extraction defaults to every three turns; day/week/month/quarter/year generation and Dream are additional LLM calls, with several paths allowing thousands of output tokens ([defaults](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/README_EN.md#L250-L280), [Dream material and actions](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/dream.py#L40-L123)). Enabling these to “save money” would initially do the opposite.
6. **Model-generated Dream actions mutate memory.** The model may request delete, merge, soften, promote, scene creation, or relationship edges ([source](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/dream.py#L62-L100)). DengTa should not copy this executor before it has tenant-scoped idempotency, audit, rollback, and deterministic validation.
7. **Known correctness/provider gaps remain.** Upstream documents failures around one-character/numeric contradictions, authenticated external MCP, hard-coded Dream thresholds, and an OpenRouter-style fallback model name that may fail on other providers ([known issues](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/KNOWN_ISSUES.md#L21-L31), [provider/tool issues](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/KNOWN_ISSUES.md#L44-L59)).

## DengTa fit analysis

| Concern | DengTa today | Correct integration choice |
|---|---|---|
| Ownership | Every business row is scoped by authenticated `user_id + companion_id`; request-scope injects filters and ownership values | Keep all memory queries behind the existing tenant database wrapper; never call an unscoped kiwi gateway |
| Persistence | Supabase is the source of truth | Extend existing Supabase tables; do not add kiwi PostgreSQL |
| Personalization | User-edited custom instructions and details are sent through provider-specific transports | Do not put a proxy in front of provider payload assembly; retrieve memory before DengTa builds its prompt plan |
| First-person memory | Current compressor writes as `我`, lets the companion decide what is worth keeping, and rejects backend labels such as “用户/AI/对话摘要” | Keep this prompt and output contract; do not reuse kiwi's extraction prompt |
| Provider compatibility | OpenAI chat, OpenAI Responses, Anthropic, Gemini, and compatible custom endpoints already share DengTa's service layer | Reuse DengTa's `generateMemorySummary`; do not copy kiwi provider adapters |
| Current recall | The latest five confirmed summaries are loaded regardless of topic | Fetch more candidates, rank locally, and inject fewer under a hard budget |
| Context reset | Messages and memories respect `context_reset_at` | Apply the existing cutoff before ranking; never resurrect pre-reset rows |

Evidence in DengTa:

- Tenant ownership and the allowed tables are enforced by [`services/request-scope.js`](../services/request-scope.js#L17-L122).
- The production schema requires memory ownership after multitenant finalization in [`supabase/012_multitenant_foundation.sql`](../supabase/012_multitenant_foundation.sql#L203-L221) and [`supabase/013_multitenant_finalize.sql`](../supabase/013_multitenant_finalize.sql#L40-L66).
- Context loading and reset filtering are centralized in [`services/context-reset.js`](../services/context-reset.js#L23-L70).
- The current first-person, self-selecting memory summary contract is in [`services/ai-service.js`](../services/ai-service.js#L3135-L3177), and all supported provider transports are used by the same summary function in [`services/ai-service.js`](../services/ai-service.js#L3180-L3262).
- User details are explicitly stored as verbatim user-edited persistent instructions by [`supabase/021_personalization_details.sql`](../supabase/021_personalization_details.sql#L1-L5).

## Target architecture

```text
authenticated chat request
        |
        v
DengTa RequestScope (user_id + companion_id)
        |
        +--> recent visible messages (existing context_reset_at cutoff)
        |
        +--> 40 recent confirmed memory candidates
                    |
                    v
             local memory economy
             - lexical relevance
             - warmth/recency
             - importance
             - hard char budget
                    |
                    v
          at most 5 first-person memories
                    |
                    v
existing DengTa prompt compiler and provider transport
```

The first release adds no network hop and no model call to normal recall.

### Interface 1: candidate selection

Implement as a pure module, independent of Supabase and provider code:

```js
selectMemoriesForContext(memories, {
  query,
  now,
  maxItems: 5,
  charBudget: 2600
}) -> Array<{
  ...memory,
  summary,
  relevance,
  heat,
  recall_score,
  memory_tier
}>
```

Required properties:

- deterministic for a fixed `query`, candidate set, and `now`;
- never returns more than `maxItems`;
- total returned summary characters never exceed `charBudget`;
- does not call an LLM or embedding provider;
- does not mutate input rows;
- empty/invalid rows are ignored;
- only already tenant-scoped, confirmed, post-reset rows may be passed in.

Initial defaults should be conservative rather than aggressive:

| Setting | Initial value | Reason |
|---|---:|---|
| Candidate rows | 40 | Small database read; enough to find older relevant summaries |
| Injected rows | 5 maximum | Preserves current maximum count |
| Character budget | 2,600 | Hard upper bound while retaining usable first-person detail |
| Full item cap | 900 characters | Prevents one memory monopolizing context |
| Warm item cap | 220 characters | Keeps vague supporting memories cheap |
| Embeddings | Off | Zero additional provider calls and maximum compatibility |

### Interface 2: tokenizer and lexical relevance

Use an independently written, dependency-free tokenizer:

1. Lowercase ASCII words of length at least two.
2. Keep numeric/date tokens.
3. Split Chinese by contiguous CJK spans, then create two-character grams inside each span. Do not create grams across punctuation or field boundaries.
4. Deduplicate and cap query tokens, for example at 48.
5. Compute relevance with a bounded set-overlap score. Dice or cosine-style set normalization is preferable to raw substring counting because it limits long-summary bias.

Example independent formula:

```text
lexical = intersection(query_tokens, memory_tokens)
          / sqrt(max(1, query_token_count * memory_token_count))
```

This borrows the idea of a keyword fallback, not kiwi's jieba implementation or synonym tables. It requires no package or external service.

### Interface 3: warmth and ranking

Use a DengTa-specific warmth curve with longer companion-memory half-lives than kiwi's 3/7-day defaults:

```text
important = importance >= 8 OR emotional_weight >= 6
half_life_days = important ? 90 : 45
initial_heat = min(1, 0.45 + 0.04*importance + 0.02*emotional_weight)
decay = 2 ^ (-age_days / half_life_days)
recall_bonus = min(0.18, 0.015*recall_count)
heat = clamp(initial_heat*decay + recall_bonus, 0, 1)
```

Rank with relevance dominating warmth:

```text
if lexical > 0:
  score = 0.45 + 0.40*lexical + 0.12*heat + 0.03*(importance/10)
else:
  score = 0.12*heat + 0.03*(importance/10)
```

Tiering:

- `full`: lexical relevance is strong enough or heat is at least 0.7;
- `summary`: heat is at least 0.3;
- `cold`: skip unless it has a lexical hit.

These constants must remain configuration/telemetry parameters, not product-behavior or persona instructions.

### Interface 4: first-person memory decision

DengTa's existing summary prompt is closer to the requested behavior than kiwi's extractor. Preserve these semantics:

- the companion writes as `我`;
- it decides whether the content deserves durable memory;
- it can return the explicit skip marker;
- it never labels the other person “用户” or itself “AI/助手/模型”;
- provider routing remains the same as normal DengTa calls;
- no new content restriction or persona rule is introduced.

For the later structured-memory phase, use a provider-neutral JSON result:

```json
{
  "remember": true,
  "summary_first_person": "我想记住……",
  "title": "简短主题",
  "kind": "preference",
  "importance": 7,
  "emotional_weight": 4,
  "keywords": ["早餐", "热牛奶"],
  "source_message_ids": [101, 102]
}
```

`remember=false` must create no durable memory. Parsing must use a strict schema validator, clamp numbers, cap string/list sizes, and ignore unknown fields.

### Interface 5: separate continuity compression from durable memory

Current DengTa compression only hides old messages after a non-empty durable memory is produced. When the companion decides there is nothing worth long-term retention, the old messages remain visible to the model and can trigger another compression attempt on later turns.

The robust design separates two outputs from one infrequent compression call:

```json
{
  "continuity_summary_first_person": "我和对方刚才……",
  "durable_memories": []
}
```

- `continuity_summary_first_person` allows old message rows to leave the active context window even if `durable_memories` is empty.
- `durable_memories` contains only what the companion chose to keep long term.
- Both use first-person language, but only durable items participate in cross-conversation retrieval.
- The source message IDs and time range are stored so compression is idempotent and auditable.

This is the most important cost/correctness improvement beyond candidate selection.

## Database plan

### Release A: no migration

Use existing fields only:

- query the latest 40 `confirmation_status='confirmed'` memories through `RequestScope`;
- apply `context_reset_at` before ranking;
- rank with summary text, `created_at`, and `updated_at`;
- inject at most five summaries under 2,600 characters;
- keep the current latest-five behavior as a feature-flag fallback.

No table, extension, or background task is required.

### Release B: additive migration

Create `supabase/023_memory_economy.sql` with idempotent additions to `memories`:

```text
title                 text default ''
memory_kind           text default 'episodic'
importance            smallint default 5, check 1..10
emotional_weight      smallint default 0, check 0..10
keywords              text[] default '{}'
recall_count          integer default 0, check >= 0
last_recalled_at      timestamptz
valid_until           timestamptz
locked                boolean default false
resolution            numeric default 1.0, check 0..1
source_message_ids    jsonb default '[]'
superseded_by         uuid references memories(id)
```

Indexes:

```text
(user_id, companion_id, confirmation_status, updated_at desc)
GIN(keywords)
(user_id, companion_id, locked, updated_at desc) where locked = true
(user_id, companion_id, valid_until)
```

Every new table or write path must be added to `TABLE_SCOPES`, carry both ownership columns, use the composite companion ownership foreign key, and have multitenant isolation tests.

Add a separate `conversation_summaries` table rather than overloading durable `memories`:

```text
id, user_id, companion_id, conversation_id
summary_first_person
source_message_ids
source_window_start, source_window_end
model_id, created_at, superseded_at
```

Add recall events only if recall counts are needed. An append-only event with a unique fingerprint is safer under concurrency than read-modify-write counters; a database trigger can update `recall_count` atomically.

### Release C: optional vector retrieval

Only enable this after verifying the production Supabase project has the vector extension and selecting a fixed embedding dimension. Supabase documents pgvector support and SQL similarity search ([official pgvector guide](https://supabase.com/docs/guides/database/extensions/pgvector), [official semantic-search guide](https://supabase.com/docs/guides/ai/semantic-search)).

Rules:

- embeddings are generated once when a memory is written or materially revised;
- the user message is embedded at most once per turn and reused for memory and optional tool routing;
- vector search runs in SQL under `user_id + companion_id`, never by loading all tenant rows into Node;
- lexical search remains available when the provider lacks embeddings;
- combine lexical and vector ranks with standard RRF; do not copy upstream code;
- `memory_embedding_enabled` defaults to false.

## Provider compatibility

The memory layer must operate before provider-specific payload construction and return only selected text rows. It must not know whether the final request uses OpenAI Chat Completions, OpenAI Responses, Anthropic, Gemini, or another OpenAI-compatible endpoint.

For compression/extraction:

1. Reuse `generateMemorySummary` and its existing provider transports.
2. Add optional `memory_model` only as a model identifier inside the already selected tenant provider profile.
3. If `memory_model` is blank or not routable, use the active conversation model.
4. Do not introduce a global `MEMORY_API_KEY`, copy keys into a second service, or save keys in logs/documents.
5. Do not silently switch provider or protocol.

## Token and cost implications

### Immediate release

- Normal recall adds **zero** LLM calls and **zero** embedding calls.
- Database reads increase from 5 to at most 40 small rows, but only selected text reaches the model.
- The current prompt builder can admit as much as five memories times 4,000 characters, or 20,000 characters. A 2,600-character hard budget reduces the theoretical maximum memory component by 87%. This is not an 87% reduction of the whole request; the actual saving is:

```text
memory_input_saving = max(0, previous_memory_chars - selected_memory_chars)
whole_request_saving = memory_input_saving / previous_total_request_chars
```

- If existing memories already total less than 2,600 characters, savings are small; relevance still improves.
- Keep logging to counts and character totals only. Do not log memory content.

### Structured compression release

- Keep compression threshold-triggered, not every three turns.
- One compression call can produce both continuity summary and zero-or-more durable items.
- Even when no durable item is selected, continuity compression completes, preventing repeated threshold-triggered calls.
- Use an optional cheaper model only when the user's configured provider exposes it. Never assume an OpenRouter-specific model ID.

### Features deliberately deferred because they can cost more

- per-turn embeddings;
- daily LLM digest;
- week/month/quarter/year LLM summaries;
- automatic Dream consolidation;
- semantic tool drawer when the existing tool set is small.

## Migration and rollout plan

1. **Snapshot and measure**
   - Record per-turn total prompt characters and memory characters, selected count, provider, and latency without logging content.
   - Export a production database backup before schema changes.
2. **Release A behind a flag**
   - Add local budgeted selection only.
   - Default on for the owner companion after tests; retain instant fallback to latest-five recall.
3. **Canary verification**
   - Compare relevant-memory hit rate on fixed prompts.
   - Confirm no cross-user/companion rows, no pre-reset rows, and no prompt/personality changes.
   - Confirm normal turns make the same number of provider calls as before.
4. **Release B migration**
   - Add metadata and `conversation_summaries` without rewriting existing summary content.
   - Backfill neutral defaults in SQL; let future compression produce first-person structured items.
5. **Structured compressor**
   - Parse strict JSON, preserve the current skip choice, and split continuity from durable retention.
   - Idempotency key: tenant + conversation + ordered source message IDs.
6. **Optional vector canary**
   - Verify vector extension and dimensions in staging.
   - Backfill embeddings in bounded batches; keep lexical fallback.
   - Enable only if measured recall improvement exceeds added latency and embedding cost.
7. **Only then evaluate calendar/Dream**
   - Require explicit budgets, audit trail, rollback, and per-tenant job leases.

## Required tests

### Pure ranking tests

- an old but topically relevant first-person memory outranks recent unrelated chatter;
- full and warm tiers obey per-item caps;
- aggregate output never exceeds character budget;
- deterministic tie-breaking;
- invalid timestamps and empty summaries do not throw;
- CJK grams do not cross punctuation boundaries;
- secrets are not newly logged or copied into telemetry.

### Context integration tests

- candidates are fetched after `context_reset_at` and with `confirmation_status='confirmed'`;
- selected memories remain first-person and are not rewritten by the selector;
- custom instructions and user details are byte-for-byte unchanged in the prompt receipt;
- selected memory is injected once, not duplicated in system and dynamic context;
- latest visible conversation messages remain in chronological order.

### Multitenant tests

- user A cannot retrieve, update, recall, supersede, or archive user B's memory;
- two companions of one user do not share memory unless an explicit future shared-memory feature says so;
- insert/update helpers cannot override scope ownership fields;
- any recall-event table has the same composite ownership foreign key and RLS posture as `memories`.

### Compression tests

- `remember=false` creates no durable memory but still permits continuity compression;
- durable output rejects backend labels `用户`, `AI`, `助手`, `模型`, `本次对话`, and `对话摘要`;
- source message IDs must belong to the scoped conversation;
- the same source window is idempotent;
- failure to save/hide rolls back or leaves the old messages visible;
- OpenAI Chat, Responses, Anthropic, Gemini, and custom-compatible routes return the same normalized result shape.

### Cost regression tests

- ordinary recall performs no model/embedding request;
- selected memory characters stay under the configured budget;
- provider call count does not increase for a normal chat turn;
- a skip result does not cause compression to be retried on every following turn.

## License obligations and implementation boundary

The repository declares `AGPL-3.0-or-later` ([license header](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/LICENSE#L1-L11)). Section 5 requires modified source versions to retain notices, state modifications, use the license for the covered whole, and preserve appropriate legal notices ([license](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/LICENSE#L206-L241)). Section 13 requires operators of a modified network-interactive version to offer its Corresponding Source to remote users ([license](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/LICENSE#L550-L568)).

Practical boundary for DengTa:

- do not copy Python functions, prompts, comments, admin UI, icons/images, configuration schema, tests, or documentation text into DengTa;
- do not vendor or modify kiwi-mem as an in-process library;
- do not expose a modified kiwi-mem network service unless DengTa is prepared to meet the license's source-offer obligations;
- independently implement general algorithms and interfaces described in this report, using DengTa naming, tests, constants, and schema;
- retain this source audit as provenance for engineering review;
- obtain legal advice before any source-level reuse or combined distribution. This report is technical guidance, not legal advice.

## What should not be copied

1. The FastAPI proxy and provider adapters: DengTa already has a provider-compatible service layer.
2. The separate PostgreSQL database and Docker Compose stack: Supabase must remain authoritative.
3. The unauthenticated admin, debug, import, and export surface.
4. Global/project-only memory scope: it is insufficient for DengTa tenants.
5. Python full-table vector scans and serialized-text embeddings.
6. The memory extraction prompt that writes `用户/AI` and prioritizes only user facts.
7. Model-driven delete/merge/promote actions without transaction, audit, rollback, and tenant validation.
8. Automatic extraction every three turns and all hierarchical LLM jobs enabled by default.
9. OpenRouter-specific fallback model names and provider assumptions.
10. Upstream keyword/synonym tables, Dream prose, default persona, hidden marker text, management UI, and visual assets.

## Acceptance criteria

The integration is complete only when all of the following are evidenced:

- production still uses one Supabase source of truth and DengTa's existing provider center;
- no normal chat turn adds an LLM or embedding call for memory recall;
- memory prompt contribution is hard-capped and measured;
- first-person memory output is preserved end to end;
- custom instructions and user details remain unchanged;
- every read/write is scoped to authenticated user and selected companion;
- context reset remains effective;
- all provider contract and multitenant tests pass;
- feature flags allow immediate fallback;
- no kiwi-mem source or AGPL-covered UI/code has been merged into DengTa.

## Primary sources

- [kiwi-mem repository at reviewed commit](https://github.com/LucieEveille/kiwi-mem/tree/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421)
- [README and feature claims](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/README_EN.md)
- [Database, heat, retrieval, and schema implementation](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/database.py)
- [Prompt assembly and tiered injection](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/main.py)
- [Memory extractor](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/memory_extractor.py)
- [Dream consolidation](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/dream.py)
- [Tool drawer](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/tool_drawer.py)
- [Known issues](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/KNOWN_ISSUES.md)
- [AGPL-3.0-or-later license](https://github.com/LucieEveille/kiwi-mem/blob/ac3a860b5d5b9f85a8f83e50dcb1bdfb45b78421/LICENSE)
- [Supabase pgvector guide](https://supabase.com/docs/guides/database/extensions/pgvector)
- [Supabase semantic search guide](https://supabase.com/docs/guides/ai/semantic-search)
