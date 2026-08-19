import assert from "node:assert/strict";
import test from "node:test";
import { generateLightroomPreset, xmpContentDisposition, xmpFilename, XmpExportError } from "../lib/xmp.ts";

const taskId = "123e4567-e89b-12d3-a456-426614174000";

function plan(parameters, styleName = "暖调 & 柔和 <测试>") {
  return {
    schema_version: 1,
    validator_version: "1.1",
    style_name: styleName,
    parameters: parameters.map(([key, value]) => ({ key, value })),
  };
}

test("generates deterministic Lightroom XMP with fixed mapping order and escaped metadata", () => {
  const safePlan = plan([
    ["tint", 4],
    ["temperature", 12],
    ["blacks", -8],
    ["whites", 6],
    ["shadows", 15],
    ["highlights", -20],
    ["contrast", 7],
    ["exposure", -0.35],
  ]);
  const first = generateLightroomPreset({ taskId, plan: safePlan });
  const second = generateLightroomPreset({ taskId, plan: safePlan });

  assert.equal(first.xml, second.xml);
  assert.match(first.xml, /crs:UUID="[A-F0-9]{32}"/);
  assert.doesNotMatch(first.xml, /WhiteBalance|IncrementalTemperature|IncrementalTint/);
  assert.match(first.xml, /暖调 &amp; 柔和 &lt;测试&gt;/);
  for (const [attribute, value] of [
    ["Exposure2012", "-0.35"], ["Contrast2012", "7"], ["Highlights2012", "-20"],
    ["Shadows2012", "15"], ["Whites2012", "6"], ["Blacks2012", "-8"],
  ]) assert.match(first.xml, new RegExp(`crs:${attribute}="${value}"`));
  const positions = ["Exposure2012", "Contrast2012", "Highlights2012", "Shadows2012", "Whites2012", "Blacks2012"]
    .map((attribute) => first.xml.indexOf(`crs:${attribute}`));
  assert.deepEqual([...positions].sort((left, right) => left - right), positions);
});

test("maps supported style controls and omits isolated color grading balance", () => {
  const result = generateLightroomPreset({
    taskId,
    plan: plan([
      ["texture", 8],
      ["clarity", 6],
      ["dehaze", -3],
      ["vibrance", 12],
      ["saturation", -4],
      ["hsl_red_saturation", -5],
      ["hsl_orange_saturation", 7],
      ["hsl_blue_saturation", -9],
      ["hsl_orange_luminance", 5],
      ["hsl_blue_luminance", -6],
      ["color_grading_balance", 10],
      ["vignette", -7],
    ]),
  });

  for (const [attribute, value] of [
    ["Texture", "8"], ["Clarity2012", "6"], ["Dehaze", "-3"], ["Vibrance", "12"],
    ["Saturation", "-4"], ["SaturationAdjustmentRed", "-5"], ["SaturationAdjustmentOrange", "7"],
    ["SaturationAdjustmentBlue", "-9"], ["LuminanceAdjustmentOrange", "5"],
    ["LuminanceAdjustmentBlue", "-6"], ["PostCropVignetteAmount", "-7"],
  ]) assert.match(result.xml, new RegExp(`crs:${attribute}="${value}"`));
  assert.doesNotMatch(result.xml, /SplitToningBalance|ColorGrade/);
});

for (const [scenario, temperature, tint] of [["RAW Kelvin", 650, 5], ["rendered-image offset", 18, 10]]) {
  test(`omits ${scenario} white balance values that Lightroom can clamp to extremes`, () => {
    const result = generateLightroomPreset({
      taskId,
      plan: plan([
        ["exposure", -0.55], ["contrast", -20], ["highlights", -45], ["shadows", 35],
        ["temperature", temperature], ["tint", tint], ["dehaze", -5], ["saturation", -10],
      ]),
    });
    assert.doesNotMatch(result.xml, /WhiteBalance|IncrementalTemperature|IncrementalTint/);
  });
}

test("rejects unknown parameters instead of serializing unvalidated fields", () => {
  const invalid = plan([
    ["exposure", 0], ["contrast", 0], ["highlights", 0], ["shadows", 0],
    ["whites", 0], ["blacks", 0], ["vibrance", 0], ["made_up_control", 1],
  ]);
  assert.throws(
    () => generateLightroomPreset({ taskId, plan: invalid }),
    (error) => error instanceof XmpExportError && error.message === "安全参数计划包含不支持的参数。",
  );
});

test("rejects characters that are invalid in XML", () => {
  const invalid = plan([
    ["exposure", 0], ["contrast", 0], ["highlights", 0], ["shadows", 0],
    ["whites", 0], ["blacks", 0], ["vibrance", 0], ["saturation", 0],
  ], "无效\u0001名称");
  assert.throws(
    () => generateLightroomPreset({ taskId, plan: invalid }),
    (error) => error instanceof XmpExportError && error.message === "安全参数计划包含无法写入 XMP 的字符。",
  );
});

test("creates a safe unicode filename", () => {
  assert.equal(xmpFilename(' 暖调 / 人像: "A" '), "RefTone-暖调-人像-A.xmp");
  assert.equal(xmpFilename("..."), "RefTone-preset.xmp");
  assert.equal(
    xmpContentDisposition("RefTone-暖调-人像.xmp"),
    "attachment; filename=\"RefTone-preset.xmp\"; filename*=UTF-8''RefTone-%E6%9A%96%E8%B0%83-%E4%BA%BA%E5%83%8F.xmp",
  );
});
