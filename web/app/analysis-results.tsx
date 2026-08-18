type ImageSummary = {
  scene_type: string;
  subjects: string[];
  has_people: boolean;
  skin_tone_notes: string | null;
  lighting: string;
};

export type VisionResult = {
  reference: ImageSummary;
  target: ImageSummary;
  transferable_features: string[];
  non_transferable_features: string[];
  matching_limits: string[];
  planning_risks: string[];
};

type Histogram = { bins: number; sample_count: number; channels: { red: number[]; green: number[]; blue: number[] } };
type Measurement = {
  schema_version: number;
  source: { kind: string; width: number; height: number; sample_width: number; sample_height: number };
  luminance: { mean: number; standard_deviation: number; p05: number; p50: number; p95: number };
  tonal_regions: { shadow_fraction: number; highlight_fraction: number; black_clip_fraction: number; white_clip_fraction: number };
  contrast: { rms: number; effective_range: number };
  saturation: { mean: number; p50: number; p95: number };
  color_cast: { warmth: number; green_magenta: number };
  rgb_histogram?: Histogram;
  dominant_colors: { hex: string; fraction: number }[];
  edge_activity: number;
  raw_clues: Record<string, unknown> | null;
};

type Difference = { delta: number; direction: "increase" | "decrease" | "similar" };
export type Measurements = {
  schemaVersion: number;
  reference: Measurement;
  target: Measurement;
  comparison: Record<string, Difference>;
  completedAt: string;
};

export type PlanParameter = {
  key: string;
  label: string;
  panel: string;
  group: "basic" | "style" | "fine_tune";
  value: number;
  safe_min: number;
  safe_max: number;
  unit: string;
  reason: string;
  expected_effect: string;
  risk: string;
  stop_condition: string;
};

export type LightroomPlan = {
  style_name: string;
  summary: string;
  feasibility: { score: number; level: "low" | "medium" | "high"; reasons: string[] };
  parameters: PlanParameter[];
  validation_notes: string[];
};

const metricRows: { label: string; read: (value: Measurement) => number; format?: "percent" | "signed" }[] = [
  { label: "平均亮度", read: (value) => value.luminance.mean },
  { label: "亮度标准差", read: (value) => value.luminance.standard_deviation },
  { label: "亮度 P05", read: (value) => value.luminance.p05 },
  { label: "亮度 P50", read: (value) => value.luminance.p50 },
  { label: "亮度 P95", read: (value) => value.luminance.p95 },
  { label: "RMS 对比度", read: (value) => value.contrast.rms },
  { label: "有效动态范围", read: (value) => value.contrast.effective_range },
  { label: "平均饱和度", read: (value) => value.saturation.mean },
  { label: "饱和度 P50", read: (value) => value.saturation.p50 },
  { label: "饱和度 P95", read: (value) => value.saturation.p95 },
  { label: "阴影占比", read: (value) => value.tonal_regions.shadow_fraction, format: "percent" },
  { label: "高光占比", read: (value) => value.tonal_regions.highlight_fraction, format: "percent" },
  { label: "黑场裁切", read: (value) => value.tonal_regions.black_clip_fraction, format: "percent" },
  { label: "白场裁切", read: (value) => value.tonal_regions.white_clip_fraction, format: "percent" },
  { label: "冷暖指数", read: (value) => value.color_cast.warmth, format: "signed" },
  { label: "绿—洋红指数", read: (value) => value.color_cast.green_magenta, format: "signed" },
  { label: "边缘活跃度", read: (value) => value.edge_activity, format: "percent" },
];

function formatMetric(value: number, format?: "percent" | "signed") {
  if (format === "percent") return `${(value * 100).toFixed(1)}%`;
  if (format === "signed") return `${value > 0 ? "+" : ""}${value.toFixed(3)}`;
  return value.toFixed(3);
}

function SummaryCard({ label, summary }: { label: string; summary: ImageSummary }) {
  return <article className="summary-card"><p className="step">{label}</p><h3>{summary.scene_type}</h3><dl>
    <div><dt>主体</dt><dd>{summary.subjects.join("、")}</dd></div><div><dt>光线</dt><dd>{summary.lighting}</dd></div>
    <div><dt>人物</dt><dd>{summary.has_people ? "检测到人物" : "未检测到人物"}</dd></div>
    {summary.skin_tone_notes && <div><dt>肤色提示</dt><dd>{summary.skin_tone_notes}</dd></div>}
  </dl></article>;
}

function InsightList({ title, items }: { title: string; items: string[] }) {
  return <section className="insight-list"><h3>{title}</h3><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></section>;
}

function HistogramChart({ label, histogram }: { label: string; histogram?: Histogram }) {
  if (!histogram) return <article className="histogram-card unavailable"><div><span>{label}</span><small>Schema v1</small></div><p>该历史测量没有 RGB 直方图，重新分析后可生成。</p></article>;
  const width = 520;
  const height = 150;
  const maxValue = Math.max(...histogram.channels.red, ...histogram.channels.green, ...histogram.channels.blue, 0.001);
  const points = (values: number[]) => values.map((value, index) => {
    const x = values.length === 1 ? 0 : index / (values.length - 1) * width;
    const y = height - value / maxValue * (height - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return <article className="histogram-card">
    <div><span>{label}</span><small>{histogram.bins} bins · {histogram.sample_count.toLocaleString()} samples</small></div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label} RGB 直方图`} preserveAspectRatio="none">
      <polyline className="histogram-red" points={points(histogram.channels.red)} />
      <polyline className="histogram-green" points={points(histogram.channels.green)} />
      <polyline className="histogram-blue" points={points(histogram.channels.blue)} />
    </svg>
  </article>;
}

function RawClues({ value }: { value: Record<string, unknown> | null }) {
  if (!value) return <span className="muted-value">不适用</span>;
  const entries = Object.entries(value);
  if (!entries.length) return <span className="muted-value">未提取到可靠线索</span>;
  return <span>{entries.map(([key, item]) => `${key}: ${String(item)}`).join(" · ")}</span>;
}

function MeasurementReport({ measurements }: { measurements: Measurements }) {
  return <section className="result-section" aria-labelledby="measurement-title">
    <div className="result-section-heading"><div><p className="step">DETERMINISTIC READINGS</p><h3 id="measurement-title">确定性图像读数</h3></div><span>Schema v{measurements.schemaVersion}</span></div>
    <div className="histogram-grid"><HistogramChart label="参考图 A" histogram={measurements.reference.rgb_histogram} /><HistogramChart label="目标图 B" histogram={measurements.target.rgb_histogram} /></div>
    <div className="measurement-table-wrap"><table className="measurement-table"><thead><tr><th>测量项</th><th>参考图 A</th><th>目标图 B</th></tr></thead><tbody>
      {metricRows.map((row) => <tr key={row.label}><th>{row.label}</th><td>{formatMetric(row.read(measurements.reference), row.format)}</td><td>{formatMetric(row.read(measurements.target), row.format)}</td></tr>)}
      <tr><th>源图 / 采样尺寸</th><td>{measurements.reference.source.width} × {measurements.reference.source.height} / {measurements.reference.source.sample_width} × {measurements.reference.source.sample_height}</td><td>{measurements.target.source.width} × {measurements.target.source.height} / {measurements.target.source.sample_width} × {measurements.target.source.sample_height}</td></tr>
      <tr><th>RAW 线索</th><td><RawClues value={measurements.reference.raw_clues} /></td><td><RawClues value={measurements.target.raw_clues} /></td></tr>
    </tbody></table></div>
    <div className="palette-grid">{(["reference", "target"] as const).map((role) => <article className="palette-card" key={role}><span>{role === "reference" ? "A 主色" : "B 主色"}</span><div>{measurements[role].dominant_colors.map((color) => <span className="swatch" key={color.hex} title={`${color.hex} ${(color.fraction * 100).toFixed(1)}%`} style={{ backgroundColor: color.hex }} />)}</div></article>)}</div>
  </section>;
}

const comparisonLabels: Record<string, string> = {
  median_luminance: "中位亮度", effective_range: "有效动态范围", rms_contrast: "RMS 对比度",
  mean_saturation: "平均饱和度", warmth: "冷暖", green_magenta: "绿—洋红",
  shadow_fraction: "阴影占比", highlight_fraction: "高光占比", black_clip_fraction: "黑场裁切",
  white_clip_fraction: "白场裁切", hue_distribution_distance: "色相分布差异",
};

function ComparisonReport({ comparison }: { comparison: Record<string, Difference> }) {
  const direction = { increase: "提高", decrease: "降低", similar: "接近" } as const;
  return <section className="result-section" aria-labelledby="comparison-title"><div className="result-section-heading"><div><p className="step">REFERENCE → TARGET</p><h3 id="comparison-title">A/B 差异方向</h3></div></div>
    <div className="comparison-grid">{Object.entries(comparison).map(([key, value]) => <article key={key}><span>{comparisonLabels[key] ?? key}</span><strong className={value.direction}>{direction[value.direction]}</strong><small>{value.delta > 0 ? "+" : ""}{value.delta.toFixed(3)}</small></article>)}</div>
  </section>;
}

const groupLabels = { basic: "基础校正", style: "风格塑造", fine_tune: "可选微调" };
function PlanReport({ plan }: { plan: LightroomPlan }) {
  return <section className="result-section" aria-labelledby="plan-title"><div className="result-section-heading"><div><p className="step">SAFE LIGHTROOM PLAN</p><h3 id="plan-title">Lightroom 参数计划</h3></div><span>{plan.parameters.length} 项调整</span></div>
    {(["basic", "style", "fine_tune"] as const).map((group) => {
      const parameters = plan.parameters.filter((parameter) => parameter.group === group);
      if (!parameters.length) return null;
      return <div className="plan-group" key={group}><h4>{groupLabels[group]}</h4><div className="parameter-grid">{parameters.map((parameter) => <article className="parameter-card" key={parameter.key}>
        <div><span><small className="parameter-panel">{parameter.panel}</small>{parameter.label}</span><strong>{parameter.value > 0 ? "+" : ""}{parameter.value}{parameter.unit}</strong></div>
        <p className="safe-range">安全范围 {parameter.safe_min} 至 {parameter.safe_max}{parameter.unit}</p>
        <dl><div><dt>原因</dt><dd>{parameter.reason}</dd></div><div><dt>预期效果</dt><dd>{parameter.expected_effect}</dd></div><div><dt>风险</dt><dd>{parameter.risk}</dd></div><div><dt>停止条件</dt><dd>{parameter.stop_condition}</dd></div></dl>
      </article>)}</div></div>;
    })}
    {!!plan.validation_notes.length && <div className="validation-notes"><strong>本地校验记录</strong><ul>{plan.validation_notes.map((note) => <li key={note}>{note}</li>)}</ul></div>}
  </section>;
}

export function AnalysisResults({ taskId, vision, measurements, plan }: { taskId: string; vision: VisionResult; measurements: Measurements; plan?: LightroomPlan | null }) {
  const feasibility = plan?.feasibility;
  return <section className="analysis-results" aria-labelledby="results-title">
    <header className="result-hero"><div><p className="step">步骤 3 / 3</p><h2 id="results-title">{plan?.style_name ?? "图片分析结果"}</h2><p>{plan?.summary ?? "确定性读数与图片内容理解已经完成；安全 Lightroom 参数计划仍在生成中。"}</p></div>
      {feasibility && <div className={`feasibility ${feasibility.level}`}><span>匹配可行性</span><strong>{feasibility.score}</strong><small>/ 100 · {feasibility.level === "high" ? "高" : feasibility.level === "medium" ? "中" : "低"}</small></div>}
    </header>
    <div className="result-previews"><figure><img src={`/api/tasks/${taskId}/assets/reference/preview`} alt="参考图 A 分析预览" /><figcaption>参考图 A · 风格来源</figcaption></figure><figure><img src={`/api/tasks/${taskId}/assets/target/preview`} alt="目标图 B 分析预览" /><figcaption>目标图 B · 调整对象</figcaption></figure></div>
    <MeasurementReport measurements={measurements} />
    <ComparisonReport comparison={measurements.comparison} />
    {plan ? <PlanReport plan={plan} /> : <section className="plan-pending"><strong>参数计划尚未完成</strong><p>测量和内容理解结果已保留。系统完成规划与本地校验后会在此展示 8–12 项安全调整。</p></section>}
    <section className="result-section" aria-labelledby="semantic-title"><div className="result-section-heading"><div><p className="step">SEMANTIC CONTEXT</p><h3 id="semantic-title">迁移边界与内容风险</h3></div></div>
      <div className="summary-grid"><SummaryCard label="参考图 A" summary={vision.reference} /><SummaryCard label="目标图 B" summary={vision.target} /></div>
      <div className="insight-grid"><InsightList title="可迁移特征" items={vision.transferable_features} /><InsightList title="不可直接迁移" items={vision.non_transferable_features} /><InsightList title="匹配限制" items={vision.matching_limits} /><InsightList title="规划风险" items={vision.planning_risks} /></div>
    </section>
    {feasibility && <section className="risk-summary"><strong>可行性判断依据</strong><ul>{feasibility.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></section>}
  </section>;
}
