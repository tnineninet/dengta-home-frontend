# Xinchao Tenant Gateway

给 DengTa 用的多租户心潮网关。它**不修改**心潮核心，而是为每个
`user_id:companion_id` 懒启动一个独立的心潮子进程：

- 独立 `state.json` / transition journal
- 独立随机 `SERVICE_TOKEN`
- 独立端口
- 独立驱力、情绪、睡眠、念头和事件
- 空闲后自动停止，下一次请求再启动

DengTa 后端只会带着自己的机器 token 和 `X-Tenant-Id` 访问网关；浏览器永远
不接触 `SERVICE_TOKEN`，也不能指定别人的租户。

## 目录约定

```text
/opt/xinchao-core/              # xinchao-dynamic-mind 源码，未修改
/opt/xinchao-tenant-gateway/    # 本目录
/opt/xinchao-tenants/state/     # 每个租户的持久状态
```

## 1. 准备心潮核心

```bash
sudo mkdir -p /opt
cd /opt
sudo git clone --depth 1 https://github.com/tianyupaipai-cmd/xinchao-dynamic-mind.git xinchao-core
sudo chown -R ubuntu:ubuntu /opt/xinchao-core
```

核心没有第三方运行依赖，Node.js 20+ 即可。

## 2. 部署网关

把本目录上传到 `/opt/xinchao-tenant-gateway`，然后：

```bash
cd /opt/xinchao-tenant-gateway
cp .env.example .env
openssl rand -hex 32   # 填入 GATEWAY_TOKEN
chmod 600 .env
```

`.env` 示例：

```env
PORT=18200
HOST=127.0.0.1
GATEWAY_TOKEN=至少32位的随机值
XINCHAO_CORE_DIR=/opt/xinchao-core
TENANT_STATE_ROOT=/opt/xinchao-tenants/state
TENANT_BASE_PORT=19100
TENANT_MAX_PORT=19999
MAX_ACTIVE_TENANTS=20
TENANT_IDLE_MINUTES=30
# 可选：把旧单实例心潮 state.json 复制成 owner 租户
OWNER_TENANT_ID=
OWNER_STATE_FILE=
```

网关本身不读 `.env`；用 systemd 的 `EnvironmentFile` 注入：

```ini
[Unit]
Description=Xinchao tenant gateway
After=network-online.target

[Service]
User=ubuntu
WorkingDirectory=/opt/xinchao-tenant-gateway
EnvironmentFile=/opt/xinchao-tenant-gateway/.env
ExecStart=/usr/bin/node /opt/xinchao-tenant-gateway/gateway.cjs
Restart=always
RestartSec=3
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now xinchao-tenant-gateway
sudo systemctl status xinchao-tenant-gateway
curl -sS http://127.0.0.1:18200/health
```

## 3. 防火墙

子进程会监听 `19100–19999`。这些端口**只能**供本机网关访问，不能暴露公网：

```bash
sudo ufw deny 19100:19999/tcp
```

如果使用云厂商安全组，也要只放行 SSH/HTTPS，不放行这些端口。

## 4. 暴露给 Render

用 Cloudflare Tunnel 增加一条路由，例如：

```text
xinchao-tenants.dengtahome.com -> http://localhost:18200
```

然后在 Render 后端设置：

```env
XINCHAO_TENANT_GATEWAY_URL=https://xinchao-tenants.dengtahome.com
XINCHAO_TENANT_GATEWAY_TOKEN=与 GATEWAY_TOKEN 相同
```

不要把这个 token 写到前端、聊天、截图或 Git。

## 5. 验证

```bash
TOKEN=$(grep '^GATEWAY_TOKEN=' /opt/xinchao-tenant-gateway/.env | cut -d= -f2-)
TENANT='11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222'

curl -sS -H "Authorization: Bearer $TOKEN" \
  -H "X-Tenant-Id: $TENANT" \
  http://127.0.0.1:18200/v1/state | head -c 300
echo
```

再用第二个租户请求一次，确认 `revision` / state 独立；两个状态目录应不同。

## 6. 新用户

不需要注册钩子。新用户第一次请求心潮状态或聊天时，DengTa 会带上新的
`user_id:companion_id`，网关自动启动该租户的独立实例；之后状态持久保存在
`/opt/xinchao-tenants/state/<hash>/state.json`。

## 7. 备份

```bash
tar czf /opt/xinchao-tenants-$(date +%F).tar.gz /opt/xinchao-tenants/state
```

备份包含用户状态，不要上传到公开仓库或公开云盘。

## 本地测试

```bash
node --test test/gateway.test.cjs
```

测试会启动两个真实租户实例，确认一个租户的 conversation event 不会改变另一个
租户的 revision。
