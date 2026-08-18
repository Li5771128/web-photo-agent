import unittest
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock

from PIL import Image

from app.main import Worker, WorkerJob
from app.repository import TaskAssets


def png_bytes(color: tuple[int, int, int]) -> bytes:
    output = BytesIO()
    Image.new("RGB", (4, 4), color).save(output, format="PNG")
    return output.getvalue()


class WorkerMeasurementTest(unittest.TestCase):
    def test_measurements_are_saved_before_missing_qwen_key_stops_recognition(self) -> None:
        worker = Worker.__new__(Worker)
        worker.repository = MagicMock()
        worker.repository.claim.return_value = TaskAssets("task-1", "reference.png", "target.png", False, False)
        worker.repository.save_measurements.return_value = True
        worker.storage = MagicMock()
        worker.storage.read.side_effect = [png_bytes((220, 120, 60)), png_bytes((60, 60, 60))]
        worker.settings = SimpleNamespace(
            dashscope_api_key="",
            vision_max_edge=1024,
            vision_jpeg_quality=80,
        )

        worker.process_analysis(WorkerJob(kind="analyze", task_id="task-1"))

        worker.repository.save_measurements.assert_called_once()
        worker.repository.fail.assert_called_once_with("task-1", "dashscope_api_key_missing")


if __name__ == "__main__":
    unittest.main()
