const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const browserCoreModules = [
  "src/constants.js",
  "src/random.js",
  "src/cards.js",
  "src/hand-evaluator.js",
  "src/actions.js",
  "src/player.js",
  "src/bot-player.js",
  "src/game-engine.js",
];
const htmlPath = path.join(rootDir, "index.html");

const startMarker = "      // POKER_CORE_START: generated from poker.js";
const endMarker = "      // POKER_CORE_END";

function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function stripCommonJs(source, moduleName) {
  const withoutRequires = source.replace(/^const .+ require\(.+\);\r?\n/gm, "");
  const withoutExports = withoutRequires.replace(/\r?\nmodule\.exports = \{[\s\S]*?\};\s*$/, "");
  if (withoutExports === source) {
    throw new Error(`Could not strip CommonJS wrapper from ${moduleName}`);
  }
  return withoutExports.trimEnd();
}

function buildCore() {
  return browserCoreModules
    .map((modulePath) => stripCommonJs(readUtf8(path.join(rootDir, modulePath)), modulePath))
    .join("\n\n")
    .replace(/<\/script/gi, "<\\/script");
}

function indentForHtml(source) {
  return source
    .split(/\r?\n/)
    .map((line) => (line ? `      ${line}` : ""))
    .join("\n");
}

function replaceGeneratedCore(html, generatedCore) {
  const markedStart = html.indexOf(startMarker);
  const markedEnd = html.indexOf(endMarker);
  if (markedStart !== -1 || markedEnd !== -1) {
    if (markedStart === -1 || markedEnd === -1 || markedEnd < markedStart) {
      throw new Error("Invalid generated core markers in index.html");
    }
    const before = html.slice(0, markedStart);
    const after = html.slice(markedEnd + endMarker.length);
    return `${before}${startMarker}\n${generatedCore}\n${endMarker}${after}`;
  }

  const scriptMatch = html.match(/<script>\r?\n/);
  if (!scriptMatch || scriptMatch.index === undefined) {
    throw new Error("Could not find inline script start in index.html");
  }
  const coreStart = scriptMatch.index + scriptMatch[0].length;
  const uiStartMatch = /\r?\n\s*const UI_TEXT = \{/.exec(html);
  if (!uiStartMatch || uiStartMatch.index === undefined || uiStartMatch.index <= coreStart) {
    throw new Error("Could not find browser UI boundary in index.html");
  }
  const uiStart = uiStartMatch.index;
  return `${html.slice(0, coreStart)}${startMarker}\n${generatedCore}\n${endMarker}${html.slice(uiStart)}`;
}

const htmlSource = readUtf8(htmlPath);
const generatedCore = indentForHtml(buildCore());
const nextHtml = replaceGeneratedCore(htmlSource, generatedCore);

fs.writeFileSync(htmlPath, nextHtml, "utf8");
console.log("Updated index.html from src browser core modules");
