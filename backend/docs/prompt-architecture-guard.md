# Prompt Architecture Guard

`npm run check:prompt-architecture` scans the application-authored prompt modules for fixed adult-content boundary language such as `不得生成露骨性内容`, `只能非露骨`, and equivalent English wording.

The guard intentionally excludes provider error classifiers, tests, and historical handoff reports. Those modules must continue to distinguish an upstream refusal from a normal user or assistant message and must prevent refusal residue from entering durable memory. The guard also does not attempt to override model-provider or API-gateway policy; those policies are outside DengTa's control and are reported as upstream errors.

When a future change needs a new prompt rule, it must be justified against the existing product requirements and covered by a focused test. This check is a local source guard, not a runtime content filter and not a replacement for provider, Supabase, or real-device verification.
