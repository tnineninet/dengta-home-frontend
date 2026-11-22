# dengta-home-frontend Codebase Document

> 📁 This document is a project overview. Modules with complex directory structures have been split into independent sub-documents — see section notes for details.

## 1. Tech Stack

- **Node.js 24.x** (from package.json `engines.node`)
- **Language**: JavaScript with JSX
- **Runtime / Framework**: React 19.2.7 + Vite 8.1.1
- **Package manager**: npm, version unknown
- **Testing**: Node.js executable assertion scripts; React Test Renderer 19.2.7
- **Lint / Formatting**: ESLint 10.6.0

## 2. Project Directory Structure

> 💡 Modules that have been split into sub-documents are marked with `📄 See: [path]` in the directory tree and are not expanded here.
> 💡 TS/JS projects: Must expand according to **actual** directory hierarchy (including git submodule / workspace-pulled business source directories) — do not fill in non-existent levels based on templates.

```
dengta-home-frontend/
├── src/                    # React UI and client logic for chat, authentication, companion features, media, settings, and native integration
│   └── assets/            # Application-owned visual resources imported by the React client
├── test/                   # Executable regression tests covering chat, authentication, storage, companion, mobile, and native behavior
│   └── helpers/           # Shared test fixtures and execution helpers
├── public/                 # Static PWA resources, bundled fonts, icons, and manifests
├── android/                # Capacitor Android shell, resources, and Gradle build configuration
├── scripts/                # Build verification and operational helper scripts
├── docs/                   # Product and integration documentation
├── assets/                 # Design and project visual assets
├── .github/                # Repository automation configuration
│   └── workflows/         # Frontend checks and Android APK build workflow
└── dist/                   # Generated Vite production output; not expanded
```

## 3. Dev Commands (Core)

> ⚠️ All commands are sourced from project documentation. Each command is annotated with its source.
> ⚠️ TS/JS projects: If build / test commands come from multiple sources, they must undergo Step 4-C cross-verification, with verification markers noted in comments.

### Build Commands
```bash
# Production web build (Source: README.md > 检查 and package.json > scripts.build; cross-verified with .github/workflows/android-apk.yml > Build DengTa web app)
npm run build
```

### Test Commands
```bash
# Full frontend regression suite (Source: package.json > scripts.test; cross-verified with .github/workflows/android-apk.yml > Run frontend regression checks)
npm test
# Full lint check (Source: README.md > 检查 and package.json > scripts.lint; cross-verified with .github/workflows/android-apk.yml > Run frontend regression checks)
npm run lint
```

### Run / Start Commands
```bash
# Local Vite development server (Source: README.md > 本地运行 and package.json > scripts.dev)
npm run dev
```

## 4. Dev Environment (Brief)

### Prerequisites

- Node.js 24.x
- npm, version unknown

### Configuration Notes (Optional)

Local and production service URLs are supplied through `.env.local` and `.env.production`; `.env.example` documents public client configuration. `capacitor.config.json` configures the Android wrapper.
