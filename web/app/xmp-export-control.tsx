"use client";

import { useState } from "react";

function downloadFilename(response: Response, taskId: string): string {
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded); } catch { /* use the stable fallback */ }
  }
  return `RefTone-${taskId.slice(0, 8)}.xmp`;
}

export function XmpExportControl({ taskId }: { taskId: string }) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function exportXmp() {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const response = await fetch(`/api/tasks/${taskId}/xmp`, { cache: "no-store" });
      if (!response.ok) {
        let message = "XMP 导出失败，请稍后重试。";
        try {
          const body = await response.json() as { error?: { message?: string } };
          if (body.error?.message) message = body.error.message;
        } catch { /* keep the stable fallback */ }
        throw new Error(message);
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = downloadFilename(response, taskId);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "XMP 导出失败，请稍后重试。");
    } finally {
      setExporting(false);
    }
  }

  return <div className="xmp-export">
    <div><strong>可选 XMP 起始配方</strong><p>XMP 只包含可可靠映射的全局参数，不修改白平衡；请按参数卡手动输入色温和色调，应用后再小范围微调。</p></div>
    <button className="secondary" type="button" disabled={exporting} onClick={() => void exportXmp()}>{exporting ? "正在导出…" : "导出 XMP"}</button>
    {exportError && <p className="xmp-export-error" role="alert">{exportError} 参数卡仍可继续使用。</p>}
  </div>;
}
