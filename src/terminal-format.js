// 终端文本对齐工具：等宽终端里 CJK/全角/emoji 占 2 列，ANSI 颜色码占 0 列。
// 所有 CLI 表格统一用 displayWidth/padDisplay 排版，避免名字长短不一导致列错位。

// ANSI 颜色码不占显示宽度
const ANSI_RE = /\x1b\[[0-9;]*m/g;

// 终端里按 2 列显示宽度的字符区间（CJK/全角/emoji 等）
function isWideCode(code) {
  return (
    (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
    (code >= 0x2e80 && code <= 0x303e) || // CJK Radicals .. CJK Symbols/Punct
    (code >= 0x3041 && code <= 0x33ff) || // Hiragana .. CJK Compat
    (code >= 0x3400 && code <= 0x4dbf) || // CJK Ext A
    (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified
    (code >= 0xa000 && code <= 0xa4cf) || // Yi
    (code >= 0xac00 && code <= 0xd7a3) || // Hangul Syllables
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) || // Fullwidth Forms
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) || // Emoji
    (code >= 0x20000 && code <= 0x3fffd)
  );
}

/**
 * 字符串在等宽终端中的显示宽度。
 * CJK/全角/emoji 算 2 列，ANSI 颜色码不计入。
 */
function displayWidth(text) {
  const clean = String(text).replace(ANSI_RE, "");
  let width = 0;
  for (const ch of clean) {
    width += isWideCode(ch.codePointAt(0)) ? 2 : 1;
  }
  return width;
}

/**
 * 按显示宽度右侧补齐空格到 width 列，让表格列真正对齐。
 * 返回原字符串（若本身已达/超过宽度，不做截断）。
 */
function padDisplay(text, width) {
  const diff = width - displayWidth(text);
  return diff > 0 ? text + " ".repeat(diff) : text;
}

module.exports = { ANSI_RE, displayWidth, isWideCode, padDisplay };
