# RefTone 调色分析 MVP

当前仓库支持匿名、独立上传参考图 A 与目标图 B、创建 24 小时临时任务，并由 Python Worker 完成本地确定性图像测量，再以低分辨率预览调用千问识别场景、主体、人物、光线和迁移限制。A/B 选择后自动上传且互不阻塞；目标图 B 支持常见 RAW。调色计划、XMP 和到期清理尚未实现。

## 本地启动

要求 Docker Desktop、Docker Engine 和 Docker Compose 可用。

```powershell
Copy-Item .env.example .env
# 编辑 .env，填写 DASHSCOPE_API_KEY
docker compose up --build -d
docker compose ps
```

打开 <http://localhost:3000>。MinIO 控制台位于 <http://localhost:9001>。

如需查看服务日志：

```powershell
docker compose logs -f web worker
```

停止服务但保留本地数据：

```powershell
docker compose down
```

`.env.example` 中的 `DASHSCOPE_API_KEY` 故意留空，请只在未提交的 `.env` 中填写。默认模型是 `qwen3.7-max`，Base URL 是 `https://dashscope.aliyuncs.com/compatible-mode/v1`。`SESSION_SECRET` 的默认值仅适合本地开发，正式环境必须替换为至少 32 个随机字符。

普通图片最大 30 MB。参考图 A 支持 JPG、PNG、WebP；目标图 B 还支持 DNG、CR2、CR3、NEF、ARW、RAF、RW2、ORF，RAW 最大 40 MB。RAW 上传后由 Worker 通过 rawpy/LibRaw 生成预览。视觉识别只把纠正方向、移除 EXIF、长边不超过 1024px、JPEG 质量 80 的 A/B 预览发送给阿里云百炼，并设置 `store: false`；原始分辨率图片和 RAW 不发送给模型。

## 当前 API

- `POST /api/tasks`：创建状态为 `collecting` 的匿名临时任务。
- `POST /api/tasks/:taskId/assets/:role/attempts`：为 A 或 B 创建独立上传尝试。
- `PUT /api/tasks/:taskId/assets/:role/attempts/:attemptId`：上传并确认单张图片；RAW 会先生成安全预览。
- `POST /api/tasks/:taskId/analysis`：A/B 均确认且所需预览就绪后，由用户确认并原子入队。
- `GET /api/tasks/:taskId`：仅允许创建该任务的匿名临时会话查询状态、版本化确定性测量和已校验视觉结果。
- `GET /api/tasks/:taskId/assets/:role/preview`：读取会话所属任务的服务端安全预览。
- `POST /api/tasks/:taskId/replacement`：AI 已开始后单独换 A 或 B，并复用未更换图片。
- `DELETE /api/tasks/:taskId`：幂等取消任务并清理当前已记录的临时对象。

千问结果只用于语义内容理解，不会被声称为精确图像测量或已校验 Lightroom 参数计划。

## 验证

```powershell
docker compose build
docker run --rm -v "${PWD}\worker:/src" -w /src reftone-worker python -m unittest discover -s tests -v
docker run --rm -v "${PWD}\web:/app" -w /app node:22-alpine npm audit --omit=dev
./scripts/smoke-independent-uploads.ps1
./scripts/smoke-measurements.ps1
```

冒烟脚本会短暂停止本地 Worker，使用生成的无敏感测试 PNG 验证 A/B 独立上传、手动确认入队、单侧替换、取消，以及 A/B/comparison 三组确定性测量，然后恢复 Worker；不会调用千问。
