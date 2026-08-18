import assert from "node:assert/strict";
import test from "node:test";
import { comparisonEntries } from "../lib/analysis-results.ts";

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
