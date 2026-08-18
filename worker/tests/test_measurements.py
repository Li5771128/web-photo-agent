import copy
import unittest

from PIL import Image

from app.measurements import compare_measurements, measure_image, validate_measurement


class ImageMeasurementTest(unittest.TestCase):
    def test_measures_linear_luminance_and_clipping_for_known_neutral_pixels(self) -> None:
        image = Image.new("RGB", (3, 1))
        image.putdata([(0, 0, 0), (128, 128, 128), (255, 255, 255)])

        result = measure_image(image, source_kind="standard")

        self.assertEqual(result["schema_version"], 1)
        self.assertAlmostEqual(result["luminance"]["p50"], 0.215861, places=6)
        self.assertEqual(result["tonal_regions"]["black_clip_fraction"], 0.333333)
        self.assertEqual(result["tonal_regions"]["white_clip_fraction"], 0.333333)

    def test_reports_saturation_and_opposite_color_cast_directions(self) -> None:
        warm = measure_image(Image.new("RGB", (4, 4), (220, 120, 60)), source_kind="standard")
        cool = measure_image(Image.new("RGB", (4, 4), (60, 120, 220)), source_kind="standard")
        green = measure_image(Image.new("RGB", (4, 4), (70, 180, 70)), source_kind="standard")
        magenta = measure_image(Image.new("RGB", (4, 4), (180, 70, 180)), source_kind="standard")

        self.assertGreater(warm["saturation"]["mean"], 0.5)
        self.assertGreater(warm["color_cast"]["warmth"], 0)
        self.assertLess(cool["color_cast"]["warmth"], 0)
        self.assertGreater(green["color_cast"]["green_magenta"], 0)
        self.assertLess(magenta["color_cast"]["green_magenta"], 0)

    def test_reports_stable_hue_bins_and_dominant_color_proportions(self) -> None:
        image = Image.new("RGB", (4, 1))
        image.putdata([(255, 0, 0), (255, 0, 0), (255, 0, 0), (0, 0, 255)])

        result = measure_image(image, source_kind="standard")

        self.assertEqual(result["hue_histogram"][0], 0.75)
        self.assertEqual(result["hue_histogram"][8], 0.25)
        self.assertEqual(result["dominant_colors"][0], {"hex": "#ff0000", "fraction": 0.75})
        self.assertEqual(result["dominant_colors"][1], {"hex": "#0000ff", "fraction": 0.25})

    def test_distinguishes_flat_and_high_contrast_edge_content(self) -> None:
        flat = measure_image(Image.new("RGB", (4, 4), (128, 128, 128)), source_kind="standard")
        checker = Image.new("RGB", (4, 4))
        checker.putdata([
            ((255, 255, 255) if (x + y) % 2 else (0, 0, 0))
            for y in range(4)
            for x in range(4)
        ])
        detailed = measure_image(checker, source_kind="standard")

        self.assertEqual(flat["edge_activity"], 0.0)
        self.assertGreater(detailed["edge_activity"], 0.9)
        self.assertGreater(detailed["contrast"]["effective_range"], flat["contrast"]["effective_range"])
        self.assertGreater(detailed["contrast"]["rms"], flat["contrast"]["rms"])

    def test_comparison_uses_reference_minus_target_and_stable_directions(self) -> None:
        reference = measure_image(Image.new("RGB", (4, 4), (220, 120, 60)), source_kind="standard")
        target = measure_image(Image.new("RGB", (4, 4), (60, 60, 60)), source_kind="standard")

        comparison = compare_measurements(reference, target)

        self.assertGreater(comparison["median_luminance"]["delta"], 0)
        self.assertEqual(comparison["median_luminance"]["direction"], "increase")
        self.assertGreater(comparison["mean_saturation"]["delta"], 0)
        self.assertEqual(comparison["mean_saturation"]["direction"], "increase")
        self.assertGreater(comparison["warmth"]["delta"], 0)
        self.assertEqual(comparison["rms_contrast"]["direction"], "similar")

    def test_validation_rejects_non_finite_results(self) -> None:
        result = measure_image(Image.new("RGB", (2, 2), (128, 128, 128)), source_kind="standard")
        validate_measurement(result)
        invalid = copy.deepcopy(result)
        invalid["luminance"]["mean"] = float("nan")

        with self.assertRaisesRegex(ValueError, "finite"):
            validate_measurement(invalid)

    def test_same_pixels_are_deterministic_and_keep_original_dimensions(self) -> None:
        image = Image.new("RGB", (2, 2))
        image.putdata([(10, 20, 30), (40, 50, 60), (70, 80, 90), (100, 110, 120)])

        first = measure_image(image, source_kind="standard", source_size=(4000, 3000))
        second = measure_image(image, source_kind="standard", source_size=(4000, 3000))

        self.assertEqual(first, second)
        self.assertEqual(first["source"]["width"], 4000)
        self.assertEqual(first["source"]["height"], 3000)
        self.assertEqual(first["source"]["sample_width"], 2)
        self.assertEqual(first["source"]["sample_height"], 2)


if __name__ == "__main__":
    unittest.main()
