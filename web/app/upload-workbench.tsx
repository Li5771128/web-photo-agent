"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type TaskState = {
  id: string;
  status: "queued" | "queue_failed" | "recognizing" | "vision_ready" | "vision_failed" | "expired";
  workerReceivedAt: string | null;
  expiresAt: string;
  errorCode?: string | null;
  visionModel?: string | null;
  visionResult?: VisionResult | null;
};

type ImageSummary = {
  scene_type: string;
  subjects: string[];
  has_people: boolean;
  skin_tone_notes: string | null;
  lighting: string;
};

type VisionResult = {
  reference: ImageSummary;
  target: ImageSummary;
  transferable_features: string[];
  non_transferable_features: string[];
  matching_limits: string[];
  planning_risks: string[];
};

type ApiError = { error?: { message?: string } };

function FileInput({ id, label, hint }: { id: string; label: string; hint: string }) {
  return (
    <label className="upload-card" htmlFor={id}>
      <span className="upload-letter">{id === "reference" ? "A" : "B"}</span>
      <strong>{label}</strong>
      <span>{hint}</span>
      <input id={id} name={id} type="file" accept="image/jpeg,image/png,image/webp" required />
    </label>
  );
}

const errorMessages: Record<string, string> = {
  dashscope_api_key_missing: "尚未配置千问 API Key。请在 .env 中填写 DASHSCOPE_API_KEY，重启 Worker 后重新上传。",
  vision_asset_unavailable: "识图所需的临时图片不可用，请重新上传。",
  vision_preprocessing_failed: "图片预览处理失败，请更换图片后重试。",
  vision_provider_failed: "千问服务调用失败，请检查 API Key、模型权限或稍后重试。",
  vision_response_invalid: "千问返回的识图结果格式无效，请重新尝试。",
  queue_unavailable: "任务队列暂时不可用，请稍后重试。",
};

function statusCopy(task: TaskState): { title: string; detail: string; tone: "success" | "error" } {
  if (task.status === "queued") return { title: "任务已进入队列", detail: "正在等待 Python Worker…", tone: "success" };
  if (task.status === "recognizing") return { title: "千问正在识别图片内容", detail: "正在分析场景、主体、人物与光线条件…", tone: "success" };
  if (task.status === "vision_ready") return { title: "视觉识别完成", detail: `模型 ${task.visionModel ?? "qwen3.7-max"}`, tone: "success" };
  const detail = task.errorCode ? errorMessages[task.errorCode] ?? "识图失败，请重试。" : "任务未完成，请重试。";
  return { title: "任务未完成", detail, tone: "error" };
}

function SummaryCard({ label, summary }: { label: string; summary: ImageSummary }) {
  return (
    <article className="summary-card">
      <p className="step">{label}</p>
      <h3>{summary.scene_type}</h3>
      <dl>
        <div><dt>主体</dt><dd>{summary.subjects.join("、")}</dd></div>
        <div><dt>光线</dt><dd>{summary.lighting}</dd></div>
        <div><dt>人物</dt><dd>{summary.has_people ? "检测到人物" : "未检测到人物"}</dd></div>
        {summary.skin_tone_notes && <div><dt>肤色提示</dt><dd>{summary.skin_tone_notes}</dd></div>}
      </dl>
    </article>
  );
}

function InsightList({ title, items }: { title: string; items: string[] }) {
  return <section className="insight-list"><h3>{title}</h3><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></section>;
}

function VisionReport({ result }: { result: VisionResult }) {
  return (
    <section className="vision-report" aria-labelledby="vision-report-title">
      <div className="report-heading"><p className="step">步骤 2 / 3</p><h2 id="vision-report-title">图片内容理解</h2></div>
      <div className="summary-grid">
        <SummaryCard label="参考图 A" summary={result.reference} />
        <SummaryCard label="目标图 B" summary={result.target} />
      </div>
      <div className="insight-grid">
        <InsightList title="可迁移特征" items={result.transferable_features} />
        <InsightList title="不可直接迁移" items={result.non_transferable_features} />
        <InsightList title="匹配限制" items={result.matching_limits} />
        <InsightList title="规划风险" items={result.planning_risks} />
      </div>
      <p className="measurement-note">这是语义识图结果，不是亮度、直方图或色彩数值测量。确定性测量将在下一阶段接入。</p>
    </section>
  );
}

export function UploadWorkbench() {
  const [task, setTask] = useState<TaskState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!task || !["queued", "recognizing"].includes(task.status)) return;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/tasks/${task.id}`, { cache: "no-store" });
      if (response.ok) setTask((await response.json()) as TaskState);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [task]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/tasks", { method: "POST", body: new FormData(event.currentTarget) });
      const body = (await response.json()) as TaskState & ApiError;
      if (!response.ok) throw new Error(body.error?.message ?? "上传失败，请重试。");
      setTask(body);
      formRef.current?.reset();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "上传失败，请重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="workbench" aria-labelledby="upload-title">
      <div className="section-heading">
        <div><p className="step">步骤 1 / 3</p><h2 id="upload-title">上传图片对</h2></div>
        <p>每张最大 20 MB，支持 JPG、PNG、WebP。原图仅用于当前临时任务。</p>
      </div>
      <p className="privacy-note">为识别照片内容，系统会将去除 EXIF、长边不超过 1024px 的 A/B 预览图发送给阿里云百炼；不会发送原始分辨率文件，且请求不保存模型会话。</p>
      <form ref={formRef} onSubmit={submit}>
        <div className="upload-grid">
          <FileInput id="reference" label="参考图" hint="你希望借鉴的风格" />
          <FileInput id="target" label="目标图" hint="你将在 Lightroom 中调整的照片" />
        </div>
        <button className="primary" type="submit" disabled={submitting}>{submitting ? "正在创建任务…" : "上传并创建临时任务"}</button>
      </form>
      {message && <p className="notice error" role="alert">{message}</p>}
      {task && (() => {
        const copy = statusCopy(task);
        return <div className={`notice ${copy.tone}`} aria-live="polite">
          <strong>{copy.title}</strong>
          <span>任务 {task.id.slice(0, 8)} · 状态 {task.status}</span>
          <span>{copy.detail}</span>
        </div>;
      })()}
      {task?.status === "vision_ready" && task.visionResult && <VisionReport result={task.visionResult} />}
    </section>
  );
}
