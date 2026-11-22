# 原子导入提交（0.29.26）

`previewContentImport` 为新预览标记 `atomic-v1`。服务先校验全部候选，再通过租户数据库调用 `commit_content_import_atomic`；账号和伴侣 ID 由请求作用域覆盖，客户端不能指定其他账号。

数据库锁定所属导入任务，在一个事务中更新候选、追加用户明确接受的设置内容、写入记忆/记忆日历/世界书，最后保存完成状态及决策 SHA-256。任何一步失败都会回滚整轮写入。相同导入 ID 和相同规范化决策重放只返回原回执；不同决策返回 `import_commit_conflict`。同一伴侣的设置通过行更新追加，保留原文。

部署顺序：先执行 `supabase/migrations/20261001095415_atomic_content_import.sql`，再部署后端。函数仅允许 `service_role` 执行，使用 SECURITY INVOKER、空 search_path；原有 RLS 和表权限保持不变。迁移可重复执行，仅添加两个可空技术字段及函数，没有更新既有导入记录或用户个性化内容。旧后端可在新结构上运行；代码回滚无须删除列或函数。

旧版预览无法可靠判断是否已经写入过部分结果，因此没有自动升级旧记录。`import_legacy_preview` / `import_partial_legacy` 要求先核对已保存内容，再重新预览并拒绝已导入的候选。已经提交的旧导入仍可读取原回执。

已明确回滚/未开始写入的错误可核对候选后再次提交。网络异常、超时、错误回执使用 `import_commit_unconfirmed` / `import_commit_receipt_invalid`，前端先查询所属任务，禁止直接重复提交。数据库原始错误正文不返回用户；日志界面显示稳定错误码与操作办法。

回归：`npm run test:content-import` 包含实际 PostgreSQL SQL 执行、晚阶段故障回滚、相同决策重放、不同决策冲突、作用域覆盖、不同账号/伴侣拒绝、旧记录保护、缺失迁移与网络异常。`npm run test:multitenant-db` 在既有全迁移链后重复执行新迁移并核对个性化快照。PGlite 是本地单连接 PostgreSQL 环境，不能代替真实并发多连接验收。

2026-10-01 在目标 Supabase 项目完成新迁移；临时虚构账号/伴侣的五种目标、回滚、重放与范围检查通过，所有测试数据随事务 ROLLBACK。未修改真实用户内容。真实用户导入、Android 真机和全功能验收仍待完成。
