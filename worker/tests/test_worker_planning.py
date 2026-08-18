import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock

from PIL import Image

from app.main import Worker
from app.measurements import compare_measurements, measure_image


VISION = {
    "reference": {"scene_type": "人像", "subjects": ["人物"], "has_people": True, "skin_tone_notes": "偏暖", "lighting": "侧光"},
    "target": {"scene_type": "人像", "subjects": ["人物"], "has_people": True, "skin_tone_notes": "中性", "lighting": "正面光"},
    "transferable_features": ["暖色"], "non_transferable_features": ["光向"],
    "matching_limits": ["背景不同"], "planning_risks": ["保护肤色"],
}


def valid_draft() -> dict:
    return {
        "style_name": "柔和暖调",
        "summary": "降低反差并保护肤色。",
        "parameters": [
            {
                "key": key, "value": 0.2 if key == "exposure" else 5,
                "reason": "匹配确定性读数。", "expected_effect": "接近参考风格。",
                "risk": "避免失去层次。", "stop_condition": "出现裁切时停止。",
            }
            for key in ("exposure", "contrast", "highlights", "shadows", "whites", "blacks", "temperature", "vibrance")
        ],
    }


class WorkerPlanningTest(unittest.TestCase):
    def setUp(self) -> None:
        self.reference = measure_image(Image.new("RGB", (4, 4), (180, 120, 80)), "standard")
        self.target = measure_image(Image.new("RGB", (4, 4), (80, 80, 80)), "standard")
        self.comparison = compare_measurements(self.reference, self.target)
        self.worker = Worker.__new__(Worker)
        self.worker.settings = SimpleNamespace(dashscope_model="qwen-test")
        self.worker.planning = MagicMock()
        self.worker.repository = MagicMock()
        self.worker.repository.begin_validation.return_value = True
        self.worker.repository.complete_plan.return_value = True

    def test_planning_draft_is_validated_before_it_is_persisted(self) -> None:
        self.worker.planning.plan.return_value = (valid_draft(), "plan-response")

        self.worker._run_planning("task-1", self.reference, self.target, self.comparison, VISION, False)

        self.worker.repository.begin_validation.assert_called_once_with("task-1")
        self.worker.repository.complete_plan.assert_called_once()
        safe_plan = self.worker.repository.complete_plan.call_args.args[-1]
        self.assertEqual(len(safe_plan["parameters"]), 8)
        self.assertEqual(safe_plan["parameters"][0]["panel"], "光线")
        self.worker.repository.fail_plan.assert_not_called()

    def test_invalid_draft_stops_at_validation_and_preserves_prior_results(self) -> None:
        invalid = valid_draft()
        invalid["parameters"][0]["key"] = "unknown_control"
        self.worker.planning.plan.return_value = (invalid, "plan-response")

        self.worker._run_planning("task-1", self.reference, self.target, self.comparison, VISION, False)

        self.worker.repository.fail_plan.assert_called_once_with("task-1", "plan_validation_failed")
        self.worker.repository.complete_plan.assert_not_called()


if __name__ == "__main__":
    unittest.main()
