export type Difference = { delta: number; direction: "increase" | "decrease" | "similar" };
export type Comparison = Record<string, Difference | number> & { schema_version?: number };

export const resultSections = [
  { id: "result-comparison", label: "A/B 差异方向" },
  { id: "result-plan", label: "Lightroom 参数计划" },
  { id: "result-semantic", label: "迁移边界与内容风险" },
  { id: "result-measurements", label: "确定性图像读数" },
] as const;

export function feasibilityPresentation(score: number): { level: "low" | "medium" | "high"; label: string } {
  if (score < 35) return { level: "low", label: "偏低" };
  if (score < 70) return { level: "medium", label: "中等" };
  return { level: "high", label: "较高" };
}

function isDifference(value: Difference | number): value is Difference {
  return typeof value === "object"
    && value !== null
    && typeof value.delta === "number"
    && ["increase", "decrease", "similar"].includes(value.direction);
}

export function comparisonEntries(comparison: Comparison): [string, Difference][] {
  return Object.entries(comparison).filter((entry): entry is [string, Difference] => isDifference(entry[1]));
}
