from io import BytesIO
from dataclasses import dataclass
from typing import Any

import rawpy
from PIL import Image, ImageCms, ImageOps

Image.MAX_IMAGE_PIXELS = 80_000_000


class RawDecodeError(ValueError):
    pass


class ImageColorProfileError(ValueError):
    pass


@dataclass(frozen=True)
class DecodedMeasurementImage:
    image: Image.Image
    source_kind: str
    source_width: int
    source_height: int
    raw_clues: dict[str, Any] | None


def _to_rgb(image: Image.Image) -> Image.Image:
    if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, "white")
        background.alpha_composite(rgba)
        return background.convert("RGB")
    return image.convert("RGB")


def _to_srgb(image: Image.Image) -> Image.Image:
    profile = image.info.get("icc_profile")
    if not profile:
        return _to_rgb(image)
    try:
        source_profile = ImageCms.ImageCmsProfile(BytesIO(profile))
        rendered = ImageCms.profileToProfile(image, source_profile, ImageCms.createProfile("sRGB"), outputMode="RGB")
        return rendered
    except (ImageCms.PyCMSError, OSError, TypeError, ValueError) as error:
        raise ImageColorProfileError("embedded color profile could not be converted") from error


def _jpeg_preview(image: Image.Image, max_edge: int, quality: int) -> bytes:
    rendered = _to_rgb(ImageOps.exif_transpose(image))
    rendered.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
    output = BytesIO()
    rendered.save(output, format="JPEG", quality=quality, optimize=True)
    return output.getvalue()


def _raw_image(source: bytes) -> Image.Image:
    try:
        with rawpy.imread(BytesIO(source)) as raw:
            try:
                thumbnail = raw.extract_thumb()
                if thumbnail.format == rawpy.ThumbFormat.JPEG:
                    with Image.open(BytesIO(thumbnail.data)) as embedded:
                        return embedded.copy()
                if thumbnail.format == rawpy.ThumbFormat.BITMAP:
                    return Image.fromarray(thumbnail.data)
            except (rawpy.LibRawNoThumbnailError, OSError, ValueError):
                pass
            rgb = raw.postprocess(use_camera_wb=True, output_bps=8)
            return Image.fromarray(rgb)
    except (rawpy.LibRawError, OSError, ValueError) as error:
        raise RawDecodeError("RAW file could not be decoded") from error


def create_vision_preview(source: bytes, max_edge: int, quality: int, is_raw: bool = False) -> bytes:
    if is_raw:
        with _raw_image(source) as image:
            return _jpeg_preview(image, max_edge, quality)
    with Image.open(BytesIO(source)) as image:
        return _jpeg_preview(image, max_edge, quality)


def decode_measurement_image(source: bytes, is_raw: bool, max_edge: int = 1024) -> DecodedMeasurementImage:
    if is_raw:
        try:
            with rawpy.imread(BytesIO(source)) as raw:
                rgb = raw.postprocess(
                    use_camera_wb=True,
                    no_auto_bright=True,
                    output_bps=8,
                    output_color=rawpy.ColorSpace.sRGB,
                )
                rendered = Image.fromarray(rgb).convert("RGB")
                black_levels = [int(value) for value in raw.black_level_per_channel]
                white_level = int(raw.white_level)
                visible = raw.raw_image_visible
                storage_bits = int(visible.dtype.itemsize * 8)
                bit_depth = white_level.bit_length() if white_level > 0 else storage_bits
                raw_clues = {
                    "bit_depth": min(bit_depth, storage_bits),
                    "black_level_min": min(black_levels),
                    "black_level_max": max(black_levels),
                    "white_level": white_level,
                }
        except (rawpy.LibRawError, OSError, TypeError, ValueError) as error:
            raise RawDecodeError("RAW file could not be decoded for measurement") from error
        source_width, source_height = rendered.size
        rendered.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        return DecodedMeasurementImage(rendered.copy(), "raw", source_width, source_height, raw_clues)
    with Image.open(BytesIO(source)) as image:
        oriented = ImageOps.exif_transpose(image)
        rendered = _to_srgb(oriented)
        source_width, source_height = rendered.size
        rendered.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        return DecodedMeasurementImage(rendered.copy(), "standard", source_width, source_height, None)
