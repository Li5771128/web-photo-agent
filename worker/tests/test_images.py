import unittest
from io import BytesIO

from PIL import Image

from app.images import create_vision_preview


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


if __name__ == "__main__":
    unittest.main()
