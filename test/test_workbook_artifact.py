from __future__ import annotations

import re
import unittest
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


WORKBOOK = Path(__file__).resolve().parents[1] / "templates" / "angel-mortal-empty.xlsx"
NS = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL_NS = {"r": "http://schemas.openxmlformats.org/package/2006/relationships"}
DOC_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"

FORM_HEADERS = [
    "Timestamp",
    "What’s your name? 👀",
    "Gender?",
    "What’s your room no.! [#LL-RRR]🤌",
    "What’s your tele handle? [@…] 💅",
    "What’s your tele Telegram user id?",
    "What’s your year of study?",
    "Which faculty are you from!",
    "Share some of your interests! ✍️",
    "Do you have any special requirements? (e.g. allergies, etc.)",
    "Any gender preference for A&M? 🤔",
    "Angel and Mortal (welfare only) or Devil and Mortal (welfare and pranks)?",
    "Level of Prank Tolerance",
    "Are you okay with your devil entering your room?",
    "Please specify any boundaries/things that are off limits for your devil [Tick to indicate OFF LIMIT]",
    "I have looked through and understood the rules of this event and agree to respect the boundaries set by my mortal.",
]

ROSTER_HEADERS = [
    "Participant Key",
    "Name",
    "Room",
    "Mode Requested",
    "Prank Tolerance",
    "Gender Preference",
    "Mortal",
    "Mortal Prank Tolerance",
    "Role to Mortal",
    "Assignment Fit",
    "Assigned Angel/Devil",
    "Pairing Status",
    "Pairing Issues",
    "Telegram ID",
    "PersonID",
    "Intro",
    "Form Row",
    "Signup Time",
    "Angel Bot Started At",
    "Mortal Bot Started At",
    "Form Validation Issues",
]

FORMULA_COLUMNS = {1, 2, 3, 4, 5, 6, *range(8, 19), 21}
FORM_SOURCE_COLUMNS = {1, 2, 3, 4, 5, 6, 14, 15, 16, 17, 18, 21}
MANUAL_COLUMNS = {7, 19, 20}
PRIVATE_PATTERN = re.compile(
    r"AKfycb|workers\.dev|Angel Mortal Roster - Snapshot|@[A-Za-z0-9_]{3,}|\b\d{5,20}\b|"
    r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"
)


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def column_number(cell_reference: str) -> int:
    letters = re.match(r"[A-Z]+", cell_reference).group(0)
    result = 0
    for letter in letters:
        result = result * 26 + ord(letter) - 64
    return result


def shared_strings(archive: zipfile.ZipFile) -> list[str]:
    try:
        root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    return ["".join(item.itertext()) for item in root if local_name(item.tag) == "si"]


def cell_text(cell: ET.Element, strings: list[str]) -> str:
    if cell.get("t") == "inlineStr":
        inline = next((child for child in cell if local_name(child.tag) == "is"), None)
        return "" if inline is None else "".join(inline.itertext())
    value = next((child for child in cell if local_name(child.tag) == "v"), None)
    raw = "" if value is None else (value.text or "")
    if cell.get("t") == "s" and raw:
        return strings[int(raw)]
    return raw


def formula_text(cell: ET.Element) -> str:
    formula = next((child for child in cell if local_name(child.tag) == "f"), None)
    return "" if formula is None else (formula.text or "")


class EmptyWorkbookArtifactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if not WORKBOOK.is_file():
            raise AssertionError(f"missing workbook artifact: {WORKBOOK}")
        cls.archive = zipfile.ZipFile(WORKBOOK)
        cls.strings = shared_strings(cls.archive)

        workbook = ET.fromstring(cls.archive.read("xl/workbook.xml"))
        relationships = ET.fromstring(cls.archive.read("xl/_rels/workbook.xml.rels"))
        targets = {
            rel.get("Id"): rel.get("Target")
            for rel in relationships.findall("r:Relationship", REL_NS)
        }
        cls.sheet_names = []
        cls.sheets = {}
        for sheet in workbook.find("x:sheets", NS):
            name = sheet.get("name")
            target = targets[sheet.get(DOC_REL)].lstrip("/")
            if not target.startswith("xl/"):
                target = "xl/" + target
            cls.sheet_names.append(name)
            cls.sheets[name] = ET.fromstring(cls.archive.read(target))

    @classmethod
    def tearDownClass(cls) -> None:
        cls.archive.close()

    def cells(self, sheet_name: str) -> dict[str, ET.Element]:
        return {
            cell.get("r"): cell
            for cell in self.sheets[sheet_name].iter()
            if local_name(cell.tag) == "c"
        }

    def row_values(self, sheet_name: str, row_number: int, width: int) -> list[str]:
        cells = self.cells(sheet_name)
        return [cell_text(cells.get(f"{chr(64 + column)}{row_number}", ET.Element("c")), self.strings) for column in range(1, width + 1)]

    def comment_payload(self) -> str:
        return "\n".join(
            self.archive.read(name).decode("utf-8", errors="ignore")
            for name in self.archive.namelist()
            if "comment" in name.lower() or "person" in name.lower()
        )

    def test_sheet_order_and_exact_headers(self) -> None:
        self.assertEqual(self.sheet_names, ["Form Responses 1", "Angel Mortal Roster"])
        self.assertEqual(self.row_values("Form Responses 1", 1, 16), FORM_HEADERS)
        self.assertEqual(self.row_values("Angel Mortal Roster", 1, 21), ROSTER_HEADERS)

    def test_form_response_sheet_has_only_its_header(self) -> None:
        for reference, cell in self.cells("Form Responses 1").items():
            if int(re.search(r"\d+", reference).group(0)) > 1:
                self.assertEqual(formula_text(cell), "", reference)
                self.assertEqual(cell_text(cell, self.strings), "", reference)

    def test_roster_has_only_eighteen_row_two_formula_anchors(self) -> None:
        cells = self.cells("Angel Mortal Roster")
        formula_cells = {reference: formula_text(cell) for reference, cell in cells.items() if formula_text(cell)}
        expected = {f"{chr(64 + column)}2" for column in FORMULA_COLUMNS}
        self.assertEqual(set(formula_cells), expected)
        for reference, formula in formula_cells.items():
            if column_number(reference) in FORM_SOURCE_COLUMNS:
                self.assertIn("Form Responses 1", formula, reference)
            cached = cell_text(cells[reference], self.strings)
            self.assertEqual(cached, "", f"{reference} formula cache must be empty")
        for column in MANUAL_COLUMNS:
            reference = f"{chr(64 + column)}2"
            cell = cells.get(reference)
            self.assertTrue(cell is None or (not formula_text(cell) and not cell_text(cell, self.strings)), reference)

    def test_roster_formulas_embed_edge_normalization_contract(self) -> None:
        cells = self.cells("Angel Mortal Roster")

        def formula(reference: str) -> str:
            return re.sub(r"_xlfn(?:\._xlws)?\.", "", formula_text(cells[reference]))

        whitespace = "[" + "".join(
            f"\\x{{{codepoint:x}}}" for codepoint in (
                9, 10, 11, 12, 13, 32, 133, 160, 5760, *range(8192, 8203),
                8232, 8233, 8239, 8287, 12288, 65279,
            )
        ) + "]"

        def edge_trim(source: str) -> str:
            return f'REGEXREPLACE(TO_TEXT(INDIRECT("\'Form Responses 1\'!{source}")),"^{whitespace}+|{whitespace}+$","")'

        expected_sources = {
            "A2": ["B2:B"],
            "B2": ["B2:B"],
            "C2": ["D2:D"],
            "D2": ["L2:L"],
            "E2": ["M2:M"],
            "F2": ["K2:K"],
            "P2": ["G2:G", "H2:H", "I2:I", "J2:J", "L2:L", "M2:M", "N2:N", "O2:O"],
            "U2": ["B2:B", "D2:D", "L2:L", "P2:P", "M2:M", "N2:N"],
        }
        for reference, sources in expected_sources.items():
            for source in sources:
                self.assertIn(edge_trim(source), formula(reference), f"{reference} must edge-trim {source}")

        self.assertNotIn("LOWER(TRIM(", formula("U2"))
        self.assertNotIn(edge_trim("A2:A"), formula("R2"))
        self.assertIn(
            f'REGEXREPLACE(TO_TEXT(INDIRECT("\'Form Responses 1\'!F2:F")),"{whitespace}","")',
            formula("N2"),
        )

        self.assertIn("SUMPRODUCT(N(EXACT($G$2:$G,participantKey)),N($A$2:$A<>\"\")", formula("K2"))
        self.assertIn("Devil response needs boundaries", formula("U2"))

    def test_source_ranges_are_insertion_stable_string_references(self) -> None:
        for reference, cell in self.cells("Angel Mortal Roster").items():
            formula = formula_text(cell)
            if not formula or column_number(reference) not in FORM_SOURCE_COLUMNS:
                continue
            self.assertIn('INDIRECT("\'Form Responses 1\'!', formula, reference)
            # Every source A1 range must occur inside an INDIRECT string argument.
            without_indirect = re.sub(r'INDIRECT\("\'Form Responses 1\'![A-Z]+2:[A-Z]+"\)', '', formula)
            self.assertNotIn("'Form Responses 1'!", without_indirect, reference)

    def test_roster_has_no_literal_data_or_copied_formulas(self) -> None:
        for reference, cell in self.cells("Angel Mortal Roster").items():
            row = int(re.search(r"\d+", reference).group(0))
            if row <= 1:
                continue
            formula = formula_text(cell)
            value = cell_text(cell, self.strings)
            self.assertFalse(value and not formula, reference)
            if formula:
                self.assertEqual(row, 2, reference)

    def test_freeze_panes_hidden_columns_and_header_styles(self) -> None:
        for name in self.sheet_names:
            pane = self.sheets[name].find(".//x:pane", NS)
            if pane is None:
                self.assertIn("cannot preserve freeze-pane metadata", self.comment_payload())
                continue
            self.assertEqual(pane.get("state"), "frozen", name)
            self.assertEqual(pane.get("ySplit"), "1", name)

        roster = self.sheets["Angel Mortal Roster"]
        hidden = set()
        for column in roster.findall(".//x:cols/x:col", NS):
            if column.get("hidden") == "1" or float(column.get("width", "1")) <= 0.13:
                hidden.update(range(int(column.get("min")), int(column.get("max")) + 1))
        self.assertTrue({15, 17, 21}.issubset(hidden))
        self.assertTrue(MANUAL_COLUMNS.isdisjoint(hidden))

        cells = self.cells("Angel Mortal Roster")
        general_style = int(cells["A1"].get("s", "0"))
        g_style = int(cells["G1"].get("s", "0"))
        j_style = int(cells["J1"].get("s", "0"))
        self.assertNotEqual(general_style, 0)
        self.assertEqual(len({general_style, g_style, j_style}), 3)
        styles = ET.fromstring(self.archive.read("xl/styles.xml"))
        fills = styles.find("x:fills", NS)
        fonts = styles.find("x:fonts", NS)
        xfs = styles.find("x:cellXfs", NS)
        fill_colors = []
        font_colors = []
        for style_id in (general_style, g_style, j_style):
            xf = xfs[style_id]
            fill = fills[int(xf.get("fillId"))]
            font = fonts[int(xf.get("fontId"))]
            fill_colors.append("".join(node.get("rgb", "") for node in fill.iter() if local_name(node.tag) == "fgColor").upper())
            font_colors.append("".join(node.get("rgb", "") for node in font.iter() if local_name(node.tag) == "color").upper())
        self.assertTrue(fill_colors[0].endswith("D9EAD3"))
        self.assertTrue(fill_colors[1].endswith("F1C232"))
        self.assertTrue(fill_colors[2].endswith("674EA7"))
        self.assertTrue(font_colors[2].endswith("FFFFFF"))

    def test_notes_validation_conditional_formatting_and_optional_filter(self) -> None:
        comment_payload = self.comment_payload()
        for text in ("append-only", "Organizer input", "prank-tolerance", "Ready requires", "Formula-driven", "Organizer"):
            self.assertIn(text, comment_payload)

        roster = self.sheets["Angel Mortal Roster"]
        validations = roster.findall(".//x:dataValidation", NS)
        self.assertEqual(len(validations), 1)
        validation = validations[0]
        self.assertEqual(validation.get("type"), "list")
        self.assertEqual(validation.get("sqref"), "G2:G1000")
        self.assertEqual(validation.get("allowBlank"), "1")
        self.assertNotEqual(validation.get("showErrorMessage"), "0")
        formula1 = validation.find("x:formula1", NS)
        self.assertIsNotNone(formula1)
        self.assertIn("$A$2:$A$1000", formula1.text or "")

        rules = roster.findall(".//x:cfRule", NS)
        formulas = ["".join(rule.itertext()) for rule in rules]
        for fragment in ("GOOD|READY", "^CHECK", "UNASSIGNED|INVALID|MISMATCH", '$L2="Ready"', '$L2="Review"'):
            self.assertTrue(any(fragment in formula for formula in formulas), fragment)
        conditional_ranges = " ".join(
            element.get("sqref", "") for element in roster.findall(".//x:conditionalFormatting", NS)
        )
        for expected_range in ("G2:G1000", "J2:J1000", "L2:L1000"):
            self.assertIn(expected_range, conditional_ranges)

        auto_filter = roster.find("x:autoFilter", NS)
        if auto_filter is not None:
            self.assertEqual(auto_filter.get("ref"), "A1:U1000")

    def test_no_private_or_participant_content_anywhere(self) -> None:
        semantic_text = list(self.strings)
        for sheet_name in self.sheet_names:
            for cell in self.cells(sheet_name).values():
                semantic_text.extend((cell_text(cell, self.strings), formula_text(cell)))
        for name in self.archive.namelist():
            if name.startswith("xl/threadedcomments/"):
                root = ET.fromstring(self.archive.read(name))
                semantic_text.extend(text for text in root.itertext() if text)
            elif name.startswith("xl/persons/"):
                root = ET.fromstring(self.archive.read(name))
                semantic_text.extend(value for element in root.iter() for value in element.attrib.values())
        self.assertIsNone(PRIVATE_PATTERN.search("\n".join(semantic_text)))


if __name__ == "__main__":
    unittest.main()
