from __future__ import annotations

import math
from typing import Any

import numpy as np
from PIL import Image

SCHEMA_VERSION = 1


def _rounded(value: float) -> float:
    return round(float(value), 6)


def _rgb_arrays(image: Image.Image) -> tuple[np.ndarray, np.ndarray]:
    srgb = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
    linear = np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)
    return srgb, linear


def _hsl_saturation(srgb: np.ndarray) -> np.ndarray:
    channel_max = np.max(srgb, axis=-1)
    channel_min = np.min(srgb, axis=-1)
    delta = channel_max - channel_min
    lightness = (channel_max + channel_min) / 2.0
    denominator = 1.0 - np.abs(2.0 * lightness - 1.0)
    return np.divide(delta, denominator, out=np.zeros_like(delta), where=denominator > 1e-8)


def _hue_histogram(srgb: np.ndarray, saturation: np.ndarray) -> list[float]:
    channel_max = np.max(srgb, axis=-1)
    channel_min = np.min(srgb, axis=-1)
    delta = channel_max - channel_min
    hue = np.zeros_like(channel_max)
    valid = (delta > 1e-8) & (saturation >= 0.08)
    red_max = valid & (srgb[..., 0] == channel_max)
    green_max = valid & (srgb[..., 1] == channel_max)
    blue_max = valid & (srgb[..., 2] == channel_max)
    hue[red_max] = np.mod((srgb[..., 1][red_max] - srgb[..., 2][red_max]) / delta[red_max], 6.0)
    hue[green_max] = (srgb[..., 2][green_max] - srgb[..., 0][green_max]) / delta[green_max] + 2.0
    hue[blue_max] = (srgb[..., 0][blue_max] - srgb[..., 1][blue_max]) / delta[blue_max] + 4.0
    bins = np.floor(hue[valid] * 2.0).astype(np.int64) % 12
    counts = np.bincount(bins, minlength=12).astype(np.float64)
    if counts.sum() == 0:
        return [0.0] * 12
    return [_rounded(value) for value in counts / counts.sum()]


def _dominant_colors(srgb: np.ndarray) -> list[dict[str, Any]]:
    pixels = np.rint(srgb.reshape(-1, 3) * 15.0).astype(np.uint8) * 17
    packed = (pixels[:, 0].astype(np.uint32) << 16) | (pixels[:, 1].astype(np.uint32) << 8) | pixels[:, 2].astype(np.uint32)
    colors, counts = np.unique(packed, return_counts=True)
    order = np.lexsort((colors, -counts))[:5]
    total = pixels.shape[0]
    return [
        {"hex": f"#{int(colors[index]):06x}", "fraction": _rounded(counts[index] / total)}
        for index in order
    ]


def _edge_activity(luminance: np.ndarray) -> float:
    differences: list[np.ndarray] = []
    if luminance.shape[1] > 1:
        differences.append(np.abs(np.diff(luminance, axis=1)).reshape(-1))
    if luminance.shape[0] > 1:
        differences.append(np.abs(np.diff(luminance, axis=0)).reshape(-1))
    if not differences:
        return 0.0
    return _rounded(np.mean(np.concatenate(differences) >= 0.08))


def measure_image(
    image: Image.Image,
    source_kind: str,
    raw_clues: dict[str, Any] | None = None,
    source_size: tuple[int, int] | None = None,
) -> dict[str, Any]:
    srgb, linear = _rgb_arrays(image)
    luminance = linear[..., 0] * 0.2126 + linear[..., 1] * 0.7152 + linear[..., 2] * 0.0722
    flat_luminance = luminance.reshape(-1)
    saturation_image = _hsl_saturation(srgb)
    saturation = saturation_image.reshape(-1)
    channel_means = np.mean(srgb.reshape(-1, 3), axis=0)
    red, green, blue = (float(value) for value in channel_means)
    warmth = (red - blue) / max(red + blue, 1e-8)
    green_magenta = (2.0 * green - red - blue) / max(red + 2.0 * green + blue, 1e-8)
    source_width, source_height = source_size or image.size
    return {
        "schema_version": SCHEMA_VERSION,
        "source": {
            "kind": source_kind,
            "width": source_width,
            "height": source_height,
            "aspect_ratio": _rounded(source_width / source_height),
            "sample_width": image.width,
            "sample_height": image.height,
        },
        "luminance": {
            "mean": _rounded(np.mean(flat_luminance)),
            "standard_deviation": _rounded(np.std(flat_luminance)),
            "p05": _rounded(np.percentile(flat_luminance, 5)),
            "p50": _rounded(np.percentile(flat_luminance, 50)),
            "p95": _rounded(np.percentile(flat_luminance, 95)),
        },
        "tonal_regions": {
            "shadow_fraction": _rounded(np.mean(flat_luminance < 0.18)),
            "highlight_fraction": _rounded(np.mean(flat_luminance > 0.8)),
            "black_clip_fraction": _rounded(np.mean(flat_luminance <= 0.01)),
            "white_clip_fraction": _rounded(np.mean(flat_luminance >= 0.99)),
        },
        "contrast": {
            "rms": _rounded(np.std(flat_luminance)),
            "effective_range": _rounded(np.percentile(flat_luminance, 95) - np.percentile(flat_luminance, 5)),
        },
        "saturation": {
            "mean": _rounded(np.mean(saturation)),
            "p50": _rounded(np.percentile(saturation, 50)),
            "p95": _rounded(np.percentile(saturation, 95)),
        },
        "color_cast": {
            "warmth": _rounded(np.clip(warmth, -1.0, 1.0)),
            "green_magenta": _rounded(np.clip(green_magenta, -1.0, 1.0)),
        },
        "hue_histogram": _hue_histogram(srgb, saturation_image),
        "dominant_colors": _dominant_colors(srgb),
        "edge_activity": _edge_activity(luminance),
        "raw_clues": raw_clues,
    }


def _difference(reference: float, target: float, tolerance: float) -> dict[str, Any]:
    delta = _rounded(reference - target)
    if delta > tolerance:
        direction = "increase"
    elif delta < -tolerance:
        direction = "decrease"
    else:
        direction = "similar"
    return {"delta": delta, "direction": direction}


def compare_measurements(reference: dict[str, Any], target: dict[str, Any]) -> dict[str, Any]:
    result = {
        "schema_version": SCHEMA_VERSION,
        "median_luminance": _difference(reference["luminance"]["p50"], target["luminance"]["p50"], 0.03),
        "effective_range": _difference(reference["contrast"]["effective_range"], target["contrast"]["effective_range"], 0.05),
        "rms_contrast": _difference(reference["contrast"]["rms"], target["contrast"]["rms"], 0.03),
        "mean_saturation": _difference(reference["saturation"]["mean"], target["saturation"]["mean"], 0.05),
        "warmth": _difference(reference["color_cast"]["warmth"], target["color_cast"]["warmth"], 0.04),
        "green_magenta": _difference(reference["color_cast"]["green_magenta"], target["color_cast"]["green_magenta"], 0.04),
    }
    for name in ("shadow_fraction", "highlight_fraction", "black_clip_fraction", "white_clip_fraction"):
        result[name] = _difference(reference["tonal_regions"][name], target["tonal_regions"][name], 0.03)
    hue_distance = 0.5 * sum(
        abs(float(reference_value) - float(target_value))
        for reference_value, target_value in zip(reference["hue_histogram"], target["hue_histogram"], strict=True)
    )
    result["hue_distribution_distance"] = {
        "delta": _rounded(hue_distance),
        "direction": "similar" if hue_distance <= 0.08 else "increase",
    }
    return result


def validate_measurement(result: dict[str, Any]) -> None:
    if result.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("unsupported measurement schema")

    def check_finite(value: Any) -> None:
        if isinstance(value, dict):
            for nested in value.values():
                check_finite(nested)
        elif isinstance(value, list):
            for nested in value:
                check_finite(nested)
        elif isinstance(value, float) and not math.isfinite(value):
            raise ValueError("measurement numbers must be finite")

    check_finite(result)
    proportions = [
        *result["tonal_regions"].values(),
        *result["hue_histogram"],
        *(color["fraction"] for color in result["dominant_colors"]),
        result["edge_activity"],
    ]
    if any(float(value) < 0.0 or float(value) > 1.0 for value in proportions):
        raise ValueError("measurement proportions must be between zero and one")
    if any(abs(float(value)) > 1.0 for value in result["color_cast"].values()):
        raise ValueError("measurement color cast must be between minus one and one")
    hue_total = sum(float(value) for value in result["hue_histogram"])
    if hue_total != 0.0 and not math.isclose(hue_total, 1.0, abs_tol=1e-5):
        raise ValueError("measurement hue histogram must be normalized")


def validate_comparison(result: dict[str, Any]) -> None:
    if result.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("unsupported comparison schema")
    for name, value in result.items():
        if name == "schema_version":
            continue
        delta = value.get("delta")
        if not isinstance(delta, (int, float)) or not math.isfinite(float(delta)):
            raise ValueError("comparison numbers must be finite")
        if value.get("direction") not in ("increase", "decrease", "similar"):
            raise ValueError("comparison direction is invalid")
