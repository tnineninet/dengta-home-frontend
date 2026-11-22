# dengta-home-backend Codebase Document

> 📁 This document is a project overview. Modules with complex directory structures have been split into independent sub-documents — see section notes for details.

## 1. Tech Stack

- **Node.js 24.x** (from package.json `engines.node`)
- **Language**: JavaScript (CommonJS)
- **Runtime / Framework**: Express 5.2.1
- **Package manager**: npm, version unknown
- **Testing**: Node.js executable assertion scripts; PGlite 0.5.4 for database tests

## 2. Project Directory Structure

> 💡 Modules that have been split into sub-documents are marked with `📄 See: [path]` in the directory tree and are not expanded here.
> 💡 TS/JS projects: Must expand according to **actual** directory hierarchy (including git submodule / workspace-pulled business source directories) — do not fill in non-existent levels based on templates.

```
dengta-home-backend/
├── routes/                 # Express HTTP endpoints for accounts, chat features, companion content, voice, weather, and external integrations
│   └── v2/                # Versioned core-account and content APIs
├── services/               # Application logic for AI chat, tenant background jobs, memory, companion behavior, media, and provider integrations
├── scripts/                # Operational utilities for private-storage export, voice design, and multitenant migration rehearsal
├── supabase/               # Ordered PostgreSQL schema migrations for application domains, tenant isolation, background jobs, and memory calendars
├── test/                   # Executable unit, contract, integration, route, background-job, and PGlite database regression tests
├── docs/                   # Integration research, provider setup, and prompt-audit documentation
├── voice-design.local/     # Local voice-design working data excluded from runtime application logic
├── .github/               # Repository automation for protected background-job scheduling
│   └── workflows/         # GitHub Actions workflow definitions
└── node_modules/           # Installed third-party packages; not expanded
```

## 3. Dev Commands (Core)

> ⚠️ All commands are sourced from project documentation. Each command is annotated with its source.
> ⚠️ TS/JS projects: If build / test commands come from multiple sources, they must undergo Step 4-C cross-verification, with verification markers noted in comments.

### Build Commands
```bash
# Syntax validation (Source: package.json > scripts.check; validated successfully in repository root on 2026-08-13)
npm run check
```

### Test Commands
```bash
# Full test suite (Source: package.json > scripts.test)
npm test
# Individual test groups (Source: package.json > scripts.test:*)
npm run test:<group>
```

### Run / Start Commands
```bash
# Application server (Source: package.json > scripts.start)
npm start
```

## 4. Dev Environment (Brief)

### Prerequisites

- Node.js 24.x
- npm, version unknown
- Supabase project credentials for database-backed runtime paths

### Configuration Notes (Optional)

Runtime configuration is supplied through `.env`; `.env.example` documents Supabase, authentication, background-job, voice, weather, and external-integration settings. `config.json` contains the custom AI provider and companion defaults.
