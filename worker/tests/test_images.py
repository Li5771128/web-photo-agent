import unittest
from io import BytesIO
from unittest.mock import MagicMock, patch

import numpy as np
import rawpy
from PIL import Image

from app.images import RawDecodeError, create_vision_preview, decode_measurement_image


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

    def test_measurement_decode_corrects_orientation_and_limits_sample_size(self) -> None:
        source = BytesIO()
        image = Image.new("RGB", (1200, 600), "#7f7f7f")
        exif = Image.Exif()
        exif[274] = 6
        image.save(source, format="JPEG", exif=exif)

        decoded = decode_measurement_image(source.getvalue(), is_raw=False, max_edge=1024)

        self.assertEqual(decoded.source_kind, "standard")
        self.assertEqual(decoded.image.size, (512, 1024))
        self.assertIsNone(decoded.raw_clues)

    @patch("app.images.rawpy.imread")
    def test_raw_measurement_decode_uses_fixed_rendering_and_non_identifying_clues(self, imread) -> None:
        raw = MagicMock()
        imread.return_value.__enter__.return_value = raw
        raw.postprocess.return_value = np.full((2, 3, 3), 128, dtype=np.uint8)
        raw.raw_image_visible = np.zeros((2, 3), dtype=np.uint16)
        raw.black_level_per_channel = [512, 520, 512, 520]
        raw.white_level = 16383

        decoded = decode_measurement_image(b"raw fixture", is_raw=True, max_edge=1024)

        self.assertEqual(decoded.source_kind, "raw")
        self.assertEqual(decoded.image.size, (3, 2))
        self.assertEqual(decoded.raw_clues, {"bit_depth": 14, "black_level_min": 512, "black_level_max": 520, "white_level": 16383})
        raw.postprocess.assert_called_once_with(
            use_camera_wb=True,
            no_auto_bright=True,
            output_bps=8,
            output_color=rawpy.ColorSpace.sRGB,
        )


if __name__ == "__main__":
    unittest.main()
