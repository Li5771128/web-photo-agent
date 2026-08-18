import unittest
from io import BytesIO
from unittest.mock import patch

from PIL import Image

from app.images import RawDecodeError, create_vision_preview


class VisionPreviewTest(unittest.TestCase):
    def test_resizes_corrects_orientation_and_removes_exif(self) -> None:
        source = BytesIO()
        image = Image.new("RGB", (1200, 600), "#c87854")
        exif = Image.Exif()
        exif[274] = 6
        exif[315] = "identifying artist"
        image.save(source, format="JPEG", exif=exif)

        preview = create_vision_preview(source.getvalue(), max_edge=1024, quality=80)

        with Image.open(BytesIO(preview)) as output:
            self.assertEqual(output.format, "JPEG")
            self.assertEqual(output.size, (512, 1024))
            self.assertEqual(len(output.getexif()), 0)

    def test_does_not_upscale_small_images(self) -> None:
        source = BytesIO()
        Image.new("RGBA", (320, 180), (0, 0, 0, 0)).save(source, format="PNG")

        preview = create_vision_preview(source.getvalue(), max_edge=1024, quality=80)

        with Image.open(BytesIO(preview)) as output:
            self.assertEqual(output.size, (320, 180))
            self.assertEqual(output.mode, "RGB")

    @patch("app.images._raw_image")
    def test_raw_preview_uses_the_same_safe_jpeg_output(self, raw_image) -> None:
        raw_image.return_value = Image.new("RGB", (1800, 1200), "#637f5b")

        preview = create_vision_preview(b"raw fixture", max_edge=1024, quality=80, is_raw=True)

        with Image.open(BytesIO(preview)) as output:
            self.assertEqual(output.format, "JPEG")
            self.assertEqual(output.size, (1024, 683))
            self.assertEqual(len(output.getexif()), 0)

    def test_invalid_raw_has_a_stable_error(self) -> None:
        with self.assertRaises(RawDecodeError):
            create_vision_preview(b"not a raw file", max_edge=1024, quality=80, is_raw=True)


if __name__ == "__main__":
    unittest.main()
