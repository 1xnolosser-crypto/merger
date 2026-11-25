import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import free_video_studio as studio


class FreeVideoStudioTests(unittest.TestCase):
    def test_only_simple_reuse_licenses_are_accepted(self):
        accepted = ["CC0 1.0", "Public domain", "PD-USGov", "CC BY 4.0", "CC BY 3.0"]
        rejected = [
            "CC BY-SA 4.0",
            "CC BY-NC 4.0",
            "CC BY-ND 4.0",
            "CC BY-NC-SA 4.0",
            "",
        ]
        for license_name in accepted:
            with self.subTest(license=license_name):
                self.assertTrue(studio.license_is_reusable(license_name))
        for license_name in rejected:
            with self.subTest(license=license_name):
                self.assertFalse(studio.license_is_reusable(license_name))

    def test_ass_time_format(self):
        self.assertEqual(studio.ass_time(1.25), "0:00:01.25")
        self.assertEqual(studio.ass_time(62.0), "0:01:02.00")

    def test_sample_project_has_valid_scene_fields(self):
        spec = json.loads((ROOT / "examples" / "free-video-project.json").read_text(encoding="utf-8"))
        self.assertTrue(spec["title"])
        self.assertGreaterEqual(len(spec["scenes"]), 1)
        self.assertLessEqual(len(spec["scenes"]), studio.MAX_SCENES)
        for scene in spec["scenes"]:
            self.assertTrue(scene["narration"].strip())
            self.assertTrue(scene["search"].strip())


if __name__ == "__main__":
    unittest.main()
