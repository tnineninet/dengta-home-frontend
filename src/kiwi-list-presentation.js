// A filtered total describes that query, not all memories for the companion.
export function describeKiwiListPage(page, shown) {
  const search = Boolean(page.query) || page.mode === "search";
  const knownTotal = Number.isSafeInteger(page.total) && page.total >= 0 && !page.partial;
  const totalLabel = knownTotal
    ? `${search ? "匹配" : "共"} ${page.total} 条`
    : search ? "匹配总数尚未确认" : "总数尚未确认";
  const count = `${totalLabel} · 已显示 ${shown} 条${page.partial ? "（部分结果）" : ""}`;
  let empty = "";
  if (shown === 0) {
    if (!knownTotal || page.hasMore || page.total > 0) {
      empty = "这一页没有返回记录。可以重新读取，或换个关键词查找。";
    } else {
      empty = search ? "没有找到匹配该关键词的记忆。" : "当前账号与伴侣暂时没有长期记忆。";
    }
  }
  return { count, empty };
}
