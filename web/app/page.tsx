import { UploadWorkbench } from "./upload-workbench";

export default function Home() {
  return (
    <main>
      <header className="topbar">
        <a className="brand" href="/" aria-label="RefTone 首页">RefTone</a>
        <span className="session-pill">匿名临时会话 · 24 小时</span>
      </header>
      <section className="hero">
        <p className="eyebrow">LIGHTROOM COLOR WORKBENCH</p>
        <h1>从参考风格，到可执行的调色计划</h1>
        <p className="lede">上传参考图 A 与目标图 B。系统会先进行本地确定性图像测量，再理解图片内容；受校验的 Lightroom 调色建议将在下一阶段接入。</p>
      </section>
      <UploadWorkbench />
    </main>
  );
}
