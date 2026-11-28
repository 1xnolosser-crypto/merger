from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLANNER = ROOT / "scripts" / "topic_seo_planner.py"


class TopicPlannerHistoryTests(unittest.TestCase):
    def run_planner(self, output: Path, history: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                sys.executable,
                str(PLANNER),
                "--output",
                str(output),
                "--history",
                str(history),
                "--category",
                "any",
            ],
            text=True,
            capture_output=True,
            check=False,
        )

    def test_history_prevents_reuse_and_concepts_are_unique_txt_files(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            history = root / "topic-history.txt"
            history.write_text(
                "# VYROX TOPIC HISTORY v1\n"
                "1764201600 | water-cycle | رحلة قطرة ماء: كيف تعود الأمطار إلى الأرض؟\n"
                "1764201601 | octopus-brain | الأخطبوط: لماذا لديه أذرع ذكية بشكل مدهش؟\n",
                encoding="utf-8",
            )

            first_output = root / "first" / "auto-topic-project.json"
            first = self.run_planner(first_output, history)
            self.assertEqual(first.returncode, 0, first.stderr)
            first_data = json.loads(first.stdout)
            self.assertNotIn(first_data["selectedTopic"], [
                "رحلة قطرة ماء: كيف تعود الأمطار إلى الأرض؟",
                "الأخطبوط: لماذا لديه أذرع ذكية بشكل مدهش؟",
            ])
            first_concept = Path(first_data["conceptFile"])
            self.assertTrue(first_concept.is_file())
            self.assertIn("SCENE PLAN:", first_concept.read_text(encoding="utf-8"))

            second_output = root / "second" / "auto-topic-project.json"
            second = self.run_planner(second_output, history)
            self.assertEqual(second.returncode, 0, second.stderr)
            second_data = json.loads(second.stdout)
            self.assertNotEqual(first_data["selectedTopic"], second_data["selectedTopic"])
            self.assertTrue(Path(second_data["conceptFile"]).is_file())
            self.assertNotEqual(first_concept.name, Path(second_data["conceptFile"]).name)
            self.assertEqual(len(history.read_text(encoding="utf-8").splitlines()), 5)

    def test_malformed_history_fails_closed_without_overwriting(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            history = root / "topic-history.txt"
            original = "# VYROX TOPIC HISTORY v1\nthis line is malformed\n"
            history.write_text(original, encoding="utf-8")
            result = self.run_planner(root / "out.json", history)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(history.read_text(encoding="utf-8"), original)


if __name__ == "__main__":
    unittest.main()
