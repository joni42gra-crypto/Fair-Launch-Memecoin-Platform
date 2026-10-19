"""Downloader safety checks only; these never load or execute an SBF program."""

import copy
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "pump_lab", Path(__file__).resolve().parents[1] / "scripts/lab.py"
)
LAB = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LAB)


class PreparationSafetyTests(unittest.TestCase):
    def test_corrupt_archive_is_rejected_before_writing_any_artifact(self):
        config = copy.deepcopy(LAB.manifest())
        corrupt = b"not the pinned archive"
        config["package"]["size_bytes"] = len(corrupt)
        with tempfile.TemporaryDirectory() as temporary:
            with (
                patch.object(LAB, "verify_config"),
                patch.object(LAB, "manifest", return_value=config),
                patch.object(LAB, "cache_dir", return_value=Path(temporary)),
                patch.object(LAB.urllib.request, "urlopen") as request,
            ):
                response = request.return_value.__enter__.return_value
                response.url = config["package"]["url"]
                response.read.return_value = corrupt
                with self.assertRaisesRegex(RuntimeError, "Archive SHA-256 mismatch"):
                    LAB.prepare()
                self.assertEqual(list(Path(temporary).iterdir()), [])

    def test_external_rpc_configuration_is_rejected_without_connecting(self):
        with patch.dict(LAB.os.environ, {"RPC_URL": "https://example.invalid"}):
            with self.assertRaisesRegex(RuntimeError, "Unset RPC_URL"):
                LAB.verify_config()

    def test_artifact_cache_inside_repository_is_rejected(self):
        with patch.dict(LAB.os.environ, {"PUMP_LAB_CACHE_DIR": str(LAB.LAB / "target")}):
            with self.assertRaisesRegex(RuntimeError, "outside the repository"):
                LAB.cache_dir()


if __name__ == "__main__":
    unittest.main()
