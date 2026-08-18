# 千问低分辨率视觉识别设计

## 目标

在现有匿名 A/B 调色任务中接入阿里云百炼 `qwen3.7-max`，让系统理解照片的场景、主体、人物与肤色、光线条件以及参考特征是否可迁移。本能力只负责语义视觉理解，不把模型的视觉估算当作精确图像测量。

## 架构边界

系统采用混合分析：原始 A/B 图片留在本地对象存储，后续由确定性图像测量模块计算亮度、直方图、色彩、裁切等数值；千问只接收为内容识别生成的低分辨率、无 EXIF 预览图。

这项设计明确修订 `ARCHITECTURE.md` 中“模型不接收原始文件二进制”的约束：模型仍不接收原图，但允许接收经过缩放、重新编码和去除元数据的派生预览图。上传界面需要告知用户图片内容会发送给阿里云百炼进行视觉分析。

## 预览图处理

Worker 从 MinIO 读取参考图 A 和目标图 B，并分别执行：

1. 根据 EXIF 方向纠正画面。
2. 保持宽高比，将长边限制为 1024 像素；小于该尺寸时不放大。
3. 转换为 sRGB JPEG，质量为 80。
4. 不复制 EXIF、ICC 注释或其他可识别元数据。
5. 预览图只保存在内存中，不作为新的对象写回 MinIO。

原始上传图片仍用于后续确定性测量，不因视觉预览的降采样而降低测量精度。

## 千问 Adapter

Worker 内提供独立的 Qwen Vision Adapter，配置全部来自环境变量：

- `DASHSCOPE_API_KEY`：默认留空，由用户自行填写。
- `DASHSCOPE_BASE_URL`：默认 `https://dashscope.aliyuncs.com/compatible-mode/v1`。
- `DASHSCOPE_MODEL`：默认 `qwen3.7-max`。
- `VISION_MAX_EDGE`：默认 `1024`。
- `VISION_JPEG_QUALITY`：默认 `80`。

Adapter 调用 OpenAI 兼容 Responses API，同时传入 A/B 两张 JPEG Data URI，并设置 `store: false`。请求不开启联网搜索、代码执行或服务端对话历史。

Prompt 要求模型只返回 JSON，内容包括：

- A/B 各自的场景类型、主体、人物与肤色存在情况、光线方向和质量。
- 参考图可迁移的色调与视觉特征。
- 构图、主体、场景和光线等不可由调色迁移的特征。
- A/B 的语义匹配限制和后续参数规划应关注的风险。

模型输出必须经过本地 Schema 校验。无法解析或字段缺失时，任务进入明确的视觉识别失败状态，原始模型文本不能直接成为用户可见的最终调色建议。

## 数据与状态

PostgreSQL 为任务保存临时视觉识别结果、模型标识、响应 ID、完成时间与安全错误码。识别结果随匿名任务到期一起删除，不形成账户、历史或偏好档案。

状态流扩展为：

`queued → recognizing → vision_ready`

失败时进入 `vision_failed`，并用以下安全错误码区分阶段：

- `dashscope_api_key_missing`
- `vision_asset_unavailable`
- `vision_preprocessing_failed`
- `vision_provider_failed`
- `vision_response_invalid`

API Key、完整 Data URI、模型原始响应和异常中的认证请求头不得写入日志或数据库。

## Web 行为

任务查询接口返回识别状态和已校验视觉结果。上传页轮询任务，在完成后展示 A/B 场景识别、光线与主体摘要、可迁移特征和限制；失败时展示对应的可恢复提示。

当 API Key 留空时，上传仍可完成，但任务会显示“尚未配置千问 API Key”，不会声称已经完成识图。用户填写 `.env` 并重启 Worker 后，可重新上传图片创建任务。

## 错误处理与可靠性

- HTTP 调用设置连接和总超时，并仅对超时、限流和服务端错误做有限重试。
- 认证失败、无效模型和无效响应不自动无限重试。
- 每个任务最多写入一份当前视觉结果；重复消费通过任务状态保证幂等。
- Worker 异常不能导致任务永久停留在 `recognizing`，失败状态必须包含可安全展示的错误码。

## 测试

- 单元测试预览图最长边、方向纠正、JPEG 输出和 EXIF 移除。
- 使用假的 HTTP Transport 验证请求模型、Base URL、两张 Data URI 与 `store: false`。
- 覆盖有效 JSON、Markdown 代码块 JSON、字段缺失和非 JSON 响应。
- 覆盖缺少 API Key、401、429、超时和服务端错误到任务错误码的映射。
- 集成测试 Worker 从 MinIO 读取 A/B、写入视觉结果并完成状态迁移。
- 无真实 API Key 的默认测试不得访问阿里云或产生费用。

## 非目标

- 本阶段不生成 Lightroom 参数计划，不实现 XMP 导出。
- 不将千问输出视为亮度、直方图或色彩数值的确定性测量。
- 不发送原始分辨率图片、RAW 文件或可识别 EXIF 给千问。
- 不保存供千问使用的服务端对话历史。
