#!/bin/bash
# Conformance testing script for "Domov na varno" (TypeScript library, Node.js >= 22.19, npm, Vitest).
# Usage: bash run_conformance_tests_node.sh <build_folder> <conformance_tests_folder>
# Exit codes: 69 invocation/toolchain error, 1 no tests / misplaced tests, 80 only the static checks of the tests failed,
# else the test command's code.
#
# The conformance tests import the library by its package name (the "name" in the build's package.json), or vitest;
# both resolve to the staged build - the package name to its built dist/index.js - through a Vitest config and a
# tsconfig the script writes into the working folder. Nothing is written to $1 or $2.

UNRECOVERABLE_ERROR_EXIT_CODE=69
STATIC_CHECKS_FAILED=80
REQUIRED_NODE_MAJOR=22
REQUIRED_NODE_MINOR=19

banner() { echo; echo "===== [$1/8] $2 ====="; }
run() { echo "+ $* (cwd: $(pwd))"; "$@"; }

banner 1 "Toolchain check"
for tool in node npm; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Error: $tool is not installed or not on PATH (Node.js >= ${REQUIRED_NODE_MAJOR}.${REQUIRED_NODE_MINOR} with npm is required)."
    echo "PATH=$PATH"
    exit $UNRECOVERABLE_ERROR_EXIT_CODE
  fi
done
NODE_VERSION="$(node --version)"
echo "node: $(command -v node) -> $NODE_VERSION"
echo "npm:  $(command -v npm) -> $(npm --version)"
NODE_VER="${NODE_VERSION#v}"; NODE_MAJOR="${NODE_VER%%.*}"; NODE_REST="${NODE_VER#*.}"; NODE_MINOR="${NODE_REST%%.*}"
if [ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ] || { [ "$NODE_MAJOR" -eq "$REQUIRED_NODE_MAJOR" ] && [ "$NODE_MINOR" -lt "$REQUIRED_NODE_MINOR" ]; }; then
  echo "Error: Node.js >= ${REQUIRED_NODE_MAJOR}.${REQUIRED_NODE_MINOR} is required, found $NODE_VERSION."
  exit $UNRECOVERABLE_ERROR_EXIT_CODE
fi

banner 2 "Argument validation"
if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Error: both a build folder and a conformance tests folder are required."
  echo "Usage: $0 <build_folder> <conformance_tests_folder>"
  exit $UNRECOVERABLE_ERROR_EXIT_CODE
fi
if [ ! -d "$1" ]; then echo "Error: build folder '$1' does not exist."; exit $UNRECOVERABLE_ERROR_EXIT_CODE; fi

banner 3 "Resolve paths"
SOURCE_FOLDER="$(cd "$1" && pwd)"
case "$2" in
  /*) CONFORMANCE_TESTS_FOLDER="$2" ;;
  *)  CONFORMANCE_TESTS_FOLDER="$(pwd)/$2" ;;
esac
if [ ! -d "$CONFORMANCE_TESTS_FOLDER" ]; then
  echo "Error: conformance tests folder '$CONFORMANCE_TESTS_FOLDER' does not exist."
  exit $UNRECOVERABLE_ERROR_EXIT_CODE
fi
CONFORMANCE_TESTS_FOLDER="$(cd "$CONFORMANCE_TESTS_FOLDER" && pwd)"
echo "Build folder (read-only):             $SOURCE_FOLDER"
echo "Conformance tests folder (read-only): $CONFORMANCE_TESTS_FOLDER"

echo "--- Refusing conformance tests in the build folder"
MISPLACED=$( (grep -rlE --exclude=".turri*" --exclude-dir=.venv --exclude-dir=node_modules --exclude-dir=target --exclude-dir=dist \
    "(conformance tests|(conformance|acceptance) scenario [a-z0-9-]+) of [^[:space:]:]+:[a-z0-9-]+" "$SOURCE_FOLDER" 2>/dev/null; \
  find "$SOURCE_FOLDER" -type f \( -ipath "*conformance*" -o -ipath "*acceptance*" \) -iname "*test*" \
    -not -name ".turri*" -not -path "*/.venv/*" -not -path "*/node_modules/*" -not -path "*/target/*" -not -path "*/dist/*" 2>/dev/null) | sort -u)
if [ -n "$MISPLACED" ]; then
  printf "Error: conformance tests found in the build folder %s - they belong in the conformance tests folder %s:\n%s\n" "$SOURCE_FOLDER" "$CONFORMANCE_TESTS_FOLDER" "$MISPLACED" >&2
  exit 1
fi
echo "None found."

banner 4 "Working directory setup"
WORKING_FOLDER="$(mktemp -d "/tmp/node_$(basename "$SOURCE_FOLDER").XXXXXX")" || { echo "Error: cannot create a working folder under /tmp"; exit $UNRECOVERABLE_ERROR_EXIT_CODE; }
echo "Working folder: $WORKING_FOLDER"
trap 'echo "Cleaning up $WORKING_FOLDER"; rm -rf "$WORKING_FOLDER"' EXIT

banner 5 "Copy the build"
echo "+ copy $SOURCE_FOLDER/. -> $WORKING_FOLDER/ (excluding node_modules, dist)"
( cd "$SOURCE_FOLDER" && tar cf - --exclude=./node_modules --exclude=./dist . ) | ( cd "$WORKING_FOLDER" && tar xf - ) \
  || { echo "Error: copying $SOURCE_FOLDER to $WORKING_FOLDER failed"; exit $UNRECOVERABLE_ERROR_EXIT_CODE; }

banner 6 "Enter the working directory"
cd "$WORKING_FOLDER" 2>/dev/null
if [ $? -ne 0 ]; then echo "Error: cannot enter $WORKING_FOLDER"; exit $UNRECOVERABLE_ERROR_EXIT_CODE; fi
echo "Now in $(pwd)"

banner 7 "Install dependencies into ./node_modules and build dist/"
start_time=$(date +%s)
export npm_config_cache="/tmp/turri-npm-cache"
export npm_config_prefer_offline=true
export npm_config_fetch_timeout=30000
export npm_config_fetch_retries=2
export npm_config_fetch_retry_maxtimeout=10000
export npm_config_update_notifier=false
export npm_config_fund=false
echo "npm cache: $npm_config_cache"
if [ ! -f package.json ]; then echo "Error: package.json not found in $(pwd)"; exit $UNRECOVERABLE_ERROR_EXIT_CODE; fi
if [ -f package-lock.json ]; then run npm ci --no-audit; else echo "No package-lock.json - using npm install"; run npm install --no-audit; fi
INSTALL=$?
if [ "$INSTALL" -ne 0 ]; then
  echo "Error: dependency install failed with exit $INSTALL (cwd $(pwd), npm_config_cache=$npm_config_cache, PATH=$PATH)"
  exit "$INSTALL"
fi
BIN="$WORKING_FOLDER/node_modules/.bin"
if node -e 'process.exit(require("./package.json").scripts?.build ? 0 : 1)'; then
  run npm run build
else
  echo "No build script in package.json - compiling with tsc"
  run "$BIN/tsc"
fi
BUILD=$?
if [ "$BUILD" -ne 0 ]; then echo "Error: building the library failed with exit $BUILD"; exit "$BUILD"; fi
if [ ! -f dist/index.js ]; then echo "Error: the build produced no dist/index.js in $(pwd)"; exit $UNRECOVERABLE_ERROR_EXIT_CODE; fi
PKG_NAME="$(node -p 'require("./package.json").name || ""')"
echo "Library package name: '${PKG_NAME}' -> $WORKING_FOLDER/dist/index.js"
for tool in vitest tsc prettier eslint; do
  if [ ! -x "$BIN/$tool" ]; then
    echo "Error: $tool is not installed in $BIN - it must be in the build's devDependencies."
    exit $UNRECOVERABLE_ERROR_EXIT_CODE
  fi
done
echo "Requirements setup completed in $(( $(date +%s) - start_time )) seconds"

# Configs pinned by the script, in the working folder - never read from $1 or $2.
export CONFORMANCE_TESTS_FOLDER WORKING_FOLDER PKG_NAME
cat > vitest.conformance.config.mjs <<'JS'
import path from "node:path";
const tests = process.env.CONFORMANCE_TESTS_FOLDER;
const work = process.env.WORKING_FOLDER;
const alias = [{ find: /^vitest$/, replacement: path.join(work, "node_modules/vitest/dist/index.js") }];
if (process.env.PKG_NAME) alias.unshift({ find: new RegExp("^" + process.env.PKG_NAME.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + "$"), replacement: path.join(work, "dist/index.js") });
export default {
  root: tests,
  cacheDir: path.join(work, ".vite-cache"),
  resolve: { alias },
  server: { fs: { allow: [tests, work] } },
  test: { include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)"], exclude: ["**/node_modules/**"], passWithNoTests: false },
};
JS
node -e '
const p = require("path"); const w = process.env.WORKING_FOLDER; const paths = { vitest: [p.join(w, "node_modules/vitest")] };
if (process.env.PKG_NAME) paths[process.env.PKG_NAME] = [p.join(w, "dist/index.d.ts"), p.join(w, "dist/index.js")];
require("fs").writeFileSync("tsconfig.conformance.json", JSON.stringify({ compilerOptions: {
  target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, skipLibCheck: true,
  esModuleInterop: true, resolveJsonModule: true, types: ["node"], typeRoots: [p.join(w, "node_modules/@types")],
  baseUrl: w, paths }, include: [p.join(process.env.CONFORMANCE_TESTS_FOLDER, "**/*.ts"), p.join(process.env.CONFORMANCE_TESTS_FOLDER, "**/*.mts")] }, null, 2));'
cat > eslint.conformance.config.mjs <<'JS'
import js from "@eslint/js";
import tseslint from "typescript-eslint";
export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { console: "readonly", process: "readonly" } } },
];
JS

banner "7b" "Static checks of the conformance tests"
CHECKS=0
echo "--- Prettier (check mode)"
run "$BIN/prettier" --check --no-config --no-editorconfig --ignore-path "" --ignore-unknown "$CONFORMANCE_TESTS_FOLDER" || { echo "Prettier: FAILED"; CHECKS=1; }
echo "--- ESLint"
( cd "$CONFORMANCE_TESTS_FOLDER" && ESLINT_USE_FLAT_CONFIG=true run "$BIN/eslint" --no-config-lookup --config "$WORKING_FOLDER/eslint.conformance.config.mjs" --max-warnings 0 --cache-location "$WORKING_FOLDER/.eslintcache" . ) || { echo "ESLint: FAILED"; CHECKS=1; }
echo "--- TypeScript (strict, tests only)"
run "$BIN/tsc" --noEmit --pretty false -p tsconfig.conformance.json || { echo "tsc: FAILED"; CHECKS=1; }
[ "$CHECKS" -eq 0 ] && echo "Static checks: passed" || echo "Static checks: FAILED - the findings are above"

banner 8 "Conformance tests (Vitest)"
TEST_CMD="$BIN/vitest run --config $WORKING_FOLDER/vitest.conformance.config.mjs --root $CONFORMANCE_TESTS_FOLDER"
echo "+ $TEST_CMD (cwd: $(pwd))"
OUTPUT_FILE="$WORKING_FOLDER/.vitest-output.txt"
"$BIN/vitest" run --config "$WORKING_FOLDER/vitest.conformance.config.mjs" --root "$CONFORMANCE_TESTS_FOLDER" 2>&1 | tee "$OUTPUT_FILE"
TESTS=${PIPESTATUS[0]}
if grep -q "No test files found" "$OUTPUT_FILE"; then
  echo "Error: no conformance tests discovered in $CONFORMANCE_TESTS_FOLDER"
  exit 1
fi

if [ "$TESTS" -ne 0 ]; then
  STATUS=$TESTS
  echo "Failed: $TEST_CMD in $(pwd); CONFORMANCE_TESTS_FOLDER=$CONFORMANCE_TESTS_FOLDER; NODE_PATH=${NODE_PATH:-}; PATH=$PATH"
elif [ "$CHECKS" -ne 0 ]; then
  STATUS=$STATIC_CHECKS_FAILED
  echo "The conformance tests pass, and their static checks do not."
else
  STATUS=0
fi
echo
echo "Summary: static checks exit $CHECKS; tests ($TEST_CMD) exit $TESTS; script exit $STATUS; tests folder $CONFORMANCE_TESTS_FOLDER; working folder $WORKING_FOLDER"
exit "$STATUS"
