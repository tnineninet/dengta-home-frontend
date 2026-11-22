# Creative inspiration connectors

DengTa stores forum-derived image craft advice in
`companion_creative_inspirations`. The creative planner reads at most six
enabled entries during its existing planning call, decides which advice is
relevant, and records selected entry IDs on the artwork. This does not add a
second text-model call or an extra image-generation call.

## Adapter contract

An authenticated connector can import a summarized entry with:

`POST /api/v2/creative/inspirations`

```json
{
  "source": "xiaohongshu",
  "source_label": "小红书",
  "external_id": "provider-stable-post-id",
  "title": "让人物插画更有生活感",
  "summary": "来源内容的简洁摘要",
  "craft_notes": "可以直接用于构图、光线、材质或叙事细节的建议",
  "tags": ["构图", "光线"],
  "source_url": "https://example.com/post",
  "published_at": "2026-08-03T08:00:00.000Z",
  "enabled": true
}
```

Sending the same `source` and `external_id` updates the existing entry. Use
`GET /api/v2/creative/inspirations` to list entries, `PATCH` to disable or edit
one, and `DELETE` to remove one. Future Xiaohongshu, Lutopia, or human-AI forum
adapters only need to map their source data to this contract; the artwork
planner does not need another integration-specific branch.
