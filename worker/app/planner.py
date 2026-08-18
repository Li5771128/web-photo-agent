from __future__ import annotations

from dataclasses import dataclass
from typing import Any

PLAN_SCHEMA_VERSION = 1
VALIDATOR_VERSION = "1.0"


@dataclass(frozen=True)
class ParameterRule:
    label: str
    group: str
    unit: str
    raw_range: tuple[float, float]
    jpeg_range: tuple[float, float]


PARAMETER_RULES = {
    "exposure": ParameterRule("曝光", "basic", " EV", (-1.5, 1.5), (-0.75, 0.75)),
    "contrast": ParameterRule("对比度", "basic", "", (-40, 40), (-30, 30)),
    "highlights": ParameterRule("高光", "basic", "", (-70, 50), (-50, 35)),
    "shadows": ParameterRule("阴影", "basic", "", (-60, 70), (-45, 50)),
    "whites": ParameterRule("白色色阶", "basic", "", (-45, 45), (-30, 30)),
    "blacks": ParameterRule("黑色色阶", "basic", "", (-45, 45), (-30, 30)),
    "temperature": ParameterRule("色温偏移", "basic", "", (-1500, 1500), (-18, 18)),
    "tint": ParameterRule("色调", "basic", "", (-30, 30), (-18, 18)),
    "texture": ParameterRule("纹理", "style", "", (-30, 30), (-20, 20)),
    "clarity": ParameterRule("清晰度", "style", "", (-30, 30), (-20, 20)),
    "dehaze": ParameterRule("去朦胧", "style", "", (-20, 25), (-12, 18)),
    "vibrance": ParameterRule("自然饱和度", "style", "", (-35, 35), (-25, 25)),
    "saturation": ParameterRule("饱和度", "style", "", (-20, 20), (-12, 12)),
    "hsl_red_saturation": ParameterRule("红色饱和度", "style", "", (-25, 25), (-18, 18)),
    "hsl_orange_saturation": ParameterRule("橙色饱和度", "style", "", (-25, 25), (-18, 18)),
    "hsl_blue_saturation": ParameterRule("蓝色饱和度", "style", "", (-30, 30), (-20, 20)),
    "hsl_orange_luminance": ParameterRule("橙色明亮度", "style", "", (-25, 25), (-18, 18)),
    "hsl_blue_luminance": ParameterRule("蓝色明亮度", "style", "", (-30, 30), (-20, 20)),
    "color_grading_balance": ParameterRule("颜色分级平衡", "fine_tune", "", (-25, 25), (-15, 15)),
    "vignette": ParameterRule("暗角", "fine_tune", "", (-25, 10), (-18, 8)),
}

GROUP_ORDER = {"basic": 0, "style": 1, "fine_tune": 2}
PANEL_BY_KEY = {
    "temperature": "颜色", "tint": "颜色",
    "texture": "效果", "clarity": "效果", "dehaze": "效果", "vignette": "效果",
    "hsl_red_saturation": "颜色混合", "hsl_orange_saturation": "颜色混合",
    "hsl_blue_saturation": "颜色混合", "hsl_orange_luminance": "颜色混合",
    "hsl_blue_luminance": "颜色混合", "color_grading_balance": "颜色分级",
}


def planning_context(
    reference: dict[str, Any],
    target: dict[str, Any],
    comparison: dict[str, Any],
    vision: dict[str, Any],
    target_is_raw: bool,
) -> dict[str, Any]:
    def sanitized_measurement(value: dict[str, Any]) -> dict[str, Any]:
        sanitized = {
            "luminance": value["luminance"],
            "tonal_regions": value["tonal_regions"],
            "contrast": value["contrast"],
            "saturation": value["saturation"],
            "color_cast": value["color_cast"],
            "hue_histogram": value["hue_histogram"],
            "edge_activity": value["edge_activity"],
            "source_kind": value["source"]["kind"],
        }
        if value.get("raw_clues"):
            sanitized["raw_dynamic_range_clues"] = value["raw_clues"]
        return sanitized

    return {
        "measurement_schema_version": reference["schema_version"],
        "reference": sanitized_measurement(reference),
        "target": sanitized_measurement(target),
        "comparison": comparison,
        "vision": vision,
        "target_format": "raw" if target_is_raw else "jpeg_or_standard",
        "allowed_parameters": [
            {
                "key": key,
                "unit": (" K" if key == "temperature" and target_is_raw else rule.unit.strip()),
                "safe_range": list(rule.raw_range if target_is_raw else rule.jpeg_range),
            }
            for key, rule in PARAMETER_RULES.items()
        ],
    }


def _required_text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 500:
        raise ValueError(f"invalid plan {field}")
    return value.strip()


def _risk_adjusted_range(key: str, rule: ParameterRule, target: dict[str, Any], vision: dict[str, Any], is_raw: bool) -> tuple[float, float]:
    lower, upper = rule.raw_range if is_raw else rule.jpeg_range
    tonal = target["tonal_regions"]
    if tonal["white_clip_fraction"] > 0.01 or tonal["highlight_fraction"] > 0.2:
        if key == "exposure": upper = min(upper, 0.5 if is_raw else 0.3)
        if key in ("highlights", "whites"): upper = min(upper, 0)
    if tonal["black_clip_fraction"] > 0.01 or tonal["shadow_fraction"] > 0.55:
        if key in ("shadows", "blacks"): lower = max(lower, 0)
    if vision["target"]["has_people"]:
        if key in ("temperature", "tint"):
            factor = 0.65
            lower, upper = lower * factor, upper * factor
        if key in ("hsl_red_saturation", "hsl_orange_saturation", "hsl_orange_luminance"):
            lower, upper = max(lower, -15), min(upper, 15)
    return round(lower, 2), round(upper, 2)


def feasibility(comparison: dict[str, Any], vision: dict[str, Any]) -> dict[str, Any]:
    scales = {
        "median_luminance": 0.6, "effective_range": 0.6, "rms_contrast": 0.35,
        "mean_saturation": 0.7, "warmth": 0.6, "green_magenta": 0.5,
        "hue_distribution_distance": 1.0,
    }
    distance = sum(min(abs(float(comparison[key]["delta"])) / scale, 1.0) for key, scale in scales.items()) / len(scales)
    score = 100 - round(distance * 50)
    reasons = ["基础分来自 A/B 的确定性亮度、对比度、色彩与色相差异。"]
    if vision["reference"]["scene_type"] != vision["target"]["scene_type"]:
        score -= 10
        reasons.append("两张图片的场景类型不同，风格迁移存在内容边界。")
    if vision["reference"]["has_people"] != vision["target"]["has_people"]:
        score -= 10
        reasons.append("人物条件不同，肤色相关调整不能直接照搬。")
    if vision["reference"]["lighting"] != vision["target"]["lighting"]:
        score -= 5
        reasons.append("光线条件不同，调色无法改变真实光向与光质。")
    score = max(0, min(100, score))
    level = "high" if score >= 75 else "medium" if score >= 50 else "low"
    return {"score": score, "level": level, "reasons": reasons}


def validate_plan(draft: dict[str, Any], target: dict[str, Any], vision: dict[str, Any], comparison: dict[str, Any], target_is_raw: bool) -> dict[str, Any]:
    style_name = _required_text(draft.get("style_name"), "style_name")
    summary = _required_text(draft.get("summary"), "summary")
    raw_parameters = draft.get("parameters")
    if not isinstance(raw_parameters, list) or not 8 <= len(raw_parameters) <= 12:
        raise ValueError("plan must contain 8 to 12 parameters")

    validated: list[dict[str, Any]] = []
    notes: list[str] = []
    seen: set[str] = set()
    for item in raw_parameters:
        if not isinstance(item, dict) or not isinstance(item.get("key"), str):
            raise ValueError("invalid plan parameter")
        key = item["key"]
        rule = PARAMETER_RULES.get(key)
        if rule is None:
            raise ValueError(f"unknown plan parameter: {key}")
        if key in seen:
            raise ValueError(f"duplicate plan parameter: {key}")
        seen.add(key)
        value = item.get("value")
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            raise ValueError(f"invalid plan value: {key}")
        numeric = float(value)
        base_lower, base_upper = rule.raw_range if target_is_raw else rule.jpeg_range
        base_span = base_upper - base_lower
        if numeric < base_lower - base_span * 0.25 or numeric > base_upper + base_span * 0.25:
            raise ValueError(f"unsafe plan value: {key}")
        lower, upper = _risk_adjusted_range(key, rule, target, vision, target_is_raw)
        clamped = max(lower, min(upper, numeric))
        if clamped != numeric:
            notes.append(f"{rule.label}由 {numeric:g} 收紧为 {clamped:g}。")
        validated.append({
            "key": key,
            "label": rule.label,
            "panel": PANEL_BY_KEY.get(key, "光线" if rule.group == "basic" else "颜色"),
            "group": rule.group,
            "value": round(clamped, 2),
            "safe_min": lower,
            "safe_max": upper,
            "unit": " K" if key == "temperature" and target_is_raw else rule.unit,
            "reason": _required_text(item.get("reason"), f"{key}.reason"),
            "expected_effect": _required_text(item.get("expected_effect"), f"{key}.expected_effect"),
            "risk": _required_text(item.get("risk"), f"{key}.risk"),
            "stop_condition": _required_text(item.get("stop_condition"), f"{key}.stop_condition"),
        })
    validated.sort(key=lambda item: (GROUP_ORDER[item["group"]], list(PARAMETER_RULES).index(item["key"])))
    return {
        "schema_version": PLAN_SCHEMA_VERSION,
        "validator_version": VALIDATOR_VERSION,
        "style_name": style_name,
        "summary": summary,
        "feasibility": feasibility(comparison, vision),
        "parameters": validated,
        "validation_notes": notes,
    }
