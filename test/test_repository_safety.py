import io
import os
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from scripts.verify_repository import load_denylist, scan_bytes, scan_repository, scan_xlsx


class RepositorySafetyTests(unittest.TestCase):
    def scan_temporary_repository(self, files, message="synthetic commit", replacement=False):
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            subprocess.run(["git", "init", "--quiet"], cwd=repository, check=True)
            subprocess.run(["git", "config", "core.autocrlf", "false"], cwd=repository, check=True)
            subprocess.run(["git", "config", "user.name", "Release Test"], cwd=repository, check=True)
            subprocess.run(
                ["git", "config", "user.email", "release-test@example.invalid"],
                cwd=repository,
                check=True,
            )
            for name, content in files.items():
                (repository / name).write_bytes(content)
            subprocess.run(["git", "add", "."], cwd=repository, check=True)
            subprocess.run(["git", "commit", "--quiet", "-m", message], cwd=repository, check=True)
            for name in files:
                (repository / name).unlink()
            subprocess.run(["git", "add", "-u"], cwd=repository, check=True)
            subprocess.run(["git", "commit", "--quiet", "-m", "remove fixture"], cwd=repository, check=True)
            if replacement:
                subprocess.run(["git", "replace", "HEAD", "HEAD^"], cwd=repository, check=True)
            original_directory = Path.cwd()
            try:
                os.chdir(repository)
                return scan_repository()
            finally:
                os.chdir(original_directory)

    def scan_workbook(self, worksheet, shared_strings=b""):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.xlsx"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("xl/worksheets/sheet1.xml", worksheet)
                if shared_strings:
                    archive.writestr("xl/sharedStrings.xml", shared_strings)
            return scan_xlsx(path)

    def test_rejects_telegram_shaped_secret(self):
        secret = b"123456789" + b":" + b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi"
        findings = scan_bytes("synthetic fixture", secret)
        self.assertEqual([item.rule for item in findings], ["possible Telegram token"])

    def test_rejects_apps_script_deployment_url(self):
        deployment = b"https://script.google.com/macros/s/" + b"AK" + b"fycb" + b"A" * 24 + b"/exec"
        findings = scan_bytes("synthetic fixture", deployment)
        self.assertEqual(
            [item.rule for item in findings],
            ["possible Apps Script deployment URL", "possible Apps Script deployment ID"],
        )

    def test_rejects_literal_webhook_key_assignment(self):
        assignment = b"ANGEL_WEBHOOK_" + b"KEY" + b'=\"' + b"a" * 32 + b'\"'
        findings = scan_bytes("synthetic fixture", assignment)
        self.assertEqual([item.rule for item in findings], ["literal webhook key assignment"])

    def test_rejects_participant_like_csv_row(self):
        row = b"Par" + b"ticipant" + b"," + b"1000" + b"001" + b",Room\n"
        findings = scan_bytes("synthetic.csv", row)
        self.assertEqual([item.rule for item in findings], ["possible participant row"])

    def test_release_mode_requires_denylist(self):
        with patch.dict(os.environ, {"AM_RELEASE_MODE": "1"}, clear=True):
            with self.assertRaisesRegex(ValueError, "AM_PRIVATE_DENYLIST"):
                load_denylist()

    def test_rejects_literal_xlsx_data_row(self):
        worksheet = (
            b"<worksheet><sheetData>"
            b"<row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>Header</t></is></c></row>"
            b"<row r=\"2\"><c r=\"A2\" t=\"s\"><v>0</v></c>"
            b"<c r=\"B2\" t=\"inlineStr\"><is><t>Inline</t></is></c>"
            b"<c r=\"C2\"><v>1</v></c><c r=\"D2\" t=\"b\"><v>1</v></c></row>"
            b"</sheetData></worksheet>"
        )
        shared_strings = b"<sst><si><t>Par" + b"ticipant</t></si></sst>"
        findings = self.scan_workbook(worksheet, shared_strings)
        self.assertEqual([item.rule for item in findings], ["literal XLSX worksheet cell"] * 4)

    def test_allows_formula_and_empty_cached_xlsx_cells(self):
        worksheet = (
            b"<worksheet><sheetData><row r=\"1\"><c r=\"A1\"><v>1</v></c></row>"
            b"<row r=\"2\"><c r=\"A2\"><f>SUM(A1:A1)</f><v>1</v></c><c r=\"B2\"><v/></c></row>"
            b"</sheetData></worksheet>"
        )
        self.assertEqual(self.scan_workbook(worksheet), [])

    def test_rejects_formula_error_cache(self):
        worksheet = (
            b"<worksheet><sheetData><row r=\"1\"><c r=\"A1\"><v>1</v></c></row>"
            b"<row r=\"2\"><c r=\"A2\" t=\"e\"><f>UNKNOWN()</f><v>#NAME?</v></c></row>"
            b"</sheetData></worksheet>"
        )
        findings = self.scan_workbook(worksheet)
        self.assertEqual([item.rule for item in findings], ["formula XLSX worksheet error cache"])

    def test_rejects_formula_participant_cache(self):
        worksheet = (
            b"<worksheet><sheetData><row r=\"1\"><c r=\"A1\"><v>1</v></c></row>"
            b"<row r=\"2\"><c r=\"A2\" t=\"str\"><f>LOOKUP()</f><v>1234567</v></c></row>"
            b"</sheetData></worksheet>"
        )
        findings = self.scan_workbook(worksheet)
        self.assertEqual([item.rule for item in findings], ["possible participant formula cache"])

    def test_release_mode_rejects_empty_denylist(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "empty-denylist"
            path.write_bytes(b"\n\t\n")
            with patch.dict(
                os.environ,
                {"AM_RELEASE_MODE": "1", "AM_PRIVATE_DENYLIST": str(path)},
                clear=True,
            ):
                with self.assertRaisesRegex(ValueError, "nonblank entries"):
                    load_denylist()

    def test_rejects_positive_denylist_match(self):
        private_value = b"@" + b"known" + b"_handle"
        findings = scan_bytes("synthetic fixture", b"prefix " + private_value, (private_value,))
        self.assertEqual([item.rule for item in findings], ["private denylist entry"])

    def test_rejects_secret_in_deleted_binary_blob(self):
        secret = b"123456789" + b":" + b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi"
        findings = self.scan_temporary_repository({"deleted.bin": b"\x00" + secret + b"\x00"})
        self.assertIn("possible Telegram token", [item.rule for item in findings])

    def test_rejects_participant_row_in_deleted_csv(self):
        row = b"Par" + b"ticipant" + b"," + b"1000" + b"001" + b",Room\n"
        findings = self.scan_temporary_repository({"deleted.csv": row})
        self.assertIn("possible participant row", [item.rule for item in findings])

    def test_scans_csv_blob_when_first_path_has_non_csv_suffix(self):
        row = b"Par" + b"ticipant" + b"," + b"1000" + b"001" + b",Room\n"
        findings = self.scan_temporary_repository({"a.bin": row, "z.csv": row})
        self.assertIn("possible participant row", [item.rule for item in findings])

    def test_rejects_git_replacement_refs(self):
        findings = self.scan_temporary_repository({"fixture.txt": b"synthetic\n"}, replacement=True)
        self.assertIn("replacement ref present", [item.rule for item in findings])

    def test_rejects_deleted_workbook_with_literal_data(self):
        worksheet = (
            b"<worksheet><sheetData>"
            b"<row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>Header</t></is></c></row>"
            b"<row r=\"2\"><c r=\"A2\" t=\"inlineStr\"><is><t>Synthetic</t></is></c></row>"
            b"</sheetData></worksheet>"
        )
        workbook = io.BytesIO()
        with zipfile.ZipFile(workbook, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("xl/worksheets/sheet1.xml", worksheet)
        findings = self.scan_temporary_repository({"deleted.xlsx": workbook.getvalue()})
        self.assertIn("literal XLSX worksheet cell", [item.rule for item in findings])

    def test_scans_workbook_blob_when_first_path_has_non_workbook_suffix(self):
        worksheet = (
            b"<worksheet><sheetData>"
            b"<row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>Header</t></is></c></row>"
            b"<row r=\"2\"><c r=\"A2\" t=\"inlineStr\"><is><t>Synthetic</t></is></c></row>"
            b"</sheetData></worksheet>"
        )
        workbook = io.BytesIO()
        with zipfile.ZipFile(workbook, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("xl/worksheets/sheet1.xml", worksheet)
        content = workbook.getvalue()
        findings = self.scan_temporary_repository({"a.bin": content, "z.xlsx": content})
        self.assertIn("literal XLSX worksheet cell", [item.rule for item in findings])
