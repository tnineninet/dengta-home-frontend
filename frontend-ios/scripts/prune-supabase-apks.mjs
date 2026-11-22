const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const supabaseKey = String(process.env.SUPABASE_SECRET_KEY || "");
const apply = process.env.APPLY === "1";
const keepVersioned = Math.max(1, Number(process.env.KEEP_VERSIONED || 3));
const bucket = "dengta-updates";
const prefix = "apk";
if (!supabaseUrl || !supabaseKey) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");

const headers = {
  Authorization: `Bearer ${supabaseKey}`,
  apikey: supabaseKey,
  "Content-Type": "application/json",
};
const feedResponse = await fetch(`https://www.dengtahome.com/updates/android.json?ts=${Date.now()}`, { cache: "no-store" });
if (!feedResponse.ok) throw new Error(`feed HTTP ${feedResponse.status}`);
const feed = await feedResponse.json();
const currentVersion = String(feed?.latest?.version || "");
if (!currentVersion) throw new Error("feed has no current version");

const listResponse = await fetch(`${supabaseUrl}/storage/v1/object/list/${bucket}`, {
  method: "POST",
  headers,
  body: JSON.stringify({ prefix, limit: 100, offset: 0, sortBy: { column: "name", order: "asc" } }),
});
if (!listResponse.ok) throw new Error(`storage list HTTP ${listResponse.status}`);
const objects = await listResponse.json();
const versioned = objects
  .map((object) => ({ ...object, version: String(object.name || "").match(/^DengTa-(\d+\.\d+\.\d+(?:\.\d+)?)\.apk$/)?.[1] }))
  .filter((object) => object.version)
  .sort((a, b) => {
    const left = a.version.split(".").map(Number);
    const right = b.version.split(".").map(Number);
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
      const delta = (right[index] || 0) - (left[index] || 0);
      if (delta) return delta;
    }
    return 0;
  });
const keep = new Set(versioned.slice(0, keepVersioned).map((object) => object.name));
keep.add(`DengTa-${currentVersion}.apk`);
keep.add("DengTa-latest.apk");
const remove = objects
  .filter((object) => object.name !== "DengTa-latest.apk" && !keep.has(object.name))
  .filter((object) => /^DengTa-\d+\.\d+\.\d+(?:\.\d+)?\.apk$/.test(object.name));

console.log(JSON.stringify({
  currentVersion,
  keepVersioned,
  objects: objects.map((object) => object.name),
  keep: [...keep].sort(),
  remove: remove.map((object) => object.name),
  apply,
}, null, 2));

if (apply && remove.length) {
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}`, {
    method: "DELETE",
    headers,
    body: JSON.stringify({ prefixes: remove.map((object) => `${prefix}/${object.name}`) }),
  });
  if (!response.ok) throw new Error(`storage delete HTTP ${response.status}`);
  console.log(`Deleted ${remove.length} old APK object(s).`);
}
