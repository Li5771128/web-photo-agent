import unittest

from app.main import AnalysisJob


class AnalysisJobTest(unittest.TestCase):
    def test_parses_supported_job(self) -> None:
        job = AnalysisJob.from_json('{"version": 1, "taskId": "task-123"}')
        self.assertEqual(job.task_id, "task-123")

    def test_rejects_unknown_version(self) -> None:
        with self.assertRaises(ValueError):
            AnalysisJob.from_json('{"version": 2, "taskId": "task-123"}')


if __name__ == "__main__":
    unittest.main()
