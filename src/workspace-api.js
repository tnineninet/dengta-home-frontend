import { apiRequest } from "./api.js";

export function workspaceTree(path = "") {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  return apiRequest(`/api/v2/workspace/tree${query}`);
}

export function workspaceReadFile(path) {
  return apiRequest(
    `/api/v2/workspace/file?path=${encodeURIComponent(path)}`,
    { retry: false },
  );
}

export function workspaceWriteFile({ path, content, mode = "overwrite", confirm = false }) {
  return apiRequest("/api/v2/workspace/file", {
    method: "PUT",
    body: JSON.stringify({ path, content, mode, confirm }),
  });
}

export function workspaceDeleteFile({ path, confirm = false }) {
  const query = `path=${encodeURIComponent(path)}&confirm=${confirm ? "true" : "false"}`;
  return apiRequest(`/api/v2/workspace/file?${query}`, { method: "DELETE" });
}

export function workspaceStats() {
  return apiRequest("/api/v2/workspace/stats", { retry: false });
}

export function workspaceAgentsMd() {
  return apiRequest("/api/v2/workspace/agents-md", { retry: false });
}