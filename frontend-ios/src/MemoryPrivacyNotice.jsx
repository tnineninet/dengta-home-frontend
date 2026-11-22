export default function MemoryPrivacyNotice() {
  return <details className="memory-privacy-notice">
    <summary>记忆与隐私说明</summary>
    <p>开启记忆后，聊天内容可能发送到 Kiwi 和配置的模型服务，用于提取长期记忆、生成摘要和自动画像。点击“立即整理当前对话”会提交当前会话供处理。</p>
    <p>这里仅把 Kiwi 为当前账号和伴侣确认的条目标为长期记忆。聊天记录、手动填写的个性化指令和未保存的草稿分别管理。</p>
    <p>删除一条 Kiwi 记忆不会删除原聊天。本页的删除回执只确认这条记忆，不能据此确认摘要、画像或服务备份已清除。</p>
    <p><a href="./memory-privacy.html">阅读完整记忆与隐私说明</a></p>
  </details>;
}
