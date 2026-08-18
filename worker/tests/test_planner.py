import unittest

from PIL import Image

from app.measurements import compare_measurements, measure_image
from app.planner import planning_context, validate_plan


VISION = {
    "reference": {"scene_type": "室外人像", "subjects": ["人物"], "has_people": True, "skin_tone_notes": "暖色肤色", "lighting": "侧光"},
    "target": {"scene_type": "室内人像", "subjects": ["人物"], "has_people": True, "skin_tone_notes": "中性肤色", "lighting": "正面光"},
    "transferable_features": ["偏暖低饱和"],
    "non_transferable_features": ["光线方向"],
    "matching_limits": ["背景不同"],
    "planning_risks": ["保护肤色"],
}


def draft(value_overrides: dict[str, float] | None = None) -> dict:
    overrides = value_overrides or {}
    keys = ["exposure", "contrast", "highlights", "shadows", "whites", "blacks", "temperature", "vibrance"]
    return {
        "style_name": "柔和暖调",
        "summary": "降低反差并保持肤色。",
        "parameters": [
            {
                "key": key,
                "value": overrides.get(key, 5 if key != "exposure" else 0.2),
                "reason": "缩小与参考图的差异。",
                "expected_effect": "画面更接近参考风格。",
                "risk": "避免局部失去层次。",
                "stop_condition": "出现裁切或肤色不自然时停止。",
            }
            for key in keys
        ],
    }


class PlannerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.reference = measure_image(Image.new("RGB", (4, 4), (180, 120, 80)), "standard")
        self.target = measure_image(Image.new("RGB", (4, 4), (60, 60, 60)), "standard")
        self.comparison = compare_measurements(self.reference, self.target)

    def test_context_contains_only_sanitized_measurements_and_allowlist(self) -> None:
        context = planning_context(self.reference, self.target, self.comparison, VISION, False)

        self.assertNotIn("source", context["reference"])
        self.assertNotIn("rgb_histogram", context["reference"])
        self.assertNotIn("raw_clues", context["target"])
        self.assertIn("allowed_parameters", context)
        self.assertEqual(context["target_format"], "jpeg_or_standard")
        self.assertEqual(context["objective"], {
            "reference_role": "reference_A_read_only",
            "editable_role": "target_B_only",
            "comparison_delta": "reference_A_minus_target_B",
            "direction_meaning": "adjust_target_B_toward_reference_A",
        })

    def test_context_keeps_only_non_identifying_raw_dynamic_range_clues(self) -> None:
        raw_target = dict(self.target)
        raw_target["raw_clues"] = {"bit_depth": 14, "black_level_min": 512, "black_level_max": 520, "white_level": 16383}
        raw_target["source"] = {**raw_target["source"], "kind": "raw"}

        context = planning_context(self.reference, raw_target, self.comparison, VISION, True)

        self.assertEqual(context["target"]["raw_dynamic_range_clues"]["bit_depth"], 14)
        self.assertNotIn("source", context["target"])
        self.assertEqual(context["target_format"], "raw")

    def test_validates_and_orders_eight_safe_parameters(self) -> None:
        result = validate_plan(draft(), self.target, VISION, self.comparison, False)

        self.assertEqual(len(result["parameters"]), 8)
        self.assertEqual(result["parameters"][0]["key"], "exposure")
        self.assertEqual(result["parameters"][0]["panel"], "光线")
        self.assertEqual(result["parameters"][-1]["key"], "vibrance")
        self.assertIn(result["feasibility"]["level"], ("low", "medium", "high"))

    def test_jpeg_and_people_tighten_temperature_and_clip_risks(self) -> None:
        clipped_target = measure_image(Image.new("RGB", (4, 4), (255, 255, 255)), "standard")
        comparison = compare_measurements(self.reference, clipped_target)
        result = validate_plan(draft({"exposure": -0.2, "highlights": 10, "whites": 10, "temperature": 15}), clipped_target, VISION, comparison, False)
        by_key = {item["key"]: item for item in result["parameters"]}

        self.assertEqual(by_key["highlights"]["value"], 0)
        self.assertEqual(by_key["whites"]["value"], 0)
        self.assertLessEqual(by_key["temperature"]["safe_max"], 12)
        self.assertGreaterEqual(len(result["validation_notes"]), 2)

    def test_rejects_unknown_or_far_outside_parameter(self) -> None:
        unknown = draft()
        unknown["parameters"][0]["key"] = "made_up_control"
        with self.assertRaisesRegex(ValueError, "unknown"):
            validate_plan(unknown, self.target, VISION, self.comparison, False)

        with self.assertRaisesRegex(ValueError, "unsafe"):
            validate_plan(draft({"exposure": 5}), self.target, VISION, self.comparison, False)

    def test_rejects_fewer_than_eight_parameters(self) -> None:
        too_short = draft()
        too_short["parameters"] = too_short["parameters"][:7]
        with self.assertRaisesRegex(ValueError, "8 to 12"):
            validate_plan(too_short, self.target, VISION, self.comparison, False)

    def test_rejects_exposure_that_moves_target_away_from_reference(self) -> None:
        dark_reference = measure_image(Image.new("RGB", (4, 4), (80, 80, 80)), "standard")
        bright_target = measure_image(Image.new("RGB", (4, 4), (160, 160, 160)), "standard")
        target_must_darken = compare_measurements(dark_reference, bright_target)

        with self.assertRaisesRegex(ValueError, "exposure direction"):
            validate_plan(draft({"exposure": 0.3}), bright_target, VISION, target_must_darken, False)
        safe = validate_plan(draft({"exposure": -0.3}), bright_target, VISION, target_must_darken, False)
        self.assertEqual(safe["parameters"][0]["value"], -0.3)

        with self.assertRaisesRegex(ValueError, "exposure direction"):
            validate_plan(draft({"exposure": -0.3}), self.target, VISION, self.comparison, False)
        safe = validate_plan(draft({"exposure": 0.3}), self.target, VISION, self.comparison, False)
        self.assertEqual(safe["parameters"][0]["value"], 0.3)


if __name__ == "__main__":
    unittest.main()
