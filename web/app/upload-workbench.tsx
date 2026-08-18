"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { AnalysisResults, LightroomPlan, Measurements, VisionResult } from "./analysis-results";

type Role = "reference" | "target";
type TaskStatus = "collecting" | "queued" | "queue_failed" | "measuring" | "measurement_failed" | "recognizing" | "vision_ready" | "vision_failed" | "planning" | "planning_failed" | "validating" | "validation_failed" | "ready" | "cancelled" | "expired";
type AssetState = {
  status: "empty" | "uploading" | "confirmed" | "failed";
  errorCode?: string | null;
  originalName?: string | null;
  mediaType?: string | null;
  isRaw?: boolean;
  previewReady?: boolean;
};
type TaskState = {
  id: string;
  status: TaskStatus;
  workerReceivedAt: string | null;
  expiresAt: string;
  errorCode?: string | null;
  visionModel?: string | null;
  visionResult?: VisionResult | null;
  measurements?: Measurements | null;
  lightroomPlan?: LightroomPlan | null;
  assets: Record<Role, AssetState>;
};
type UploadPhase = "idle" | "uploading" | "confirming" | "success" | "error";
type UploadState = {
  fileName: string | null;
  isRaw: boolean;
  previewUrl: string | null;
  localPreview: boolean;
  phase: UploadPhase;
  progress: number;
  lastProgressAt: number;
  stalled: boolean;
  error: string | null;
};
type ApiError = { error?: { code?: string; message?: string } };

const rawExtensions = new Set(["dng", "cr2", "cr3", "nef", "arw", "raf", "rw2", "orf"]);
const emptyUpload = (): UploadState => ({
  fileName: null,
  isRaw: false,
  previewUrl: null,
  localPreview: false,
  phase: "idle",
  progress: 0,
  lastProgressAt: 0,
  stalled: false,
  error: null,
});

const errorMessages: Record<string, string> = {
  dashscope_api_key_missing: "尚未配置千问 API Key。请在 .env 中填写 DASHSCOPE_API_KEY，重新创建 Worker 后换图重试。",
  vision_asset_unavailable: "识图所需的临时图片不可用，请更换图片。",
  vision_preprocessing_failed: "图片预览处理失败，请更换图片后重试。",
  vision_preview_storage_failed: "图片预览暂时无法保存，请稍后重试。",
  preview_queue_unavailable: "RAW 预览暂时无法生成，请更换图片后重试。",
  raw_decode_failed: "RAW 文件无法解码，请更换目标图 B。",
  measurement_asset_unavailable: "测量所需的临时图片不可用，请更换图片。",
  measurement_decode_failed: "图片无法完成本地数值测量，请更换图片。",
  measurement_color_profile_failed: "图片的嵌入色彩配置无法可靠转换，请更换图片。",
  measurement_calculation_failed: "本地图像测量失败，请稍后重试。",
  vision_provider_failed: "千问服务调用失败，请检查 API Key、模型权限或稍后重试。",
  vision_response_invalid: "千问返回的识图结果格式无效，请重新尝试。",
  planning_provider_failed: "千问参数规划调用失败，测量与识图结果已保留。",
  planning_response_invalid: "千问返回的参数草案格式无效，测量与识图结果已保留。",
  plan_validation_failed: "参数草案未通过本地安全校验，请重新生成。",
  queue_unavailable: "任务队列暂时不可用，请稍后重试。",
};

function fileIsRaw(file: File): boolean {
  return rawExtensions.has(file.name.toLowerCase().split(".").pop() ?? "");
}

async function responseBody<T>(response: Response): Promise<T & ApiError> {
  return await response.json() as T & ApiError;
}

function statusCopy(task: TaskState): { title: string; detail: string; tone: "success" | "error" } {
  if (task.status === "collecting") {
    const bothConfirmed = task.assets.reference?.status === "confirmed" && task.assets.target?.status === "confirmed";
    const rawPreviewPending = Boolean(task.assets.target?.isRaw && !task.assets.target?.previewReady);
    if (bothConfirmed && rawPreviewPending) return { title: "RAW 预览生成中", detail: "预览完成后即可确认分析。", tone: "success" };
    if (bothConfirmed) return { title: "图片已准备好", detail: "请核对图片后点击“确认分析”。", tone: "success" };
    return { title: "等待图片上传", detail: "A、B 均上传成功后可以确认分析。", tone: "success" };
  }
  if (task.status === "queued") return { title: "任务已进入队列", detail: "正在等待 Python Worker…", tone: "success" };
  if (task.status === "measuring") return { title: "正在进行图像测量", detail: "本地计算亮度、色彩、对比度与 A/B 差异…", tone: "success" };
  if (task.status === "recognizing") return { title: "千问正在理解图片内容", detail: "正在分析场景、主体、人物与光线条件…", tone: "success" };
  if (task.status === "vision_ready") return { title: "图片内容理解完成", detail: "可以继续生成 Lightroom 参数计划。", tone: "success" };
  if (task.status === "planning") return { title: "正在生成 Lightroom 参数草案", detail: "根据确定性读数与内容理解生成 8–12 项高价值调整…", tone: "success" };
  if (task.status === "validating") return { title: "正在校验参数安全性", detail: "本地检查参数白名单、范围、素材格式与图像风险…", tone: "success" };
  if (task.status === "ready") return { title: "分析与参数计划完成", detail: `模型 ${task.visionModel ?? "qwen3.7-max"} · 已通过本地校验`, tone: "success" };
  const detail = task.errorCode ? errorMessages[task.errorCode] ?? "任务失败，请更换图片或重试。" : "任务未完成，请重试。";
  return { title: "任务未完成", detail, tone: "error" };
}

function UploadCard({
  role,
  state,
  onSelect,
}: {
  role: Role;
  state: UploadState;
  onSelect: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const isReference = role === "reference";
  const inputId = `${role}-file`;
  const phaseCopy: Record<UploadPhase, string> = {
    idle: isReference ? "选择后自动上传，最大 30 MB" : "普通图片 30 MB，RAW 40 MB",
    uploading: state.stalled ? `仍在上传 · ${state.progress}%` : `正在上传 · ${state.progress}%`,
    confirming: "服务器确认中…",
    success: "上传成功",
    error: state.error ?? "上传失败，请更换或重试。",
  };
  return (
    <article className={`upload-card ${state.phase}`}>
      <div className="upload-card-head">
        <span className="upload-letter">{isReference ? "A" : "B"}</span>
        <div><strong>{isReference ? "参考图" : "目标图"}</strong><span>{isReference ? "你希望借鉴的风格" : "你将在 Lightroom 中调整的照片"}</span></div>
      </div>
      {state.previewUrl ? <img className="upload-preview" src={state.previewUrl} alt={`${isReference ? "参考图 A" : "目标图 B"}缩略图`} /> : state.isRaw ? (
        <div className="raw-placeholder"><strong>RAW</strong><span>RAW 文件需上传后生成预览，上传期间暂不显示缩略图。</span></div>
      ) : <div className="upload-empty">选择图片后将在这里显示缩略图</div>}
      {state.fileName && <span className="file-name" title={state.fileName}>{state.fileName}</span>}
      {(state.phase === "uploading" || state.phase === "confirming") && (
        <progress aria-label={`${isReference ? "参考图" : "目标图"}上传进度`} max="100" value={state.progress}>{state.progress}%</progress>
      )}
      <span className={`upload-phase ${state.phase}`} aria-live="polite">{phaseCopy[state.phase]}</span>
      <label className="file-action" htmlFor={inputId}>{state.phase === "idle" ? "选择图片" : "更换图片"}</label>
      <input
        id={inputId}
        className="file-input"
        type="file"
        accept={isReference ? "image/jpeg,image/png,image/webp" : "image/jpeg,image/png,image/webp,.dng,.cr2,.cr3,.nef,.arw,.raf,.rw2,.orf"}
        onChange={onSelect}
      />
    </article>
  );
}

export function UploadWorkbench() {
  const [task, setTaskState] = useState<TaskState | null>(null);
  const [uploads, setUploads] = useState<Record<Role, UploadState>>({ reference: emptyUpload(), target: emptyUpload() });
  const [message, setMessage] = useState<string | null>(null);
  const [confirmingAnalysis, setConfirmingAnalysis] = useState(false);
  const taskRef = useRef<TaskState | null>(null);
  const taskCreationRef = useRef<Promise<TaskState> | null>(null);
  const xhrs = useRef<Record<Role, XMLHttpRequest | null>>({ reference: null, target: null });
  const uploadsRef = useRef(uploads);
  const selectionVersions = useRef<Record<Role, number>>({ reference: 0, target: 0 });

  function setTask(next: TaskState | null) { taskRef.current = next; setTaskState(next); }
  function updateUpload(role: Role, change: Partial<UploadState>) {
    setUploads((current) => ({ ...current, [role]: { ...current[role], ...change } }));
  }
  function releasePreview(state: UploadState) { if (state.localPreview && state.previewUrl) URL.revokeObjectURL(state.previewUrl); }

  useEffect(() => { uploadsRef.current = uploads; }, [uploads]);
  useEffect(() => () => {
    xhrs.current.reference?.abort(); xhrs.current.target?.abort();
    releasePreview(uploadsRef.current.reference); releasePreview(uploadsRef.current.target);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      setUploads((current) => {
        let changed = false;
        const next = { ...current };
        for (const role of ["reference", "target"] as const) {
          const state = current[role];
          const stalled = state.phase === "uploading" && now - state.lastProgressAt >= 3000;
          if (stalled !== state.stalled) { next[role] = { ...state, stalled }; changed = true; }
        }
        return changed ? next : current;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const rawPreviewPending = task?.status === "collecting"
      && task.assets.target?.status === "confirmed"
      && task.assets.target?.isRaw
      && !task.assets.target?.previewReady;
    if (!task || (!["queued", "measuring", "recognizing", "vision_ready", "planning", "validating"].includes(task.status) && !rawPreviewPending)) return;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/tasks/${task.id}`, { cache: "no-store" });
      if (!response.ok) return;
      const next = await responseBody<TaskState>(response);
      setTask(next);
      for (const role of ["reference", "target"] as const) {
        const asset = next.assets?.[role];
        if (asset?.isRaw && asset.previewReady) {
          updateUpload(role, { previewUrl: `/api/tasks/${next.id}/assets/${role}/preview?v=${Date.now()}`, localPreview: false });
        }
        if (asset?.status === "failed" && asset.errorCode) updateUpload(role, { phase: "error", error: errorMessages[asset.errorCode] ?? "图片处理失败。" });
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [task?.id, task?.status, task?.assets.target?.status, task?.assets.target?.isRaw, task?.assets.target?.previewReady]);

  async function ensureTask(): Promise<TaskState> {
    if (taskRef.current?.status === "collecting") return taskRef.current;
    if (taskCreationRef.current) return taskCreationRef.current;
    taskCreationRef.current = (async () => {
      const response = await fetch("/api/tasks", { method: "POST" });
      const body = await responseBody<TaskState>(response);
      if (!response.ok) throw new Error(body.error?.message ?? "临时任务创建失败。");
      setTask(body);
      return body;
    })();
    try { return await taskCreationRef.current; }
    finally { taskCreationRef.current = null; }
  }

  async function replacementTask(role: Role): Promise<TaskState | null> {
    const current = taskRef.current;
    if (!current || current.status === "collecting") return current;
    if (!window.confirm("更换该图片会取消当前分析并重新开始，是否继续？")) return null;
    const response = await fetch(`/api/tasks/${current.id}/replacement`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ replaceRole: role }),
    });
    const body = await responseBody<{ id: string; status: TaskStatus; expiresAt: string; retainedRole: Role }>(response);
    if (!response.ok) throw new Error(body.error?.message ?? "换图任务创建失败。");
    const retained = body.retainedRole;
    const next: TaskState = {
      id: body.id, status: "collecting", workerReceivedAt: null, expiresAt: body.expiresAt,
      assets: {
        reference: retained === "reference" ? { ...current.assets.reference, status: "confirmed" } : { status: "empty" },
        target: retained === "target" ? { ...current.assets.target, status: "confirmed" } : { status: "empty" },
      },
    };
    setTask(next);
    if (uploads[retained].isRaw && current.assets[retained]?.previewReady) {
      updateUpload(retained, { previewUrl: `/api/tasks/${next.id}/assets/${retained}/preview?v=${Date.now()}`, localPreview: false, phase: "success" });
    }
    return next;
  }

  async function uploadFile(role: Role, file: File, selectionVersion: number) {
    setMessage(null);
    try {
      let currentTask = taskRef.current;
      if (currentTask && currentTask.status !== "collecting") {
        currentTask = await replacementTask(role);
        if (!currentTask || selectionVersions.current[role] !== selectionVersion) return;
      }
      currentTask ??= await ensureTask();
      if (selectionVersions.current[role] !== selectionVersion) return;
      const attemptResponse = await fetch(`/api/tasks/${currentTask.id}/assets/${role}/attempts`, {
        method: "POST", headers: { "X-Upload-Generation": String(selectionVersion) },
      });
      const attempt = await responseBody<{ attemptId: string }>(attemptResponse);
      if (!attemptResponse.ok) throw new Error(attempt.error?.message ?? "无法开始上传。");
      if (selectionVersions.current[role] !== selectionVersion) return;

      const xhr = new XMLHttpRequest();
      xhrs.current[role]?.abort();
      xhrs.current[role] = xhr;
      xhr.open("PUT", `/api/tasks/${currentTask.id}/assets/${role}/attempts/${attempt.attemptId}`);
      xhr.upload.onprogress = (event) => {
        if (xhrs.current[role] !== xhr || selectionVersions.current[role] !== selectionVersion || !event.lengthComputable) return;
        const progress = Math.min(100, Math.round(event.loaded / event.total * 100));
        updateUpload(role, { progress, phase: progress === 100 ? "confirming" : "uploading", lastProgressAt: Date.now(), stalled: false });
      };
      xhr.onload = () => {
        if (xhrs.current[role] !== xhr || selectionVersions.current[role] !== selectionVersion) return;
        xhrs.current[role] = null;
        let body: { status?: TaskStatus } & ApiError = {};
        try { body = JSON.parse(xhr.responseText || "{}"); } catch { body = {}; }
        if (xhr.status >= 200 && xhr.status < 300) {
          updateUpload(role, { phase: "success", progress: 100, stalled: false, error: null });
          const active = taskRef.current;
          if (active) setTask({
            ...active,
            status: body.status ?? active.status,
            assets: { ...active.assets, [role]: { status: "confirmed", originalName: file.name, isRaw: fileIsRaw(file), previewReady: false } },
          });
        } else updateUpload(role, { phase: "error", error: body.error?.message ?? "图片上传失败，请重试。", stalled: false });
      };
      xhr.onerror = () => { if (xhrs.current[role] === xhr && selectionVersions.current[role] === selectionVersion) { xhrs.current[role] = null; updateUpload(role, { phase: "error", error: "网络错误，图片上传失败。", stalled: false }); } };
      xhr.onabort = () => { if (xhrs.current[role] === xhr) xhrs.current[role] = null; };
      const form = new FormData(); form.set("file", file); xhr.send(form);
    } catch (error) {
      if (selectionVersions.current[role] === selectionVersion) {
        updateUpload(role, { phase: "error", error: error instanceof Error ? error.message : "图片上传失败。", stalled: false });
      }
    }
  }

  async function selectFile(role: Role, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    const selectionVersion = ++selectionVersions.current[role];
    const isRaw = fileIsRaw(file);
    if (role === "reference" && isRaw) { updateUpload(role, { phase: "error", error: "参考图 A 暂不支持 RAW。" }); return; }
    if (taskRef.current && taskRef.current.status !== "collecting") {
      try {
        const replacement = await replacementTask(role);
        if (!replacement || selectionVersions.current[role] !== selectionVersion) return;
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "换图任务创建失败。");
        return;
      }
    }
    xhrs.current[role]?.abort();
    releasePreview(uploads[role]);
    updateUpload(role, {
      fileName: file.name, isRaw, previewUrl: isRaw ? null : URL.createObjectURL(file), localPreview: !isRaw,
      phase: "uploading", progress: 0, lastProgressAt: Date.now(), stalled: false, error: null,
    });
    await uploadFile(role, file, selectionVersion);
  }

  async function restart() {
    if (!window.confirm("重新开始会取消当前上传与分析，是否继续？")) return;
    selectionVersions.current.reference += 1; selectionVersions.current.target += 1;
    xhrs.current.reference?.abort(); xhrs.current.target?.abort();
    releasePreview(uploads.reference); releasePreview(uploads.target);
    const current = taskRef.current;
    setUploads({ reference: emptyUpload(), target: emptyUpload() }); setTask(null); setMessage(null); setConfirmingAnalysis(false);
    if (current) await fetch(`/api/tasks/${current.id}`, { method: "DELETE" }).catch(() => undefined);
  }

  async function confirmAnalysis() {
    const current = taskRef.current;
    if (!current || confirmingAnalysis) return;
    setConfirmingAnalysis(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/tasks/${current.id}/analysis`, { method: "POST" });
      const body = await responseBody<{ id: string; status: TaskStatus }>(response);
      if (!response.ok) throw new Error(body.error?.message ?? "暂时无法开始分析，请稍后重试。");
      const active = taskRef.current;
      if (active?.id === current.id) setTask({ ...active, status: body.status, errorCode: null });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "暂时无法开始分析，请稍后重试。");
    } finally {
      setConfirmingAnalysis(false);
    }
  }

  const copy = task ? statusCopy(task) : null;
  const bothConfirmed = task?.assets.reference?.status === "confirmed" && task.assets.target?.status === "confirmed";
  const rawPreviewPending = Boolean(task?.assets.target?.isRaw && !task.assets.target?.previewReady);
  const showAnalysisConfirmation = Boolean(task && bothConfirmed && ["collecting", "queue_failed"].includes(task.status));
  const hasResults = Boolean(task?.visionResult && task.measurements);
  const workflowStage = hasResults ? 3 : task && !["collecting", "queue_failed"].includes(task.status) ? 2 : 1;
  return <section className="workbench" aria-labelledby="upload-title">
    <nav className="flow-steps" aria-label="分析流程">{["上传图片", "图像分析", "查看结果"].map((label, index) => <div className={`${workflowStage === index + 1 ? "active" : ""} ${workflowStage > index + 1 ? "done" : ""}`} key={label}><span>{workflowStage > index + 1 ? "✓" : index + 1}</span><strong>{label}</strong></div>)}</nav>
    <div className="section-heading"><div><p className="step">步骤 {workflowStage} / 3</p><h2 id="upload-title">{workflowStage === 1 ? "上传图片对" : workflowStage === 2 ? "正在分析图片对" : "分析结果"}</h2></div><p>{workflowStage === 1 ? "A/B 选择后独立自动上传。普通图片最大 30 MB；目标图 B 的 RAW 最大 40 MB。" : workflowStage === 2 ? "测量、内容理解与参数规划依次执行；分析阶段不显示模拟百分比。" : "所有读数默认展开；你仍可以单独更换 A 或 B 重新分析。"}</p></div>
    {workflowStage === 1 && <p className="privacy-note">RAW 需上传后生成预览；上传期间暂不显示缩略图。系统只将去除 EXIF、长边不超过 1024px 的 A/B 预览发送给阿里云百炼，不发送原始分辨率文件。</p>}
    <div className={`upload-grid ${workflowStage > 1 ? "compact" : ""}`}><UploadCard role="reference" state={uploads.reference} onSelect={(event) => void selectFile("reference", event)} /><UploadCard role="target" state={uploads.target} onSelect={(event) => void selectFile("target", event)} /></div>
    {showAnalysisConfirmation && <div className="analysis-confirmation">
      <button className="primary" type="button" disabled={confirmingAnalysis || rawPreviewPending} onClick={() => void confirmAnalysis()}>
        {confirmingAnalysis ? "正在提交…" : rawPreviewPending ? "RAW 预览生成中…" : "确认分析"}
      </button>
      <p>{rawPreviewPending ? "请等待 RAW 预览生成并核对图片。" : "点击后才会开始图片内容理解。"}</p>
    </div>}
    {task && ["vision_ready", "planning_failed", "validation_failed"].includes(task.status) && <div className="analysis-confirmation retry-planning">
      <button className="primary" type="button" disabled={confirmingAnalysis} onClick={() => void confirmAnalysis()}>
        {confirmingAnalysis ? "正在重新提交…" : "重新生成参数计划"}
      </button>
      <p>将复用已完成的图像测量和内容理解，不会重新上传或再次识图。</p>
    </div>}
    {task && <button className="secondary" type="button" onClick={() => void restart()}>重新开始</button>}
    {message && <p className="notice error" role="alert">{message}</p>}
    {task && copy && <div className={`notice ${copy.tone}`} aria-live="polite"><strong>{copy.title}</strong><span>任务 {task.id.slice(0, 8)} · 状态 {task.status}</span><span>{copy.detail}</span></div>}
    {task?.visionResult && task.measurements && <AnalysisResults vision={task.visionResult} measurements={task.measurements} plan={task.lightroomPlan} />}
  </section>;
}
