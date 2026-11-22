import { execFileSync } from "node:child_process";

const commit = String(process.argv[2] || "").trim();
const apply = process.argv.includes("--apply");
const push = process.argv.includes("--push");
if (!commit) {
  console.error("Usage: node scripts/rollback-backend.mjs <commit-sha> [--apply] [--push]");
  process.exit(2);
}

const git = (args, options = {}) => String(execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }) ?? "").trim();
try {
  git(["merge-base", "--is-ancestor", commit, "HEAD"]);
} catch {
  console.error(`${commit} is not an ancestor of HEAD.`);
  process.exit(2);
}
if (git(["log", "-1", "--format=%s", commit]).startsWith("Revert ")) {
  console.error(`${commit} is already a revert commit.`);
  process.exit(2);
}
console.log(`Rollback target: ${commit}`);
console.log(`Command: git revert --no-edit ${commit}`);
if (!apply) {
  console.log("Dry run only. Re-run with --apply after committing or stashing unrelated work.");
  process.exit(0);
}
const dirty = git(["status", "--porcelain"]);
if (dirty) {
  console.error("Working tree is not clean. Commit or stash changes before applying a backend rollback.");
  process.exit(1);
}
let hasGitIdentity = false;
try {
  hasGitIdentity = Boolean(git(["config", "user.name"]) && git(["config", "user.email"]));
} catch {
  hasGitIdentity = false;
}
if (!hasGitIdentity) {
  console.error("Git identity is not configured. Set user.name and user.email before applying a backend rollback.");
  process.exit(1);
}
const subject = git(["log", "-1", "--format=%s", commit]);
let reverted = false;
try {
  git(["revert", "--no-edit", commit], { stdio: ["ignore", "pipe", "pipe"] });
  reverted = true;
} catch {
  const latestSubject = git(["log", "-1", "--format=%s"]);
  reverted = latestSubject === `Revert "${subject}"`;
  if (!reverted) {
    console.error("git revert failed. Resolve conflicts manually; nothing was pushed.");
    process.exit(1);
  }
}
if (!reverted) {
  console.error("git revert did not create a revert commit; nothing was pushed.");
  process.exit(1);
}
console.log("Revert commit created locally.");
console.log("Next: run npm test && npm run check, then push main so Render deploys the revert.");
if (push) {
  git(["push", "origin", "main"], { stdio: ["inherit", "inherit", "inherit"] });
  console.log("Pushed main. Wait for Render verify-production, then check /health revision.");
}
