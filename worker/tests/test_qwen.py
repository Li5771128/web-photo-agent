import json
import unittest

import httpx

from app.qwen import QwenVisionClient, VisionProviderError


VALID_RESULT = {
    "reference": {
        "scene_type": "室外人像",
        "subjects": ["人物"],
        "has_people": True,
        "skin_tone_notes": "面部肤色偏暖",
        "lighting": "柔和侧光",
    },
    "target": {
        "scene_type": "室外人像",
        "subjects": ["人物"],
        "has_people": True,
        "skin_tone_notes": "肤色较中性",
        "lighting": "正面自然光",
    },
    "transferable_features": ["低饱和暖色倾向"],
    "non_transferable_features": ["光线方向"],
    "matching_limits": ["背景内容不同"],
    "planning_risks": ["保护肤色"],
}


def response_with_text(text: str) -> dict:
    return {
        "id": "resp-test",
        "output": [
            {
                "type": "message",
                "content": [{"type": "output_text", "text": text}],
            }
        ],
    }


class QwenVisionClientTest(unittest.TestCase):
    def test_sends_two_jpeg_data_uris_without_server_storage(self) -> None:
        observed: dict = {}

        def handler(request: httpx.Request) -> httpx.Response:
            observed.update(json.loads(request.content))
            self.assertEqual(str(request.url), "https://example.test/compatible-mode/v1/responses")
            self.assertEqual(request.headers["authorization"], "Bearer test-key")
            return httpx.Response(200, json=response_with_text(json.dumps(VALID_RESULT, ensure_ascii=False)))

        client = QwenVisionClient(
            "test-key",
            "https://example.test/compatible-mode/v1",
            "qwen3.7-max",
            transport=httpx.MockTransport(handler),
            sleeper=lambda _seconds: None,
        )

        result, response_id = client.analyze(b"reference-jpeg", b"target-jpeg")

        self.assertEqual(observed["model"], "qwen3.7-max")
        self.assertFalse(observed["store"])
        images = [item for item in observed["input"][0]["content"] if item["type"] == "input_image"]
        self.assertEqual(len(images), 2)
        self.assertTrue(all(item["image_url"].startswith("data:image/jpeg;base64,") for item in images))
        self.assertEqual(result, VALID_RESULT)
        self.assertEqual(response_id, "resp-test")

    def test_accepts_json_inside_markdown_fence(self) -> None:
        payload = "```json\n" + json.dumps(VALID_RESULT, ensure_ascii=False) + "\n```"
        transport = httpx.MockTransport(lambda _request: httpx.Response(200, json=response_with_text(payload)))
        client = QwenVisionClient("key", "https://example.test/v1", "model", transport=transport)

        result, _response_id = client.analyze(b"a", b"b")

        self.assertEqual(result, VALID_RESULT)

    def test_rejects_incomplete_model_result(self) -> None:
        transport = httpx.MockTransport(
            lambda _request: httpx.Response(200, json=response_with_text('{"reference": {}}'))
        )
        client = QwenVisionClient("key", "https://example.test/v1", "model", transport=transport)

        with self.assertRaisesRegex(VisionProviderError, "vision_response_invalid"):
            client.analyze(b"a", b"b")

    def test_does_not_retry_authentication_errors(self) -> None:
        calls = 0

        def handler(_request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            return httpx.Response(401, json={"error": {"message": "invalid key"}})

        client = QwenVisionClient(
            "bad-key",
            "https://example.test/v1",
            "model",
            transport=httpx.MockTransport(handler),
            sleeper=lambda _seconds: None,
        )

        with self.assertRaisesRegex(VisionProviderError, "vision_provider_failed"):
            client.analyze(b"a", b"b")
        self.assertEqual(calls, 1)


if __name__ == "__main__":
    unittest.main()
