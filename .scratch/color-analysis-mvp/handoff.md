# 调色分析 MVP 交接

更新时间：2026-08-19

## 新对话起点

先读取：

1. `.scratch/color-analysis-mvp/spec.md`
2. `.scratch/color-analysis-mvp/issues/01-anonymous-ab-task-and-upload-validation.md`
3. `.scratch/color-analysis-mvp/issues/02-style-report-and-safe-lightroom-plan.md`
4. `ARCHITECTURE.md`
5. `README.md`

当前先人工验收 issue 02 的真实千问双调用和结果页；验收通过后继续 issue 03：从已校验计划确定性生成可选 XMP。

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
- Web 页面：单页三阶段流程，显示上传、测量、识图、规划、校验和结果状态；分析阶段只显示文字状态，不显示模拟百分比。
- A/B 独立上传体验：
  - 选择后自动上传，两个通道互不阻塞并分别显示真实传输百分比。
  - 普通图片最大 30 MB；目标图 B 支持 DNG、CR2、CR3、NEF、ARW、RAF、RW2、ORF，RAW 最大 40 MB。
  - 普通图片立即显示本地缩略图；RAW 显示说明并在 Worker 解码后展示安全 JPEG 预览。
  - AI 阶段可单独换 A 或 B，新任务复用另一张图片；重新开始会取消旧任务。
  - 上传尝试带服务端槽位和单调版本，快速换图的旧请求不能覆盖新图片。
  - Worker 对预览和模型结果执行取消状态条件写入，迟到结果不会恢复旧任务。
  - A/B 上传完成后等待用户点击“确认分析”，不再自动调用图片内容理解；RAW 在确认前先生成安全预览。
- 确定性图像测量：
  - Worker 按 `queued → measuring → recognizing → planning → validating → ready` 顺序执行，测量先于千问且独立保存。
  - 普通图片纠正 EXIF 方向并转换为 sRGB；RAW 使用固定 rawpy 后处理参数，不持久化可识别 EXIF。
  - 结果包含亮度分布、明暗区域、裁切占比、对比度、HSL 饱和度、12 区间色相、主色、冷暖/绿洋红倾向、边缘活动度和 RAW 动态范围线索。
  - A/B comparison 使用 `reference - target` 差值与 `increase/decrease/similar` 方向。
  - `image_measurements` 以任务为单位原子保存 reference、target、comparison 三组 Schema v2 JSON；新增 A/B 各自的 32-bin 真实 RGB 直方图，历史 v1 仍可读取。
- 分析结果与 Lightroom 计划：
  - 结果页默认展示 A/B 预览、双 RGB 直方图、全部确定性读数、主色、A/B 调整方向、迁移边界与风险。
  - 第二次千问调用只接收清洗后的数值与已验证语义 JSON，不接收图片、EXIF、对象路径或存储地址。
  - 本地校验器约束参数白名单、8–12 项数量、顺序、RAW/JPEG 安全范围、裁切和肤色风险。
  - 参数卡按基础校正、风格塑造、可选微调展示 Lightroom 面板、起始值、安全范围、理由、效果、风险和停止条件。
  - 可行度由本地规则计算；模型草案和最终安全计划分别保存到 `lightroom_plans`，只有安全计划返回前端。
  - 规划失败可单独重试并复用测量与识图结果。

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
- Worker 离线单元测试 36 项通过，覆盖预览、RAW、千问双调用、真实直方图、规划上下文、安全校验、持久化、重试和取消安全。
- 独立上传/手动确认/单侧替换冒烟脚本通过；用户也已确认页面按钮正常出现。
- 无千问测量冒烟脚本通过：任务 API 返回完整 Schema v2 reference、target、comparison 与 A/B RGB 直方图。
- Web 生产构建和 TypeScript 检查通过；Worker 镜像构建通过。
- 数据库迁移服务退出码为 0，`vision_analyses`、`image_measurements` 与 `lightroom_plans` 表存在。
- 无 Key 的实际上传流程返回 `vision_failed / dashscope_api_key_missing`，不会发起千问请求。
- 已使用 `test1.jpg` / `test2.jpg` 完成真实 Key 联调：视觉识别成功；关闭规划深度思考后约 25 秒返回，最终任务为 `ready`，保存 12 项安全参数并记录 1 项风险收紧。
- 结果页已改为浅色结论卡与原型式可行性进度条；正文按差异、计划、风险、确定性读数排序，并提供响应式章节导航。
- 规划 Prompt v2 明确只调整目标图 B；上下文记录 `A - B` 方向语义，校验器 v1.1 会拒绝与中位亮度方向相反的曝光草案。旧计划不会自动更新，需新建任务重新分析。
- 结果页不再重复展示 A/B 图片预览；用户通过上方上传卡片核对图片，结果结论后直接进入章节导航。

## 未实现

- XMP 导出。
- 同会话调整后 JPG 微调轮次。
- 到期清理 Worker。当前 `expires_at` 不会自动删除 MinIO 或数据库数据。
- Issue 05 尚余真实大文件限速验证和八种真实 RAW 样本逐一验证；功能代码、构建和无敏感数据冒烟链路已完成。
- 确定性测量尚未使用八种真实相机 RAW 样本做跨格式准确度验证；当前 RAW 测试使用固定 mock 数据验证解码参数与非识别性线索。

## 关键边界

- 千问负责“看懂内容”，本地确定性代码负责“测量数值”。不能把模型视觉估算当作直方图或精确参数。
- 原图留在 MinIO 供本地测量；只发送低分辨率无 EXIF 派生预览给千问。
- 模型输出不是已校验 Lightroom 计划。当前仅把通过确定性白名单、范围和风险规则的安全计划展示给用户。
- XMP 只能从已校验结构化计划确定性生成，不能直接使用模型自由文本。

## 运行状态与常用命令

```powershell
docker compose ps -a
docker compose logs -f web worker
docker compose up --build -d
```

Web：<http://localhost:3000>

MinIO 控制台：<http://localhost:9001>
