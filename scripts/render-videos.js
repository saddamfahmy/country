const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const inputDirectory = path.join(root, "public", "kata");
const outputDirectory = path.join(root, "renders");
const entryPoint = path.join("src", "index.js");
const force = process.argv.includes("--force");
const dryRun = process.argv.includes("--dry-run");
const onlyArgIndex = process.argv.findIndex((arg) => arg === "--only");
const onlyValue = onlyArgIndex >= 0
  ? process.argv[onlyArgIndex + 1]
  : process.argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length);

const toCompositionId = (filename) => {
  const name = path.basename(filename, path.extname(filename));
  const compositionName = name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return `MapAnimation-${compositionName}`;
};

const getKataFiles = () => {
  try {
    return fs.readdirSync(inputDirectory)
      .filter((filename) => filename.toLowerCase().endsWith(".json"))
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    if (error.code === "ENOENT") {
      console.warn(`No kata directory found at ${inputDirectory}; nothing to render.`);
      return [];
    }
    throw error;
  }
};

const kataFiles = getKataFiles();
if (kataFiles.length === 0) {
  console.warn("No kata JSON files found; nothing to render.");
  process.exit(0);
}

const selectedFiles = onlyValue
  ? kataFiles.filter((filename) => {
      const compositionId = toCompositionId(filename);
      return filename.toLowerCase() === `${onlyValue.toLowerCase()}.json` ||
        path.basename(filename, ".json").toLowerCase() === onlyValue.toLowerCase() ||
        compositionId.toLowerCase() === onlyValue.toLowerCase();
    })
  : kataFiles;

if (onlyValue && selectedFiles.length === 0) {
  console.error(`No kata JSON matches "--only ${onlyValue}". Available: ${kataFiles.join(", ")}`);
  process.exit(1);
}

if (!dryRun) {
  fs.mkdirSync(outputDirectory, { recursive: true });
}

const remotionCli = path.join(
  path.dirname(require.resolve("@remotion/cli/package.json")),
  "remotion-cli.js"
);
const results = [];

for (const filename of selectedFiles) {
  const compositionId = toCompositionId(filename);
  const outputFilename = `${path.basename(filename, ".json")}.mp4`;
  const outputPath = path.join(outputDirectory, outputFilename);
  const temporaryOutputPath = path.join(outputDirectory, `${path.basename(filename, ".json")}.partial.mp4`);

  try {
    const input = JSON.parse(fs.readFileSync(path.join(inputDirectory, filename), "utf8"));
    if (!Array.isArray(input.route) || input.route.length === 0) {
      throw new Error("JSON must contain a non-empty route array.");
    }
  } catch (error) {
    console.error(`Skipping ${filename}: invalid or incomplete JSON (${error.message}).`);
    results.push({ filename, status: "failed" });
    continue;
  }

  if (!force && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
    console.log(`Skipping ${filename}; completed video already exists: ${path.relative(root, outputPath)}`);
    results.push({ filename, status: "skipped" });
    continue;
  }

  const args = [
    remotionCli,
    "render",
    entryPoint,
    compositionId,
    temporaryOutputPath,
    "--codec",
    "h264",
    "--crf",
    "20",
    "--concurrency",
    "2",
    "--overwrite",
    "--log",
    "warn",
  ];

  console.log(`${dryRun ? "[dry-run] " : ""}Rendering ${filename} -> ${path.relative(root, outputPath)}`);
  if (dryRun) {
    console.log(`  node ${args.map((arg) => JSON.stringify(arg)).join(" ")}`);
    results.push({ filename, status: "planned" });
    continue;
  }

  try {
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Remotion exited with status ${result.status ?? "unknown"}.`);
    }
    if (!fs.existsSync(temporaryOutputPath) || fs.statSync(temporaryOutputPath).size === 0) {
      throw new Error("Render completed without producing a non-empty video file.");
    }

    fs.rmSync(outputPath, { force: true });
    fs.renameSync(temporaryOutputPath, outputPath);
    results.push({ filename, status: "rendered" });
    console.log(`Finished ${filename}.`);
  } catch (error) {
    fs.rmSync(temporaryOutputPath, { force: true });
    console.error(`Failed to render ${filename}: ${error.message}`);
    results.push({ filename, status: "failed" });
  }
}

const rendered = results.filter((result) => result.status === "rendered").length;
const skipped = results.filter((result) => result.status === "skipped").length;
const failed = results.filter((result) => result.status === "failed");
console.log(`Render summary: ${rendered} rendered, ${skipped} already complete, ${failed.length} failed.`);

if (failed.length > 0) {
  console.error(`Failed inputs: ${failed.map((result) => result.filename).join(", ")}`);
  process.exitCode = 1;
}
