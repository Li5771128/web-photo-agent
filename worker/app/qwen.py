import base64
import json
import time
from collections.abc import Callable
from typing import Any

import httpx

from .prompts import PLANNING_INSTRUCTIONS, PLANNING_REQUEST, VISION_INSTRUCTIONS, VISION_REQUEST


class VisionProviderError(Exception):
    def __init__(self, code: str, retryable: bool = False) -> None:
        super().__init__(code)
        self.code = code
        self.retryable = retryable


def _data_uri(image: bytes) -> str:
    encoded = base64.b64encode(image).decode("ascii")
    return f"data:image/jpeg;base64,{encoded}"


def _extract_output_text(response: dict[str, Any]) -> str:
    for item in response.get("output", []):
        if item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if content.get("type") == "output_text" and isinstance(content.get("text"), str):
                return content["text"]
    raise VisionProviderError("vision_response_invalid")


def _parse_json_text(text: str) -> dict[str, Any]:
    candidate = text.strip()
    if candidate.startswith("```"):
        lines = candidate.splitlines()
        if len(lines) >= 3 and lines[-1].strip() == "```":
            candidate = "\n".join(lines[1:-1])
    try:
        value = json.loads(candidate)
    except json.JSONDecodeError as error:
        raise VisionProviderError("vision_response_invalid") from error
    if not isinstance(value, dict):
        raise VisionProviderError("vision_response_invalid")
    return value


def _required_string(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise VisionProviderError("vision_response_invalid")
    return value.strip()


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) and item.strip() for item in value):
        raise VisionProviderError("vision_response_invalid")
    return [item.strip() for item in value]


def _image_summary(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or not isinstance(value.get("has_people"), bool):
        raise VisionProviderError("vision_response_invalid")
    skin_tone_notes = value.get("skin_tone_notes")
    if skin_tone_notes is not None:
        skin_tone_notes = _required_string(skin_tone_notes)
    return {
        "scene_type": _required_string(value.get("scene_type")),
        "subjects": _string_list(value.get("subjects")),
        "has_people": value["has_people"],
        "skin_tone_notes": skin_tone_notes,
        "lighting": _required_string(value.get("lighting")),
    }


def validate_vision_result(value: dict[str, Any]) -> dict[str, Any]:
    return {
        "reference": _image_summary(value.get("reference")),
        "target": _image_summary(value.get("target")),
        "transferable_features": _string_list(value.get("transferable_features")),
        "non_transferable_features": _string_list(value.get("non_transferable_features")),
        "matching_limits": _string_list(value.get("matching_limits")),
        "planning_risks": _string_list(value.get("planning_risks")),
    }


class QwenVisionClient:
    def __init__(
        self,
        api_key: str,
        base_url: str,
        model: str,
        transport: httpx.BaseTransport | None = None,
        sleeper: Callable[[float], None] = time.sleep,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.transport = transport
        self.sleeper = sleeper

    def analyze(self, reference: bytes, target: bytes) -> tuple[dict[str, Any], str | None]:
        payload = {
            "model": self.model,
            "store": False,
            "instructions": VISION_INSTRUCTIONS,
            "input": [
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": VISION_REQUEST + "\n参考图 A："},
                        {"type": "input_image", "image_url": _data_uri(reference)},
                        {"type": "input_text", "text": "目标图 B："},
                        {"type": "input_image", "image_url": _data_uri(target)},
                    ],
                }
            ],
        }
        response_data = self._post_with_retries(payload)
        result = validate_vision_result(_parse_json_text(_extract_output_text(response_data)))
        response_id = response_data.get("id")
        return result, response_id if isinstance(response_id, str) else None

    def _post_with_retries(self, payload: dict[str, Any]) -> dict[str, Any]:
        timeout = httpx.Timeout(60.0, connect=10.0)
        with httpx.Client(timeout=timeout, transport=self.transport) as client:
            for attempt in range(3):
                try:
                    response = client.post(
                        f"{self.base_url}/responses",
                        headers={"Authorization": f"Bearer {self.api_key}"},
                        json=payload,
                    )
                except (httpx.TimeoutException, httpx.NetworkError) as error:
                    if attempt == 2:
                        raise VisionProviderError("vision_provider_failed", retryable=True) from error
                    self.sleeper(2**attempt)
                    continue

                if response.status_code in (408, 429) or response.status_code >= 500:
                    if attempt == 2:
                        raise VisionProviderError("vision_provider_failed", retryable=True)
                    self.sleeper(2**attempt)
                    continue
                if response.status_code >= 400:
                    raise VisionProviderError("vision_provider_failed")
                try:
                    value = response.json()
                except json.JSONDecodeError as error:
                    raise VisionProviderError("vision_response_invalid") from error
                if not isinstance(value, dict):
                    raise VisionProviderError("vision_response_invalid")
                return value
        raise VisionProviderError("vision_provider_failed", retryable=True)


class QwenPlanningClient(QwenVisionClient):
    def plan(self, context: dict[str, Any]) -> tuple[dict[str, Any], str | None]:
        payload = {
            "model": self.model,
            "store": False,
            "instructions": PLANNING_INSTRUCTIONS,
            "input": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": PLANNING_REQUEST + "\ninput_context:\n" + json.dumps(context, ensure_ascii=False),
                        }
                    ],
                }
            ],
        }
        try:
            response_data = self._post_with_retries(payload)
            result = _parse_json_text(_extract_output_text(response_data))
        except VisionProviderError as error:
            code = "planning_response_invalid" if error.code == "vision_response_invalid" else "planning_provider_failed"
            raise VisionProviderError(code, error.retryable) from error
        response_id = response_data.get("id")
        return result, response_id if isinstance(response_id, str) else None
