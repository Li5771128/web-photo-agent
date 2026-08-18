from io import BytesIO

import rawpy
from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = 80_000_000


class RawDecodeError(ValueError):
    pass


def _to_rgb(image: Image.Image) -> Image.Image:
    if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, "white")
        background.alpha_composite(rgba)
        return background.convert("RGB")
    return image.convert("RGB")


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
