import assert from "node:assert/strict";
import test from "node:test";
import { comparisonEntries, feasibilityPresentation, resultSections } from "../lib/analysis-results.ts";

test("comparison metadata is not rendered as a Lightroom adjustment", () => {
  const comparison = {
    schema_version: 2,
    median_luminance: { delta: -0.153488, direction: "decrease" },
    mean_saturation: { delta: -0.487664, direction: "decrease" },
  };

  assert.deepEqual(comparisonEntries(comparison), [
    ["median_luminance", { delta: -0.153488, direction: "decrease" }],
    ["mean_saturation", { delta: -0.487664, direction: "decrease" }],
  ]);
});

test("result navigation follows the approved reading order", () => {
  assert.deepEqual(resultSections, [
    { id: "result-comparison", label: "A/B 差异方向" },
    { id: "result-plan", label: "Lightroom 参数计划" },
    { id: "result-semantic", label: "迁移边界与内容风险" },
    { id: "result-measurements", label: "确定性图像读数" },
  ]);
});

test("feasibility presentation uses the prototype's three score bands", () => {
  assert.deepEqual(feasibilityPresentation(11), { level: "low", label: "偏低" });
  assert.deepEqual(feasibilityPresentation(35), { level: "medium", label: "中等" });
  assert.deepEqual(feasibilityPresentation(70), { level: "high", label: "较高" });
});
