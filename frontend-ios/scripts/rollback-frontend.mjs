import { execFileSync } from "node:child_process";

const commit = String(process.argv[2] || "").trim();
const apply = process.argv.includes("--apply");
const push = process.argv.includes("--push");
if (!commit) {
  console.error("Usage: node scripts/rollback-frontend.mjs <commit-sha> [--apply] [--push]");
  process.exit(2);
}

const git = (args, options = {}) => String(execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }) ?? "").trim();
const status = git(["status", "--porcelain"]);
if (status) {
  console.error("Working tree is not clean. Commit or stash changes before rollback.");
  process.exit(2);
}
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
  console.log("Dry run only. Re-run with --apply to create the revert commit.");
  process.exit(0);
}

let hasGitIdentity = false;
try {
  hasGitIdentity = Boolean(git(["config", "user.name"]) && git(["config", "user.email"]));
} catch {
  hasGitIdentity = false;
}
if (!hasGitIdentity) {
  console.error("Git identity is not configured. Set user.name and user.email before applying a rollback.");
  process.exit(1);
}

try {
  git(["revert", "--no-edit", commit], { stdio: ["ignore", "pipe", "pipe"] });
} catch {
  const subject = git(["log", "-1", "--format=%s", commit]);
  const latestSubject = git(["log", "-1", "--format=%s"]);
  if (latestSubject !== `Revert "${subject}"`) {
    console.error("git revert failed. Resolve the conflict manually; nothing was pushed.");
    process.exit(1);
  }
}

console.log("Revert commit created locally.");
console.log("Next: run npm test && npm run build, then push main so Vercel and Render deploy the revert.");
if (push) {
  git(["push", "origin", "main"], { stdio: ["inherit", "inherit", "inherit"] });
  console.log("Pushed main. Wait for the Vercel/Render deployment, then run node scripts/deployment-health.mjs.");
}
