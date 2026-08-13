import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDirectory, "..");
const buildGradle = fs.readFileSync(
  path.join(projectRoot, "android", "app", "build.gradle"),
  "utf8",
);
const variablesGradle = fs.readFileSync(
  path.join(projectRoot, "android", "variables.gradle"),
  "utf8",
);
const androidWorkflow = fs.readFileSync(
  path.join(projectRoot, ".github", "workflows", "android-apk.yml"),
  "utf8",
);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
);
const publicAuthVerifierPath = path.join(
  projectRoot,
  "scripts",
  "verify-public-auth-build.mjs",
);
const mainActivity = fs.readFileSync(
  path.join(
    projectRoot,
    "android",
    "app",
    "src",
    "main",
    "java",
    "home",
    "dengta",
    "app",
    "MainActivity.java",
  ),
  "utf8",
);
const screenGlanceService = fs.readFileSync(
  path.join(
    projectRoot,
    "android",
    "app",
    "src",
    "main",
    "java",
    "home",
    "dengta",
    "app",
    "ScreenGlanceService.java",
  ),
  "utf8",
);

assert.match(buildGradle, /applicationId "home\.dengta\.app"/);
assert.match(buildGradle, /versionCode 43\b/);
assert.match(buildGradle, /versionName "2\.8\.21"/);
assert.match(
  buildGradle,
  /storeFile file\(System\.getProperty\("user\.home"\) \+ "\/\.android\/debug\.keystore"\)/,
  "Android debug builds must use the restored stable keystore explicitly",
);
assert.match(buildGradle, /signingConfig signingConfigs\.debug/);
assert.match(variablesGradle, /minSdkVersion = 31\b/);
assert.match(variablesGradle, /targetSdkVersion = 36\b/);
assert.match(androidWorkflow, /npm test\s+npm run lint/);
assert.match(
  androidWorkflow,
  /VITE_SUPABASE_URL: \$\{\{ secrets\.VITE_SUPABASE_URL \}\}/,
);
assert.match(
  androidWorkflow,
  /VITE_SUPABASE_ANON_KEY: \$\{\{ secrets\.VITE_SUPABASE_ANON_KEY \}\}/,
);
assert.match(androidWorkflow, /test -n "\$VITE_SUPABASE_URL"/);
assert.match(androidWorkflow, /test -n "\$VITE_SUPABASE_ANON_KEY"/);
assert.match(
  androidWorkflow,
  /secrets\.ANDROID_STABLE_DEBUG_KEYSTORE_BASE64_V2/,
  "CI builds must restore the stable Android signing key",
);
assert.match(
  androidWorkflow,
  /keytool -exportcert[\s\S]*sha256sum/,
  "CI must verify the restored keystore before starting the Android build",
);
assert.match(
  androidWorkflow,
  /38a03ab2815c285bef17521d7fc7d4cd6ea4c85d6f14e337ef7391af9b2bb4c6/,
  "CI must reject APKs signed by a transient runner certificate",
);
assert.equal(
  packageJson.scripts["verify:public-auth-build"],
  "node scripts/verify-public-auth-build.mjs",
);
assert.equal(
  fs.existsSync(publicAuthVerifierPath),
  true,
  "Android releases must verify that the built bundle contains public auth config",
);
assert.match(androidWorkflow, /npm run verify:public-auth-build/);
assert.match(
  mainActivity,
  /onRenderProcessGone/,
  "the activity must recover when Android WebView loses its renderer",
);
assert.doesNotMatch(
  mainActivity,
  /LAYER_TYPE_SOFTWARE/,
  "the embedded WebView must not force CPU-only rendering",
);
assert.doesNotMatch(
  screenGlanceService,
  /小灯|桃桃/,
  "native background notifications must not ship a private companion identity",
);
console.log("Android 2.8.21 private media and custom sticker release tests passed");
