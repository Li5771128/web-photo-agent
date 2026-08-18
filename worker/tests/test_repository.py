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

    @patch("app.repository.psycopg.connect")
    def test_measurements_are_not_stored_after_task_leaves_measuring(self, connect) -> None:
        connection = MagicMock()
        connect.return_value.__enter__.return_value = connection
        connection.execute.return_value.fetchone.return_value = None
        repository = TaskRepository("postgresql://example.test/database")

        stored = repository.save_measurements(
            "cancelled-task",
            1,
            {"role": "reference"},
            {"role": "target"},
            {"difference": "test"},
        )

        self.assertFalse(stored)
        self.assertEqual(connection.execute.call_count, 1)
        self.assertNotIn("INSERT INTO image_measurements", connection.execute.call_args.args[0])

    @patch("app.repository.psycopg.connect")
    def test_measurements_are_stored_as_one_complete_result(self, connect) -> None:
        connection = MagicMock()
        connect.return_value.__enter__.return_value = connection
        active = MagicMock()
        active.fetchone.return_value = {"id": "task-1"}
        connection.execute.side_effect = [active, MagicMock()]
        repository = TaskRepository("postgresql://example.test/database")

        stored = repository.save_measurements(
            "task-1",
            1,
            {"role": "reference"},
            {"role": "target"},
            {"difference": "test"},
        )

        self.assertTrue(stored)
        self.assertEqual(connection.execute.call_count, 2)
        self.assertIn("INSERT INTO image_measurements", connection.execute.call_args.args[0])
