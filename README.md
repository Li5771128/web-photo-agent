# RefTone 调色分析 MVP

当前仓库支持匿名上传参考图 A 与目标图 B、创建 24 小时临时任务，并由 Python Worker 生成低分辨率预览后调用千问完成场景、主体、人物、光线和迁移限制识别。确定性图像测量、调色计划、XMP 和到期清理尚未实现。

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

视觉识别会把纠正方向、移除 EXIF、长边不超过 1024px、JPEG 质量 80 的 A/B 预览发送给阿里云百炼，并设置 `store: false`。原始分辨率图片不会发送给模型。

## 当前 API

- `POST /api/tasks`：接收 `multipart/form-data` 的 `reference` 和 `target`；每张支持 JPG、PNG、WebP，默认最大 20 MB。
- `GET /api/tasks/:taskId`：仅允许创建该任务的匿名临时会话查询识图状态和已校验视觉结果。

千问结果只用于语义内容理解，不会被声称为精确图像测量或已校验 Lightroom 参数计划。

## 验证

```powershell
docker compose build
docker run --rm -v "${PWD}\worker:/src" -w /src reftone-worker python -m unittest discover -s tests -v
docker run --rm -v "${PWD}\web:/app" -w /app node:22-alpine npm audit --omit=dev
```
