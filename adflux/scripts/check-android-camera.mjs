// scripts/check-android-camera.mjs
//
// ANDROID CAMERA TRIPWIRE (APK 96019, 2026-10-02).
//
// WHY THIS EXISTS:
// The lead "Scan card" button (and the Ops photo buttons) use a plain web
// <input type="file" accept="image/*" capture="environment">. Inside the
// Capacitor Android WebView that only opens the camera if TWO native pieces
// are in place; if either is missing Capacitor SILENTLY falls back to the file
// picker (no error shown to the rep):
//   1. res/xml/file_paths.xml must have an <external-files-path> covering
//      Pictures/ . Capacitor writes the photo to
//      getExternalFilesDir(DIRECTORY_PICTURES) and asks our FileProvider for a
//      content:// URI. Phase 76.2.2 (92266b7, 2026-05-23) tightened the file
//      and dropped the only root that covered it -> "Unable to create
//      temporary media capture file" -> file picker.
//   2. AndroidManifest <queries> must list android.media.action.IMAGE_CAPTURE,
//      or on Android 11+ resolveActivity() returns null -> file picker.
// And one thing must NOT be there:
//   3. android.permission.CAMERA. If the manifest declares it, Android makes
//      the camera intent depend on a runtime grant and capture can be refused.
//
// This check makes the regression impossible to ship by accident. It is wired
// into the APK build paths ONLY (package.json cap:build:apk + release:apk and
// scripts/apk-prebuild-check.sh), never into the web "build" script.
//
// FAIL-SAFE CONTRACT (CLAUDE.md section 45 - never brick a build):
//   - A POSITIVELY-detected defect is the ONLY thing that exits 1.
//   - Any problem with this script itself (missing/garbled file, parse error)
//     prints a WARNING and exits 0. A broken tripwire must never block a build.
//
// Usage:
//   node scripts/check-android-camera.mjs
//   node scripts/check-android-camera.mjs --root /some/other/tree     (testing)
//   CHECK_ANDROID_CAMERA_ROOT=/some/other/tree node scripts/check-android-camera.mjs
// --root points at a folder shaped like the repo root (it must contain
// android/app/src/main/... and src/).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TAG = '[check-android-camera]'
let warnings = 0
const WARN = (m) => { warnings++; console.warn(`${TAG} WARN (not blocking): ${m}`) }
const findings = []

// ---------- root resolution ----------
function resolveRoot() {
  const argv = process.argv.slice(2)
  let root = process.env.CHECK_ANDROID_CAMERA_ROOT || ''
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root' && argv[i + 1]) root = argv[++i]
    else if (argv[i].startsWith('--root=')) root = argv[i].slice('--root='.length)
  }
  if (root) return path.resolve(root)
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
}

// ---------- small text helpers ----------
const stripXmlComments = (x) => x.replace(/<!--[\s\S]*?-->/g, '')
// Blank (not delete) JS comments so line numbers stay correct. Must be
// string-aware: accept="image/*" contains "/*", and a naive /\/\*[\s\S]*?\*\//
// regex would swallow the following attributes (it did, in the first draft).
// Quoted strings end at the line end (so an apostrophe in JSX text can only
// confuse one line); template literals may span lines. Errors here can only
// MISS a comment (harmless), never invent a capture input.
function stripJsComments(code) {
  const n = code.length
  let out = ''
  let i = 0
  while (i < n) {
    const c = code[i]
    const d = code[i + 1]
    if (c === '/' && d === '/') {
      let j = code.indexOf('\n', i)
      if (j < 0) j = n
      out += ' '.repeat(j - i)
      i = j
    } else if (c === '/' && d === '*') {
      let j = code.indexOf('*/', i + 2)
      j = j < 0 ? n : j + 2
      out += code.slice(i, j).replace(/[^\n]/g, ' ')
      i = j
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1
      while (j < n && code[j] !== c && (c === '`' || code[j] !== '\n')) {
        if (code[j] === '\\') j++
        j++
      }
      j = Math.min(j + 1, n)
      out += code.slice(i, j)
      i = j
    } else {
      out += c
      i++
    }
  }
  return out
}

function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else if (ent.isFile() && /\.(jsx|js)$/.test(ent.name)) out.push(p)
  }
}

// ---------- tiny JSX/HTML <input ...> attribute parser ----------
// A regex like /<input[^>]*>/ breaks on onChange={e => ...} (the "=>" has a
// ">"), so walk the attributes properly: names, "quoted" values, {braced} values.
function skipString(code, i) {
  const q = code[i]
  i++
  while (i < code.length) {
    if (code[i] === '\\') { i += 2; continue }
    if (code[i] === q) return i + 1
    i++
  }
  return i
}
function skipBraces(code, i) {
  let depth = 0
  while (i < code.length) {
    const c = code[i]
    if (c === '"' || c === "'" || c === '`') { i = skipString(code, i); continue }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return i + 1 }
    i++
  }
  return i
}
// Returns Map(name -> value|true) or null if this is not a tag we understand.
function parseTagAttrs(code, i) {
  const attrs = new Map()
  while (i < code.length) {
    while (i < code.length && /\s/.test(code[i])) i++
    const c = code[i]
    if (c === '>') return attrs
    if (c === '/' && code[i + 1] === '>') return attrs
    if (c === '{') { i = skipBraces(code, i); continue } // {...spread}
    const m = /^[A-Za-z_:][\w:.-]*/.exec(code.slice(i, i + 100))
    if (!m) return null
    const name = m[0]
    i += name.length
    let j = i
    while (j < code.length && /\s/.test(code[j])) j++
    if (code[j] === '=') {
      j++
      while (j < code.length && /\s/.test(code[j])) j++
      if (code[j] === '"' || code[j] === "'") {
        const e = code.indexOf(code[j], j + 1)
        if (e < 0) return null
        attrs.set(name, code.slice(j + 1, e))
        i = e + 1
      } else if (code[j] === '{') {
        const e = skipBraces(code, j)
        attrs.set(name, code.slice(j, e))
        i = e
      } else return null
    } else {
      attrs.set(name, true)
    }
  }
  return null
}

// Every <input type="file" ... capture ...> in one source file.
function findCaptureInputs(file) {
  let code = fs.readFileSync(file, 'utf8')
  if (!code.includes('capture') || !code.includes('<input')) return []
  code = stripJsComments(code)
  const hits = []
  const re = /<input(?=[\s/>])/g
  let m
  while ((m = re.exec(code))) {
    const attrs = parseTagAttrs(code, m.index + '<input'.length)
    if (!attrs || !attrs.has('capture') || !attrs.has('type')) continue
    const type = String(attrs.get('type')).replace(/^\{\s*|\s*\}$/g, '').replace(/^["'`]|["'`]$/g, '').trim()
    if (type !== 'file') continue
    if (String(attrs.get('capture')).replace(/\s/g, '') === '{false}') continue
    hits.push(code.slice(0, m.index).split('\n').length)
  }
  return hits
}

// ---------- file_paths.xml: is the app-private Pictures/ folder exposed? ----------
// external-files-path root = getExternalFilesDir(null). Capacitor's file lives in
// <root>/Pictures/, so the path must be empty / "." / "Pictures".
// A (broader) external-path root = /storage/emulated/0 also covers it when its
// path is empty / "." / a prefix of Android/data/<pkg>/files/Pictures.
const segs = (p) => String(p || '').split('/').filter((s) => s && s !== '.')
const isPrefix = (a, target) => a.length <= target.length && a.every((s, k) => target[k] === '*' || s === target[k])
function filePathsCoverCameraDir(xml) {
  for (const m of xml.matchAll(/<(external-files-path|external-path)\b([^>]*?)\/?>/g)) {
    const pm = /\bpath\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(m[2])
    const s = segs(pm ? (pm[1] ?? pm[2]) : '')
    if (m[1] === 'external-files-path' && isPrefix(s, ['Pictures'])) return true
    if (m[1] === 'external-path' && isPrefix(s, ['Android', 'data', '*', 'files', 'Pictures'])) return true
  }
  return false
}

// ---------- AndroidManifest.xml ----------
function hasImageCaptureQuery(xml) {
  for (const q of xml.matchAll(/<queries\b[^>]*>([\s\S]*?)<\/queries>/g)) {
    for (const it of q[1].matchAll(/<intent\b[^>]*>([\s\S]*?)<\/intent>/g)) {
      if (/<action\b[^>]*android:name\s*=\s*["']android\.media\.action\.IMAGE_CAPTURE["']/.test(it[1])) return true
    }
  }
  return false
}
function declaresCameraPermission(xml) {
  for (const m of xml.matchAll(/<uses-permission(?:-sdk-23)?\b[^>]*>/g)) {
    const tag = m[0]
    if (!/android:name\s*=\s*["']android\.permission\.CAMERA["']/.test(tag)) continue
    if (/tools:node\s*=\s*["']remove["']/.test(tag)) continue // explicitly removed = fine
    return true
  }
  return false
}

// ---------- main ----------
// `rootTag` is a sanity check: a file that does not even look like the expected
// XML is a PARSE PROBLEM (warn + skip), not evidence of the defect we look for.
function readOrWarn(label, file, rootTag, transform) {
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const xml = transform(raw)
    if (!new RegExp(`<${rootTag}\\b`).test(xml)) throw new Error(`no <${rootTag}> element found`)
    return xml
  } catch (e) {
    WARN(`cannot read ${label} (${e && e.message}) - that part of the check is skipped`)
    return null
  }
}

function main() {
  const root = resolveRoot()
  const rel = (p) => path.relative(root, p) || p
  const manifestFile = path.join(root, 'android/app/src/main/AndroidManifest.xml')
  const pathsFile = path.join(root, 'android/app/src/main/res/xml/file_paths.xml')
  const srcDir = path.join(root, 'src')

  const manifest = readOrWarn('AndroidManifest.xml', manifestFile, 'manifest', stripXmlComments)
  const pathsXml = readOrWarn('file_paths.xml', pathsFile, 'paths', stripXmlComments)

  // capture inputs in the web app
  let captureInputs = null
  try {
    const files = []
    walk(srcDir, files)
    captureInputs = []
    let unreadable = 0
    for (const f of files) {
      try { for (const line of findCaptureInputs(f)) captureInputs.push(`${rel(f)}:${line}`) } catch { unreadable++ }
    }
    if (unreadable) WARN(`${unreadable} source file(s) could not be read and were skipped`)
  } catch (e) {
    WARN(`cannot scan ${srcDir} (${e && e.message}) - capture-input check is skipped`)
  }

  const notes = []

  // (b) CAMERA permission must not be declared
  if (manifest != null) {
    if (declaresCameraPermission(manifest)) {
      findings.push(
        `FAIL ${rel(manifestFile)} declares android.permission.CAMERA - remove it. With it declared, the camera ` +
        `intent needs a runtime grant and "Scan card" can be refused/fall back to the file picker.`
      )
    } else notes.push('no CAMERA permission')
  }

  // (a) web capture inputs need the two native pieces
  if (captureInputs && captureInputs.length) {
    const sample = captureInputs.slice(0, 3).join(', ') + (captureInputs.length > 3 ? ', ...' : '')
    if (pathsXml != null) {
      if (!filePathsCoverCameraDir(pathsXml)) {
        findings.push(
          `FAIL ${rel(pathsFile)} has no <external-files-path path="Pictures/"> but ${captureInputs.length} ` +
          `<input type="file" capture> exist in src (${sample}) - the camera will silently fall back to the file picker ` +
          `("Unable to create temporary media capture file").`
        )
      } else notes.push('file_paths.xml covers Pictures/')
    }
    if (manifest != null) {
      if (!hasImageCaptureQuery(manifest)) {
        findings.push(
          `FAIL ${rel(manifestFile)} <queries> lacks <action android:name="android.media.action.IMAGE_CAPTURE"/> but ` +
          `${captureInputs.length} <input type="file" capture> exist in src (${sample}) - on Android 11+ the camera ` +
          `app cannot be resolved and capture falls back to the file picker.`
        )
      } else notes.push('<queries> has IMAGE_CAPTURE')
    }
    notes.unshift(`${captureInputs.length} capture input(s) in src`)
  } else if (captureInputs) {
    notes.push('no <input type="file" capture> in src - camera config check not needed')
  }

  // Say OK only when every part really ran; otherwise the WARN lines above are the
  // honest status (never print a reassuring OK for a check that was skipped).
  if (!findings.length && !warnings) console.log(`${TAG} OK - ${notes.join('; ') || 'nothing to check'}`)
}

try {
  main()
} catch (e) {
  WARN(`checker errored (${e && e.message}) - skipping, build not blocked`)
}

if (findings.length) {
  for (const f of findings) console.error(`${TAG} ${f}`)
  console.error(`${TAG} BUILD BLOCKED - fix the line(s) above (background: 96019 camera fix, 2026-10-02) then re-run.`)
  process.exit(1)
}
if (warnings) console.warn(`${TAG} WARN (not blocking): check was incomplete (${warnings} warning(s)) - not treated as a failure.`)
process.exit(0)
