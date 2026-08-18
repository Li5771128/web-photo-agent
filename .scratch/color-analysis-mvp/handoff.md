# 调色分析 MVP 交接

更新时间：2026-08-18

## 新对话起点

先读取：

1. `.scratch/color-analysis-mvp/spec.md`
2. `.scratch/color-analysis-mvp/issues/01-anonymous-ab-task-and-upload-validation.md`
3. `.scratch/color-analysis-mvp/issues/02-style-report-and-safe-lightroom-plan.md`
4. `ARCHITECTURE.md`
5. `README.md`

当前推荐继续 issue 02：实现本地确定性图像测量，然后把测量结果与已有千问语义识图结果组合成受校验的 Lightroom 参数计划。

## 已实现

- Docker Compose：Next.js Web、Python Worker、PostgreSQL、Redis、MinIO，以及一次性数据库迁移服务。
- 匿名 A/B 上传：JPG、PNG、WebP，默认每张最大 20 MB，执行完整解码检查。
- 临时任务：匿名 Cookie 归属、PostgreSQL 状态、MinIO 对象、Redis 队列、24 小时 `expires_at`。
- 千问语义视觉识别：
  - OpenAI 兼容 Responses API。
  - 默认模型 `qwen3.7-max`。
  - 默认 Base URL `https://dashscope.aliyuncs.com/compatible-mode/v1`。
  - A/B 均转换为长边不超过 1024px、JPEG 质量 80、纠正方向且无 EXIF 的内存预览。
  - 请求设置 `store: false`。
  - 结果字段包括场景、主体、人物、肤色提示、光线、可迁移/不可迁移特征、匹配限制和规划风险。
  - 本地字段校验通过后才写入 `vision_analyses` 并展示。
- Web 页面：显示排队、识图中、识图成功、缺 Key 和服务失败状态，以及视觉识别报告。
- A/B 独立上传体验：
  - 选择后自动上传，两个通道互不阻塞并分别显示真实传输百分比。
  - 普通图片最大 30 MB；目标图 B 支持 DNG、CR2、CR3、NEF、ARW、RAF、RW2、ORF，RAW 最大 40 MB。
  - 普通图片立即显示本地缩略图；RAW 显示说明并在 Worker 解码后展示安全 JPEG 预览。
  - AI 阶段可单独换 A 或 B，新任务复用另一张图片；重新开始会取消旧任务。
  - 上传尝试带服务端槽位和单调版本，快速换图的旧请求不能覆盖新图片。
  - Worker 对预览和模型结果执行取消状态条件写入，迟到结果不会恢复旧任务。

## API Key 配置

真实 Key 填在仓库根目录的 `.env`，不要填写或提交到 `.env.example`：

```powershell
Copy-Item .env.example .env
```

然后编辑 `.env`：

```env
DASHSCOPE_API_KEY=在这里填写真实Key
```

应用配置：

```powershell
docker compose up --build -d
```

`.env` 已被 `.gitignore` 忽略。日志和数据库不得记录 Key、Authorization 请求头或完整图片 Data URI。

## 已验证

- `docker compose config` 通过。
- Next.js 生产构建与 TypeScript 检查通过。
- Worker 离线单元测试 12 项通过：预览尺寸、方向、EXIF、透明图片、RAW 预览/错误、Qwen 请求格式、两张 Data URI、`store: false`、JSON 代码块、错误响应和取消安全写入。
- 独立上传冒烟脚本通过：A/B 分别确认后自动入队，AI 阶段换 A 会取消旧任务、复用 B、只重传 A 并重新入队。
- 数据库迁移服务退出码为 0，`vision_analyses` 表存在。
- 无 Key 的实际上传流程返回 `vision_failed / dashscope_api_key_missing`，不会发起千问请求。
- 尚未使用真实 Key 做付费 API 冒烟测试。

## 未实现

- 确定性图像测量：亮度分布、直方图、主色、HSL、对比度、饱和度、色温、裁切风险和 RAW 动态范围线索。
- 将确定性测量与千问语义结果合并为规划上下文。
- 结构化 Lightroom 参数草案、数值范围、安全校验、参数卡和匹配可行度。
- XMP 导出。
- 同会话调整后 JPG 微调轮次。
- 到期清理 Worker。当前 `expires_at` 不会自动删除 MinIO 或数据库数据。
- Issue 05 尚余真实大文件限速验证和八种真实 RAW 样本逐一验证；功能代码、构建和无敏感数据冒烟链路已完成。

## 关键边界

- 千问负责“看懂内容”，本地确定性代码负责“测量数值”。不能把模型视觉估算当作直方图或精确参数。
- 原图留在 MinIO 供本地测量；只发送低分辨率无 EXIF 派生预览给千问。
- 模型输出不是已校验 Lightroom 计划。未来任何参数必须通过确定性安全校验后才能展示或导出。
- XMP 只能从已校验结构化计划确定性生成，不能直接使用模型自由文本。

## 运行状态与常用命令

```powershell
docker compose ps -a
docker compose logs -f web worker
docker compose up --build -d
```

Web：<http://localhost:3000>

MinIO 控制台：<http://localhost:9001>
