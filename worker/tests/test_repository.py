import unittest
from unittest.mock import MagicMock, patch

from app.repository import TaskRepository


class TaskRepositoryTest(unittest.TestCase):
    @patch("app.repository.psycopg.connect")
    def test_complete_discards_result_when_task_is_no_longer_recognizing(self, connect) -> None:
        connection = MagicMock()
        connect.return_value.__enter__.return_value = connection
        connection.execute.return_value.fetchone.return_value = None
        repository = TaskRepository("postgresql://example.test/database")

        completed = repository.complete("cancelled-task", "qwen", "response-id", {"scene": "test"})

        self.assertFalse(completed)
        self.assertEqual(connection.execute.call_count, 1)
        self.assertNotIn("INSERT INTO vision_analyses", connection.execute.call_args.args[0])

    @patch("app.repository.psycopg.connect")
    def test_set_previews_rejects_cancelled_task(self, connect) -> None:
        connection = MagicMock()
        connect.return_value.__enter__.return_value = connection
        connection.execute.return_value.fetchone.return_value = None
        repository = TaskRepository("postgresql://example.test/database")

        stored = repository.set_previews("cancelled-task", "reference.jpg", "target.jpg")

        self.assertFalse(stored)
        self.assertEqual(connection.execute.call_count, 1)
