# 01 — 匿名 A/B 调色任务与上传校验

**What to build:** 用户无需登录即可在一个临时会话中创建调色任务，上传一张参考图 A 和一张目标图 B。系统校验文件格式、大小和可解码性，并对不合格输入提供明确、可恢复的提示；有效输入进入后续分析所需的临时任务状态。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

**Archive:** partial — 3/4 项完成，到期自动清理未实现。

- [x] 用户可以在不创建账户的情况下提交一张参考图 A 与一张目标图 B。
- [x] 系统仅接受 JPG、JPEG、PNG、WebP，以及处理链支持时作为 B 的 RAW；不支持、过大或无法解码的文件会显示可恢复错误。
- [x] 有效上传建立仅限当前会话的任务，不写入用户账户、历史记录或偏好数据。
- [ ] 上传原始文件与可识别 EXIF 按临时会话策略处理，不作为长期数据保留。

## Comments

### 2026-08-18 — 当前实现

- 已实现匿名 Cookie 会话、A/B 独立上传、普通图片 30 MB 与 RAW 40 MB 限制、支持格式签名及完整解码校验、MinIO 临时对象、PostgreSQL 任务与资产记录、Redis 入队和会话归属查询。
- 已验证有效 A/B 上传返回 `201`、任务写入两个资产、Worker 能消费队列；伪造图片返回 `422`，其他匿名会话查询返回 `404`。
- 目标图 B 已开放 DNG、CR2、CR3、NEF、ARW、RAF、RW2、ORF；Worker 使用 rawpy 生成无 EXIF JPEG 预览。八种真实 RAW 样本的逐一人工验证仍记录在 issue 05。
- 任务已记录 `expires_at`，但尚无清理 Worker 真正删除到期 MinIO 对象和数据库数据。完成该项后本 issue 才可视为全部验收通过。
