export function providerSetupHint(status) {
  if (!status || status.available !== true) return null;
  const routable = Number(status.routable_profiles) || 0;
  if (routable > 0) return null;
  const profiles = Number(status.profiles) || 0;
  if (profiles === 0) {
    return {
      kind: "empty",
      title: "还没有可用的模型接口",
      text: "到设置里粘贴 Base URL 和 API Key，页面会自动读取模型并启用；启用后聊天才会接上模型。",
      actionLabel: "去配置接口",
    };
  }
  if (status.needs_enable === true) {
    return {
      kind: "disabled",
      title: "接口已保存，但还没有启用",
      text: "在接口卡片上点「启用并设为首选」，或者重新保存一次；只有启用的接口才会参与聊天。",
      actionLabel: "去启用接口",
    };
  }
  if (status.credential_reentry_required === true) {
    return {
      kind: "credential",
      title: "接口密钥需要重新填写",
      text: "旧密钥无法由当前后端解密。在接口卡片重新粘贴 API Key 并保存，然后再检查模型目录。",
      actionLabel: "去重新填写密钥",
    };
  }
  return {
    kind: "unroutable",
    title: "已保存的接口当前不能参与聊天",
    text: "可能是接口已到期、缺少默认模型，或者凭据不可用。打开接口卡片检查后重新保存即可。",
    actionLabel: "去检查接口",
  };
}
