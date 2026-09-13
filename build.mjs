import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const files = [
  "FormSetup.gs",
  "GuessFormSetup.gs",
  "Config.gs",
  "FormImport.gs",
  "Storage.gs",
  "Telegram.gs",
  "Game.gs",
  "Admin.gs",
  "Code.gs"
];
const schema = JSON.parse(fs.readFileSync(path.join(root, "config", "form-schema.json"), "utf8"));
if (!schema || typeof schema.title !== "string" || !Array.isArray(schema.sections) || !Array.isArray(schema.questions)) {
  throw new Error("config/form-schema.json must define a title, sections, and questions.");
}
const schemaSource = `var FORM_SCHEMA = Object.freeze(${JSON.stringify(schema)});\n`;
const outputDirectory = path.join(root, "dist");
fs.mkdirSync(outputDirectory, {recursive: true});
const sources = files.map(file => ({file, source: fs.readFileSync(path.join(root, file), "utf8").trim()}));
const combined = schemaSource + "\n" + sources.map(({file, source}) => `// ===== ${file} =====\n${source}\n`).join("\n");
fs.writeFileSync(path.join(outputDirectory, "Code.gs"), combined, "utf8");
process.stdout.write(`Built dist/Code.gs from ${files.length} source files.\n`);
