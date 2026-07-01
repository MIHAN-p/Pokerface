const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const pokerPath = path.join(rootDir, "poker.js");
const htmlPath = path.join(rootDir, "index.html");

const startMarker = "      // POKER_CORE_START: generated from poker.js";
const endMarker = "      // POKER_CORE_END";

function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function extractCore(source) {
  const withoutNodeImports = source.replace(
    /^const readline = require\("node:readline\/promises"\);\r?\nconst \{ stdin: input, stdout: output \} = require\("node:process"\);\r?\n\r?\n/,
    "",
  );
  const cliStart = withoutNodeImports.search(/\r?\nasync function askInt\(/);
  if (cliStart === -1) {
    throw new Error("Could not find CLI helper boundary in poker.js");
  }
  return withoutNodeImports.slice(0, cliStart).trimEnd().replace(/<\/script/gi, "<\\/script");
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

const pokerSource = readUtf8(pokerPath);
const htmlSource = readUtf8(htmlPath);
const generatedCore = indentForHtml(extractCore(pokerSource));
const nextHtml = replaceGeneratedCore(htmlSource, generatedCore);

fs.writeFileSync(htmlPath, nextHtml, "utf8");
console.log("Updated index.html from poker.js");
