import { createHash } from "node:crypto";

type PlanParameter = { key: string; value: number };
type SafePlan = {
  schema_version: number;
  validator_version: string;
  style_name: string;
  parameters: PlanParameter[];
};

type Mapping = { key: string; attribute: string };

const MAPPINGS: Mapping[] = [
  { key: "exposure", attribute: "Exposure2012" },
  { key: "contrast", attribute: "Contrast2012" },
  { key: "highlights", attribute: "Highlights2012" },
  { key: "shadows", attribute: "Shadows2012" },
  { key: "whites", attribute: "Whites2012" },
  { key: "blacks", attribute: "Blacks2012" },
  { key: "texture", attribute: "Texture" },
  { key: "clarity", attribute: "Clarity2012" },
  { key: "dehaze", attribute: "Dehaze" },
  { key: "vibrance", attribute: "Vibrance" },
  { key: "saturation", attribute: "Saturation" },
  { key: "hsl_red_saturation", attribute: "SaturationAdjustmentRed" },
  { key: "hsl_orange_saturation", attribute: "SaturationAdjustmentOrange" },
  { key: "hsl_blue_saturation", attribute: "SaturationAdjustmentBlue" },
  { key: "hsl_orange_luminance", attribute: "LuminanceAdjustmentOrange" },
  { key: "hsl_blue_luminance", attribute: "LuminanceAdjustmentBlue" },
  { key: "vignette", attribute: "PostCropVignetteAmount" },
];

const EXCLUDED_KEYS = new Set(["temperature", "tint", "color_grading_balance"]);
const ALLOWED_KEYS = new Set([...MAPPINGS.map(({ key }) => key), ...EXCLUDED_KEYS]);

export class XmpExportError extends Error {}

function escapeXml(value: string): string {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    const valid = codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d
      || (codePoint >= 0x20 && codePoint <= 0xd7ff)
      || (codePoint >= 0xe000 && codePoint <= 0xfffd)
      || (codePoint >= 0x10000 && codePoint <= 0x10ffff);
    if (!valid) throw new XmpExportError("安全参数计划包含无法写入 XMP 的字符。");
  }
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function validatePlan(value: unknown): SafePlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new XmpExportError("安全参数计划格式无效。");
  const plan = value as Record<string, unknown>;
  if (plan.schema_version !== 1 || typeof plan.validator_version !== "string" || !plan.validator_version) {
    throw new XmpExportError("安全参数计划版本不受支持。");
  }
  if (typeof plan.style_name !== "string" || !plan.style_name.trim() || plan.style_name.length > 500) {
    throw new XmpExportError("安全参数计划缺少有效名称。");
  }
  if (!Array.isArray(plan.parameters) || plan.parameters.length < 8 || plan.parameters.length > 12) {
    throw new XmpExportError("安全参数计划的参数数量无效。");
  }
  const seen = new Set<string>();
  const parameters = plan.parameters.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new XmpExportError("安全参数计划包含无效参数。");
    const parameter = value as Record<string, unknown>;
    if (typeof parameter.key !== "string" || !ALLOWED_KEYS.has(parameter.key)) {
      throw new XmpExportError("安全参数计划包含不支持的参数。");
    }
    if (seen.has(parameter.key)) throw new XmpExportError("安全参数计划包含重复参数。");
    seen.add(parameter.key);
    if (typeof parameter.value !== "number" || !Number.isFinite(parameter.value)) {
      throw new XmpExportError("安全参数计划包含无效数值。");
    }
    return { key: parameter.key, value: Object.is(parameter.value, -0) ? 0 : parameter.value };
  });
  return {
    schema_version: 1,
    validator_version: plan.validator_version,
    style_name: plan.style_name.trim(),
    parameters,
  };
}

export type GeneratedXmp = { xml: string; presetName: string };

export function isTaskId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function generateLightroomPreset(input: { taskId: string; plan: unknown }): GeneratedXmp {
  if (!isTaskId(input.taskId)) throw new XmpExportError("任务标识无效。");
  const plan = validatePlan(input.plan);
  const values = new Map(plan.parameters.map((parameter) => [parameter.key, parameter.value]));
  const attributes: [string, string][] = [];

  for (const mapping of MAPPINGS) {
    const value = values.get(mapping.key);
    if (value === undefined) continue;
    attributes.push([mapping.attribute, String(value)]);
  }
  if (!attributes.length) throw new XmpExportError("安全参数计划没有可导出的全局参数。");

  const identity = JSON.stringify({ taskId: input.taskId, styleName: plan.style_name, attributes });
  const uuid = createHash("sha256").update(identity).digest("hex").slice(0, 32).toUpperCase();
  const parameterAttributes = attributes.map(([name, value]) => `    crs:${name}="${escapeXml(value)}"`).join("\n");

  const xml = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
   <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
    crs:PresetType="Normal"
    crs:Cluster="RefTone"
    crs:UUID="${uuid}"
    crs:SupportsAmount="False"
    crs:SupportsColor="True"
    crs:SupportsMonochrome="True"
    crs:SupportsHighDynamicRange="True"
    crs:SupportsNormalDynamicRange="True"
    crs:SupportsSceneReferred="True"
    crs:SupportsOutputReferred="True"
    crs:CameraModelRestriction=""
    crs:Copyright=""
    crs:ContactInfo=""
    crs:Version="17.0"
    crs:ProcessVersion="11.0"
${parameterAttributes}
    crs:HasSettings="True">
    <crs:Name>
     <rdf:Alt>
      <rdf:li xml:lang="x-default">${escapeXml(plan.style_name)}</rdf:li>
     </rdf:Alt>
    </crs:Name>
    <crs:Group>
     <rdf:Alt>
      <rdf:li xml:lang="x-default">RefTone</rdf:li>
     </rdf:Alt>
    </crs:Group>
    <crs:Description>
     <rdf:Alt>
      <rdf:li xml:lang="x-default">RefTone 起始配方；应用后仍需按照片小范围微调。</rdf:li>
     </rdf:Alt>
    </crs:Description>
   </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>
`;
  return { xml, presetName: plan.style_name };
}

export function xmpFilename(styleName: string): string {
  const cleaned = styleName
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/^\.+|\.+$/g, "");
  const limited = [...cleaned].slice(0, 80).join("");
  return `RefTone-${limited || "preset"}.xmp`;
}

export function xmpContentDisposition(filename: string): string {
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="RefTone-preset.xmp"; filename*=UTF-8''${encoded}`;
}
