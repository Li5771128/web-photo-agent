import json
import hashlib
import logging
import os
import signal
from dataclasses import dataclass

import redis
from PIL import UnidentifiedImageError

from .config import Settings
from .images import ImageColorProfileError, RawDecodeError, create_vision_preview, decode_measurement_image
from .measurements import SCHEMA_VERSION, compare_measurements, measure_image, validate_comparison, validate_measurement
from .planner import PLAN_SCHEMA_VERSION, VALIDATOR_VERSION, planning_context, validate_plan
from .prompts import PLANNING_PROMPT_VERSION
from .qwen import QwenPlanningClient, QwenVisionClient, VisionProviderError
from .repository import TaskRepository
from .storage import AssetStorage

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("reftone.worker")
QUEUE_NAME = "reftone:analysis:pending"


@dataclass(frozen=True)
class WorkerJob:
    kind: str
    task_id: str
    role: str | None = None
    object_key: str | None = None

    @classmethod
    def from_json(cls, payload: str) -> "WorkerJob":
        value = json.loads(payload)
        if not isinstance(value.get("taskId"), str):
            raise ValueError("unsupported worker job")
        if value.get("version") == 1:
            return cls(kind="analyze", task_id=value["taskId"])
        if value.get("version") != 2 or value.get("kind") not in ("analyze", "plan", "prepare_preview"):
            raise ValueError("unsupported worker job")
        if value["kind"] == "prepare_preview":
            if value.get("role") not in ("reference", "target") or not isinstance(value.get("objectKey"), str):
                raise ValueError("invalid preview job")
            return cls(kind=value["kind"], task_id=value["taskId"], role=value["role"], object_key=value["objectKey"])
        return cls(kind=value["kind"], task_id=value["taskId"])


# Keep the original import name available for existing callers while job envelopes
# expand beyond full analysis.
AnalysisJob = WorkerJob


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
        self.planning = QwenPlanningClient(
            api_key=self.settings.dashscope_api_key,
            base_url=self.settings.dashscope_base_url,
            model=self.settings.dashscope_model,
        )
        self.running = True

    def stop(self, *_args: object) -> None:
        self.running = False

    def prepare_preview(self, job: WorkerJob) -> None:
        if job.role not in ("reference", "target") or job.object_key is None:
            return
        if not self.repository.preview_asset_is_current(job.task_id, job.role, job.object_key):
            logger.info("Skipped stale RAW preview job for task %s", job.task_id)
            return
        try:
            source = self.storage.read(job.object_key)
            preview = create_vision_preview(
                source,
                self.settings.vision_max_edge,
                self.settings.vision_jpeg_quality,
                True,
            )
        except RawDecodeError:
            self.repository.fail_preview(job.task_id, job.role, job.object_key, "raw_decode_failed")
            logger.warning("Task %s could not decode its %s RAW preview", job.task_id, job.role)
            return
        except Exception:
            self.repository.fail_preview(job.task_id, job.role, job.object_key, "vision_preprocessing_failed")
            logger.exception("Task %s failed to prepare its %s RAW preview", job.task_id, job.role)
            return

        digest = hashlib.sha256(job.object_key.encode("utf-8")).hexdigest()[:16]
        preview_key = f"tasks/{job.task_id}/previews/{job.role}-{digest}.jpg"
        try:
            self.storage.write(preview_key, preview, "image/jpeg")
            if not self.repository.set_preview(job.task_id, job.role, job.object_key, preview_key):
                self.storage.delete(preview_key)
                logger.info("Discarded stale RAW preview for task %s", job.task_id)
                return
            logger.info("Prepared RAW preview for task %s", job.task_id)
        except Exception:
            try:
                self.storage.delete(preview_key)
            except Exception:
                logger.warning("Could not clean failed RAW preview %s", preview_key)
            self.repository.fail_preview(job.task_id, job.role, job.object_key, "vision_preview_storage_failed")
            logger.exception("Task %s could not store its RAW preview", job.task_id)

    def process_analysis(self, job: WorkerJob) -> None:
        assets = self.repository.claim(job.task_id)
        if assets is None:
            logger.warning("Skipped unknown, expired, inactive, or incomplete task %s", job.task_id)
            return
        try:
            reference_source = self.storage.read(assets.reference_key)
            target_source = self.storage.read(assets.target_key)
        except Exception:
            self.repository.fail_measurement(job.task_id, "measurement_asset_unavailable")
            logger.exception("Task %s could not read its image assets", job.task_id)
            return

        try:
            reference_decoded = decode_measurement_image(reference_source, assets.reference_is_raw)
        except RawDecodeError:
            self.repository.fail_measurement(job.task_id, "measurement_decode_failed", "reference")
            logger.warning("Task %s could not decode its reference image for measurement", job.task_id)
            return
        except ImageColorProfileError:
            self.repository.fail_measurement(job.task_id, "measurement_color_profile_failed", "reference")
            logger.warning("Task %s could not convert the reference color profile", job.task_id)
            return
        except (UnidentifiedImageError, OSError):
            self.repository.fail_measurement(job.task_id, "measurement_decode_failed", "reference")
            logger.warning("Task %s could not decode its reference image for measurement", job.task_id)
            return

        try:
            target_decoded = decode_measurement_image(target_source, assets.target_is_raw)
        except RawDecodeError:
            self.repository.fail_measurement(job.task_id, "measurement_decode_failed", "target")
            logger.warning("Task %s could not decode its target image for measurement", job.task_id)
            return
        except ImageColorProfileError:
            self.repository.fail_measurement(job.task_id, "measurement_color_profile_failed", "target")
            logger.warning("Task %s could not convert the target color profile", job.task_id)
            return
        except (UnidentifiedImageError, OSError):
            self.repository.fail_measurement(job.task_id, "measurement_decode_failed", "target")
            logger.warning("Task %s could not decode its target image for measurement", job.task_id)
            return

        try:
            reference_measurement = measure_image(
                reference_decoded.image,
                reference_decoded.source_kind,
                reference_decoded.raw_clues,
                (reference_decoded.source_width, reference_decoded.source_height),
            )
            target_measurement = measure_image(
                target_decoded.image,
                target_decoded.source_kind,
                target_decoded.raw_clues,
                (target_decoded.source_width, target_decoded.source_height),
            )
            comparison = compare_measurements(reference_measurement, target_measurement)
            validate_measurement(reference_measurement)
            validate_measurement(target_measurement)
            validate_comparison(comparison)
        except Exception:
            self.repository.fail_measurement(job.task_id, "measurement_calculation_failed")
            logger.exception("Task %s failed deterministic image measurement", job.task_id)
            return

        if not self.repository.save_measurements(
            job.task_id,
            SCHEMA_VERSION,
            reference_measurement,
            target_measurement,
            comparison,
        ):
            logger.info("Discarded measurements for cancelled task %s", job.task_id)
            return

        if not self.settings.dashscope_api_key:
            self.repository.fail(job.task_id, "dashscope_api_key_missing")
            logger.warning("Task %s cannot run because DASHSCOPE_API_KEY is missing", job.task_id)
            return

        try:
            reference_preview = create_vision_preview(
                reference_source,
                self.settings.vision_max_edge,
                self.settings.vision_jpeg_quality,
                assets.reference_is_raw,
            )
        except RawDecodeError:
            self.repository.fail(job.task_id, "raw_decode_failed", "reference")
            logger.warning("Task %s could not decode its reference RAW image", job.task_id)
            return
        except Exception:
            self.repository.fail(job.task_id, "vision_preprocessing_failed")
            logger.exception("Task %s failed to prepare its reference preview", job.task_id)
            return

        try:
            target_preview = create_vision_preview(
                target_source,
                self.settings.vision_max_edge,
                self.settings.vision_jpeg_quality,
                assets.target_is_raw,
            )
        except RawDecodeError:
            self.repository.fail(job.task_id, "raw_decode_failed", "target")
            logger.warning("Task %s could not decode its target RAW image", job.task_id)
            return
        except Exception:
            self.repository.fail(job.task_id, "vision_preprocessing_failed")
            logger.exception("Task %s failed to prepare its target preview", job.task_id)
            return

        reference_preview_key = f"tasks/{job.task_id}/previews/reference.jpg"
        target_preview_key = f"tasks/{job.task_id}/previews/target.jpg"
        try:
            self.storage.write(reference_preview_key, reference_preview, "image/jpeg")
            self.storage.write(target_preview_key, target_preview, "image/jpeg")
            if not self.repository.set_previews(job.task_id, reference_preview_key, target_preview_key):
                self.storage.delete(reference_preview_key)
                self.storage.delete(target_preview_key)
                logger.info("Discarded previews for cancelled task %s", job.task_id)
                return
        except Exception:
            self.repository.fail(job.task_id, "vision_preview_storage_failed")
            logger.exception("Task %s could not store its vision previews", job.task_id)
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

        if not self.repository.complete(job.task_id, self.settings.dashscope_model, response_id, result):
            logger.info("Discarded Qwen result for cancelled task %s", job.task_id)
            return
        logger.info("Completed Qwen visual recognition for task %s", job.task_id)

        self._run_planning(
            job.task_id,
            reference_measurement,
            target_measurement,
            comparison,
            result,
            assets.target_is_raw,
        )

    def _run_planning(
        self,
        task_id: str,
        reference_measurement: dict,
        target_measurement: dict,
        comparison: dict,
        result: dict,
        target_is_raw: bool,
    ) -> None:
        context = planning_context(
            reference_measurement,
            target_measurement,
            comparison,
            result,
            target_is_raw,
        )
        try:
            draft, planning_response_id = self.planning.plan(context)
        except VisionProviderError as error:
            self.repository.fail_plan(task_id, error.code)
            logger.warning("Task %s planning request failed with %s", task_id, error.code)
            return
        except Exception:
            self.repository.fail_plan(task_id, "planning_provider_failed")
            logger.exception("Task %s planning request failed unexpectedly", task_id)
            return

        if not self.repository.begin_validation(task_id):
            logger.info("Discarded planning draft for cancelled task %s", task_id)
            return
        try:
            safe_plan = validate_plan(draft, target_measurement, result, comparison, target_is_raw)
        except (KeyError, TypeError, ValueError):
            self.repository.fail_plan(task_id, "plan_validation_failed")
            logger.warning("Task %s planning draft failed deterministic validation", task_id)
            return

        if self.repository.complete_plan(
            task_id,
            PLAN_SCHEMA_VERSION,
            self.settings.dashscope_model,
            planning_response_id,
            PLANNING_PROMPT_VERSION,
            VALIDATOR_VERSION,
            draft,
            safe_plan,
        ):
            logger.info("Completed safe Lightroom plan for task %s", task_id)
        else:
            logger.info("Discarded safe Lightroom plan for cancelled task %s", task_id)

    def process_planning(self, job: WorkerJob) -> None:
        inputs = self.repository.load_planning_inputs(job.task_id)
        if inputs is None:
            logger.warning("Skipped unknown, expired, inactive, or incomplete planning task %s", job.task_id)
            return
        self._run_planning(
            job.task_id,
            inputs.reference,
            inputs.target,
            inputs.comparison,
            inputs.vision,
            inputs.target_is_raw,
        )

    def process(self, job: WorkerJob) -> None:
        if job.kind == "prepare_preview":
            self.prepare_preview(job)
        elif job.kind == "plan":
            self.process_planning(job)
        else:
            self.process_analysis(job)

    def run(self) -> None:
        logger.info("Worker listening on %s with model %s", QUEUE_NAME, self.settings.dashscope_model)
        while self.running:
            item = self.redis.brpop(QUEUE_NAME, timeout=2)
            if item is None:
                continue
            try:
                job = WorkerJob.from_json(item[1])
                self.process(job)
            except Exception:
                logger.exception("Failed to process worker job envelope")


def main() -> None:
    worker = Worker()
    signal.signal(signal.SIGTERM, worker.stop)
    signal.signal(signal.SIGINT, worker.stop)
    worker.run()


if __name__ == "__main__":
    main()
