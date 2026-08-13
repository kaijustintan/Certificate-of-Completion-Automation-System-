// tools/callable-surface.js
/*
  FILE: callable-surface.js
  LAYMAN (Tropang Ex):
  Bantay ng "pintuan" ng backend. Sa Apps Script, LAHAT ng top-level function
  na walang trailing underscore ay direktang matatawag ng kahit sinong naka-
  sign-in user mula sa browser console (google.script.run.fnName). Ang script
  na ito ang nagbibilang kung ilan ang nakabukas na pinto, para mahuli agad
  kung may bagong function na aksidenteng naging public.

  TECHNICAL:
  Static scan of backend/*.js. A function is COUNTED as callable when it is
  declared at column 0 (top-level only; nested declarations are indented) via
  either `function name(` or `const name = function` / `const name = (`, and
  the name does NOT end with an underscore. Comments and string literals are
  stripped first so doc blocks never miscount. Exits 1 when the count differs
  from EXPECTED, so it can run as a pre-push gate.

  USAGE:
    node tools/callable-surface.js            # pass/fail vs EXPECTED
    node tools/callable-surface.js --list     # print every callable name
*/

const fs = require("fs");
const path = require("path");

// The intentional public API. Update this ONLY when a callable is deliberately
// added or removed, in the same commit, with a note in the commit message.
const EXPECTED = 27;

const BACKEND = path.join(__dirname, "..", "backend");

// Strip /* */ and // comments plus string/template literals, preserving
// newlines so column-0 detection still works line by line.
function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  let mode = "code"; // code | line | block | sq | dq | tpl
  while (i < n) {
    const c = src[i];
    const c2 = src.substr(i, 2);
    if (mode === "code") {
      if (c2 === "//") { mode = "line"; i += 2; continue; }
      if (c2 === "/*") { mode = "block"; i += 2; continue; }
      if (c === "'") { mode = "sq"; out += c; i++; continue; }
      if (c === '"') { mode = "dq"; out += c; i++; continue; }
      if (c === "`") { mode = "tpl"; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (mode === "line") {
      if (c === "\n") { mode = "code"; out += c; }
      i++; continue;
    }
    if (mode === "block") {
      if (c === "\n") out += c; // keep line count stable
      if (c2 === "*/") { mode = "code"; i += 2; continue; }
      i++; continue;
    }
    // string modes: keep escapes opaque, keep newlines for templates
    if (c === "\\") { out += "??"; i += 2; continue; }
    if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"') || (mode === "tpl" && c === "`")) {
      mode = "code"; out += c; i++; continue;
    }
    out += (c === "\n") ? c : "?";
    i++;
  }
  return out;
}

const callables = [];
const hidden = [];
for (const file of fs.readdirSync(BACKEND).filter(f => f.endsWith(".js")).sort()) {
  const src = stripComments(fs.readFileSync(path.join(BACKEND, file), "utf8"));
  for (const line of src.split("\n")) {
    // Column-0 declarations only: nested functions are always indented.
    let m = line.match(/^function\s+([A-Za-z_$][\w$]*)\s*\(/) ||
            line.match(/^(?:const|var|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:function\b|\()/);
    if (!m) continue;
    const name = m[1];
    // `const X = (` also matches plain value groups; require an arrow or
    // function keyword somewhere on the line for the assignment form.
    if (!/^function/.test(line) && !/=>|function\b/.test(line)) continue;
    (name.endsWith("_") ? hidden : callables).push(`${name}  (${file})`);
  }
}

const list = process.argv.includes("--list");
if (list) {
  console.log(`CALLABLE (${callables.length}):`);
  callables.forEach(c => console.log("  " + c));
  console.log(`\nHIDDEN via trailing underscore (${hidden.length})`);
}

if (callables.length !== EXPECTED) {
  console.error(`FAIL: callable surface is ${callables.length}, expected ${EXPECTED}.`);
  if (!list) {
    console.error("Run with --list to see the full set. If the change is deliberate,");
    console.error("update EXPECTED in tools/callable-surface.js in the same commit.");
  }
  process.exit(1);
}
console.log(`OK: callable surface is exactly ${EXPECTED} bare top-level functions.`);
