"""Reject secrets and private participant data before release."""

from __future__ import annotations

import os
import io
import re
import subprocess
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree


TOKEN_PATTERNS = {
    "possible Telegram token": rb"\b\d{7,12}:[A-Za-z0-9_-]{30,}\b",
    "possible Google API key": rb"\bAIza[A-Za-z0-9_-]{30,}\b",
    "private key": rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
}

REPOSITORY_PATTERNS = {
    "possible Apps Script deployment URL": rb"https://script\.google\.com/macros/s/AKfycb[A-Za-z0-9_-]{20,}/(?:exec|dev)\b",
    "possible Apps Script deployment ID": rb"\bAKfycb[A-Za-z0-9_-]{20,}\b",
    "possible Cloudflare Workers URL": rb"https://[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.workers\.dev(?:/[^\s\"'<>]*)?",
    "literal webhook key assignment": rb"(?<![A-Za-z0-9_])[\"']?(?:ANGEL|MORTAL|ADMIN)_WEBHOOK_KEY[\"']?\s*[:=]\s*[\"']?[A-Za-z0-9_-]{32,}(?=[\"'\s,}\]]|$)",
}

DATA_ARTIFACT_SUFFIXES = {".csv", ".tsv"}
PARTICIPANT_ROW_PATTERN = rb"(?m)^[^\r\n]*(?:,|\t)\s*\d{7,12}\s*(?:,|\t)[^\r\n]*$"
PARTICIPANT_FORMULA_CACHE_PATTERN = re.compile(
    r"(?:^|\D)\d{5,20}(?:\D|$)|@[A-Za-z0-9_]{3,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"
)
FORMULA_ERROR_VALUES = {"#REF!", "#DIV/0!", "#VALUE!", "#NAME?", "#N/A", "#NUM!", "#NULL!"}


@dataclass(frozen=True)
class Finding:
    path: str
    rule: str


def scan_bytes(path: str, content: bytes, denylist: tuple[bytes, ...] = ()) -> list[Finding]:
    findings = [
        Finding(path, rule)
        for rule, pattern in {**TOKEN_PATTERNS, **REPOSITORY_PATTERNS}.items()
        if re.search(pattern, content)
    ]
    if Path(path).suffix.lower() in DATA_ARTIFACT_SUFFIXES and re.search(PARTICIPANT_ROW_PATTERN, content):
        findings.append(Finding(path, "possible participant row"))
    if any(entry in content for entry in denylist):
        findings.append(Finding(path, "private denylist entry"))
    return findings


def xml_child(element: ElementTree.Element, name: str) -> ElementTree.Element | None:
    return next((child for child in element if child.tag.rsplit("}", 1)[-1] == name), None)


def xml_text(element: ElementTree.Element) -> str:
    return "".join(child.text or "" for child in element.iter() if child.tag.rsplit("}", 1)[-1] == "t")


def shared_strings(archive: zipfile.ZipFile) -> list[str]:
    try:
        root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    return [xml_text(item) for item in root if item.tag.rsplit("}", 1)[-1] == "si"]


def xlsx_cell_value(cell: ElementTree.Element, strings: list[str]) -> str:
    cell_type = cell.get("t")
    if cell_type == "inlineStr":
        inline_string = xml_child(cell, "is")
        return "" if inline_string is None else xml_text(inline_string)
    value = xml_child(cell, "v")
    if value is None or not (raw_value := value.text or ""):
        return ""
    if cell_type != "s":
        return raw_value
    try:
        index = int(raw_value.strip())
        return strings[index] if 0 <= index < len(strings) else raw_value
    except ValueError:
        return raw_value


def literal_xlsx_cell(cell: ElementTree.Element, strings: list[str]) -> bool:
    return xml_child(cell, "f") is None and bool(xlsx_cell_value(cell, strings))


def formula_xlsx_cache_rule(cell: ElementTree.Element, strings: list[str]) -> str | None:
    value = xml_child(cell, "v")
    if xml_child(cell, "f") is None or value is None or not (value.text or ""):
        return None
    cached = xlsx_cell_value(cell, strings)
    if cell.get("t") == "e" or cached in FORMULA_ERROR_VALUES:
        return "formula XLSX worksheet error cache"
    if PARTICIPANT_FORMULA_CACHE_PATTERN.search(cached):
        return "possible participant formula cache"
    return "nonempty XLSX formula cache"


def scan_xlsx_bytes(path: str, content: bytes, denylist: tuple[bytes, ...] = ()) -> list[Finding]:
    findings: list[Finding] = []
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        for member in archive.infolist():
            if not member.is_dir():
                findings.extend(scan_bytes(f"{path}:{member.filename}", archive.read(member), denylist))
        strings = shared_strings(archive)
        for member in archive.namelist():
            if not member.startswith("xl/worksheets/") or not member.endswith(".xml"):
                continue
            root = ElementTree.fromstring(archive.read(member))
            rows = [element for element in root.iter() if element.tag.rsplit("}", 1)[-1] == "row"]
            for position, row in enumerate(rows, start=1):
                try:
                    row_number = int(row.get("r", str(position)))
                except ValueError:
                    row_number = position
                if row_number <= 1:
                    continue
                for cell in (child for child in row if child.tag.rsplit("}", 1)[-1] == "c"):
                    if formula_rule := formula_xlsx_cache_rule(cell, strings):
                        findings.append(Finding(f"{path}:{member}", formula_rule))
                    elif literal_xlsx_cell(cell, strings):
                        findings.append(Finding(f"{path}:{member}", "literal XLSX worksheet cell"))
    return findings


def scan_xlsx(path: Path, denylist: tuple[bytes, ...] = ()) -> list[Finding]:
    return scan_xlsx_bytes(str(path), path.read_bytes(), denylist)


def git_output(*args: str) -> bytes:
    return subprocess.run(git_command(*args), check=True, capture_output=True).stdout


def git_command(*args: str) -> list[str]:
    return ["git", "-c", f"safe.directory={Path.cwd().resolve().as_posix()}", *args]


def tracked_files() -> list[Path]:
    return [Path(item.decode()) for item in git_output("ls-files", "-z").split(b"\0") if item]


def reachable_git_objects() -> list[tuple[bytes, bytes, bytes, bytes]]:
    listed = [line.partition(b" ") for line in git_output("rev-list", "--objects", "--all").splitlines()]
    object_ids = [object_id for object_id, _, _ in listed]
    output = subprocess.run(
        git_command("cat-file", "--batch"),
        input=b"\n".join(object_ids) + b"\n",
        check=True,
        capture_output=True,
    ).stdout
    stream = io.BytesIO(output)
    objects = []
    for (object_id, _, path) in listed:
        returned_id, object_type, size = stream.readline().rstrip(b"\n").split()
        if returned_id != object_id:
            raise ValueError("git cat-file returned objects out of order")
        content = stream.read(int(size))
        if stream.read(1) != b"\n":
            raise ValueError("git cat-file returned malformed object data")
        objects.append((object_id, object_type, path, content))
    return objects


def artifact_suffixes_by_object() -> dict[bytes, set[str]]:
    suffixes: dict[bytes, set[str]] = {}
    for commit in git_output("rev-list", "--all").splitlines():
        for entry in git_output("ls-tree", "-r", "-z", commit.decode()).split(b"\0"):
            if not entry:
                continue
            metadata, path = entry.split(b"\t", 1)
            _, object_type, object_id = metadata.split()
            suffix = Path(os.fsdecode(path)).suffix.lower()
            if object_type == b"blob" and suffix in DATA_ARTIFACT_SUFFIXES | {".xlsx"}:
                suffixes.setdefault(object_id, set()).add(suffix)
    return suffixes


def scan_git_history(denylist: tuple[bytes, ...] = ()) -> list[Finding]:
    if git_output("for-each-ref", "--format=%(refname)", "refs/replace").strip():
        return [Finding("git refs", "replacement ref present")]
    findings: list[Finding] = []
    artifact_suffixes = artifact_suffixes_by_object()
    for object_id, object_type, path, content in reachable_git_objects():
        suffix = Path(os.fsdecode(path)).suffix.lower() if path else ""
        object_suffixes = set(artifact_suffixes.get(object_id, ()))
        if suffix in DATA_ARTIFACT_SUFFIXES | {".xlsx"}:
            object_suffixes.add(suffix)
        safe_suffix = next((item for item in sorted(object_suffixes) if item in DATA_ARTIFACT_SUFFIXES), "")
        if not safe_suffix and ".xlsx" in object_suffixes:
            safe_suffix = ".xlsx"
        label = f"git {object_type.decode()} {object_id.decode()}{safe_suffix}"
        findings.extend(scan_bytes(label, content, denylist))
        if path:
            findings.extend(scan_bytes(f"{label} path", path, denylist))
        workbook = ".xlsx" in object_suffixes
        if object_type == b"blob" and not workbook and content.startswith(b"PK"):
            try:
                with zipfile.ZipFile(io.BytesIO(content)) as archive:
                    workbook = any(
                        name.startswith("xl/worksheets/") and name.endswith(".xml")
                        for name in archive.namelist()
                    )
            except zipfile.BadZipFile:
                pass
        if object_type == b"blob" and workbook:
            findings.extend(scan_xlsx_bytes(label, content, denylist))
    return findings


def load_denylist() -> tuple[bytes, ...]:
    value = os.environ.get("AM_PRIVATE_DENYLIST", "").strip()
    release_mode = os.environ.get("AM_RELEASE_MODE", "").lower() in {"1", "true", "yes"}
    if not value:
        if release_mode:
            raise ValueError("AM_PRIVATE_DENYLIST is required in release mode")
        return ()
    denylist_path = Path(value)
    if not denylist_path.is_file():
        raise ValueError("AM_PRIVATE_DENYLIST must point to a readable file")
    try:
        entries = tuple(line for line in denylist_path.read_bytes().splitlines() if line.strip())
    except OSError as error:
        raise ValueError("AM_PRIVATE_DENYLIST must point to a readable file") from error
    if release_mode and not entries:
        raise ValueError("AM_PRIVATE_DENYLIST must contain nonblank entries in release mode")
    if subprocess.run(git_command("check-ignore", "--quiet", str(denylist_path))).returncode:
        raise ValueError("AM_PRIVATE_DENYLIST must point to an ignored file")
    return entries


def scan_repository() -> list[Finding]:
    findings: list[Finding] = []
    denylist = load_denylist()
    for path in tracked_files():
        if path.suffix.lower() == ".xlsx":
            findings.extend(scan_xlsx(path, denylist))
        else:
            findings.extend(scan_bytes(str(path), path.read_bytes(), denylist))
    findings.extend(scan_git_history(denylist))
    return findings


def main() -> int:
    findings = scan_repository()
    if findings:
        for finding in findings:
            print(f"{finding.path}: {finding.rule}")
        return 1
    print("repository safety check passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
