import json
import logging
import os
import signal
from dataclasses import dataclass

import redis

from .config import Settings
from .images import create_vision_preview
from .qwen import QwenVisionClient, VisionProviderError
from .repository import TaskRepository
from .storage import AssetStorage

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("reftone.worker")
QUEUE_NAME = "reftone:analysis:pending"


@dataclass(frozen=True)
class AnalysisJob:
    task_id: str

    @classmethod
    def from_json(cls, payload: str) -> "AnalysisJob":
        value = json.loads(payload)
        if value.get("version") != 1 or not isinstance(value.get("taskId"), str):
            raise ValueError("unsupported analysis job")
        return cls(task_id=value["taskId"])


class Worker:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or Settings.from_env()
        self.redis = redis.Redis.from_url(self.settings.redis_url, decode_responses=True)
        self.repository = TaskRepository(self.settings.database_url)
        self.storage = AssetStorage(self.settings)
        self.vision = QwenVisionClient(
            api_key=self.settings.dashscope_api_key,
            base_url=self.settings.dashscope_base_url,
            model=self.settings.dashscope_model,
        )
        self.running = True

    def stop(self, *_args: object) -> None:
        self.running = False

    def process(self, job: AnalysisJob) -> None:
        assets = self.repository.claim(job.task_id)
        if assets is None:
            logger.warning("Skipped unknown, expired, inactive, or incomplete task %s", job.task_id)
            return
        if not self.settings.dashscope_api_key:
            self.repository.fail(job.task_id, "dashscope_api_key_missing")
            logger.warning("Task %s cannot run because DASHSCOPE_API_KEY is missing", job.task_id)
            return

        try:
            reference_source = self.storage.read(assets.reference_key)
            target_source = self.storage.read(assets.target_key)
        except Exception:
            self.repository.fail(job.task_id, "vision_asset_unavailable")
            logger.exception("Task %s could not read its image assets", job.task_id)
            return

        try:
            reference_preview = create_vision_preview(
                reference_source,
                self.settings.vision_max_edge,
                self.settings.vision_jpeg_quality,
            )
            target_preview = create_vision_preview(
                target_source,
                self.settings.vision_max_edge,
                self.settings.vision_jpeg_quality,
            )
        except Exception:
            self.repository.fail(job.task_id, "vision_preprocessing_failed")
            logger.exception("Task %s failed to prepare vision previews", job.task_id)
            return

        try:
            result, response_id = self.vision.analyze(reference_preview, target_preview)
        except VisionProviderError as error:
            self.repository.fail(job.task_id, error.code)
            logger.warning("Task %s vision request failed with %s", job.task_id, error.code)
            return
        except Exception:
            self.repository.fail(job.task_id, "vision_provider_failed")
            logger.exception("Task %s vision request failed unexpectedly", job.task_id)
            return

        self.repository.complete(job.task_id, self.settings.dashscope_model, response_id, result)
        logger.info("Completed Qwen visual recognition for task %s", job.task_id)

    def run(self) -> None:
        logger.info("Worker listening on %s with model %s", QUEUE_NAME, self.settings.dashscope_model)
        while self.running:
            item = self.redis.brpop(QUEUE_NAME, timeout=2)
            if item is None:
                continue
            try:
                self.process(AnalysisJob.from_json(item[1]))
            except Exception:
                logger.exception("Failed to process analysis job envelope")


def main() -> None:
    worker = Worker()
    signal.signal(signal.SIGTERM, worker.stop)
    signal.signal(signal.SIGINT, worker.stop)
    worker.run()


if __name__ == "__main__":
    main()
