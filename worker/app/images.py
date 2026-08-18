from io import BytesIO

from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = 80_000_000


def _to_rgb(image: Image.Image) -> Image.Image:
    if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, "white")
        background.alpha_composite(rgba)
        return background.convert("RGB")
    return image.convert("RGB")


def create_vision_preview(source: bytes, max_edge: int, quality: int) -> bytes:
    with Image.open(BytesIO(source)) as opened:
        transposed = ImageOps.exif_transpose(opened)
        image = _to_rgb(transposed)
        image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        output = BytesIO()
        image.save(output, format="JPEG", quality=quality, optimize=True)
        return output.getvalue()
