#!/bin/bash
# Unit testing script for "Domov na varno" (TypeScript library, Node.js >= 22.19, npm, Vitest).
# Usage: bash run_unittests_node.sh <build_folder>
# Exit codes: 1 usage, 2 filesystem, 69 toolchain missing, 80 only static checks failed, else the test command's code.

REQUIRED_NODE_MAJOR=22
REQUIRED_NODE_MINOR=19

banner() { echo; echo "===== [$1/8] $2 ====="; }
run() { echo "+ $* (cwd: $(pwd))"; "$@"; }

banner 1 "Toolchain check"
if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js (>= ${REQUIRED_NODE_MAJOR}.${REQUIRED_NODE_MINOR}) is not installed or not on PATH."
  echo "PATH=$PATH"
  exit 69
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is not installed or not on PATH."
  echo "PATH=$PATH"
  exit 69
fi
NODE_VERSION="$(node --version)"
echo "node: $(command -v node) -> $NODE_VERSION"
echo "npm:  $(command -v npm) -> $(npm --version)"
NODE_VER="${NODE_VERSION#v}"
NODE_MAJOR="${NODE_VER%%.*}"
NODE_REST="${NODE_VER#*.}"
NODE_MINOR="${NODE_REST%%.*}"
if [ "$NODE_MAJOR" -lt "$REQUIRED_NODE_MAJOR" ] || { [ "$NODE_MAJOR" -eq "$REQUIRED_NODE_MAJOR" ] && [ "$NODE_MINOR" -lt "$REQUIRED_NODE_MINOR" ]; }; then
  echo "Error: Node.js >= ${REQUIRED_NODE_MAJOR}.${REQUIRED_NODE_MINOR} is required, found $NODE_VERSION."
  exit 69
fi

banner 2 "Argument validation"
if [ -z "$1" ]; then
  echo "Error: No build folder provided."
  echo "Usage: $0 <build_folder>"
  exit 1
fi
if [ ! -d "$1" ]; then
  echo "Error: Build folder '$1' does not exist."
  exit 2
fi
SOURCE_FOLDER="$(cd "$1" && pwd)"
echo "Source build folder (read-only): $SOURCE_FOLDER"

banner 3 "Working directory setup"
WORKING_FOLDER="$(mktemp -d "/tmp/node_$(basename "$SOURCE_FOLDER").XXXXXX")" || { echo "Error: cannot create a working folder under /tmp"; exit 2; }
echo "Working folder: $WORKING_FOLDER"
trap 'echo "Cleaning up $WORKING_FOLDER"; rm -rf "$WORKING_FOLDER"' EXIT

banner 4 "Copy the build"
echo "+ cp -R $SOURCE_FOLDER/. $WORKING_FOLDER/ (excluding node_modules, dist)"
( cd "$SOURCE_FOLDER" && tar cf - --exclude=./node_modules --exclude=./dist . ) | ( cd "$WORKING_FOLDER" && tar xf - ) \
  || { echo "Error: copying $SOURCE_FOLDER to $WORKING_FOLDER failed"; exit 2; }
echo "Copied $SOURCE_FOLDER -> $WORKING_FOLDER"

banner 5 "Enter the working directory"
cd "$WORKING_FOLDER" 2>/dev/null || { echo "Error: cannot enter $WORKING_FOLDER"; exit 2; }
echo "Now in $(pwd)"

banner 6 "Install dependencies into ./node_modules"
# A cache kept between runs, so packages are downloaded once, not on every run; npm's cache is safe to share.
export npm_config_cache="/tmp/turri-npm-cache"
export npm_config_prefer_offline=true
# Fail a stalled registry fetch in seconds, visibly, instead of waiting out the time limit.
export npm_config_fetch_timeout=30000
export npm_config_fetch_retries=2
export npm_config_fetch_retry_maxtimeout=10000
export npm_config_update_notifier=false
export npm_config_fund=false
echo "npm cache: $npm_config_cache"
if [ ! -f package.json ]; then
  echo "Error: package.json not found in $(pwd)"
  exit 1
fi
if [ -f package-lock.json ]; then
  run npm ci --no-audit
else
  echo "No package-lock.json - falling back to npm install"
  run npm install --no-audit
fi
INSTALL=$?
if [ "$INSTALL" -ne 0 ]; then
  echo "Error: dependency install failed with exit $INSTALL (cwd $(pwd), npm_config_cache=$npm_config_cache, PATH=$PATH)"
  exit "$INSTALL"
fi
BIN="$WORKING_FOLDER/node_modules/.bin"
echo "Tools resolved from $BIN"

banner 7 "Static checks"
CHECKS=0
check_tool() {
  if [ ! -x "$BIN/$1" ]; then
    echo "package.json:1:1: $2 is not in devDependencies - add it"
    CHECKS=1
    return 1
  fi
  return 0
}
if check_tool prettier prettier; then
  echo "--- Prettier (check mode)"
  run "$BIN/prettier" --list-different --ignore-unknown . || { echo "Prettier: FAILED - files listed above are not formatted"; CHECKS=1; }
fi
if check_tool eslint eslint; then
  echo "--- ESLint"
  run "$BIN/eslint" --max-warnings 0 . || { echo "ESLint: FAILED"; CHECKS=1; }
fi
if check_tool tsc typescript; then
  echo "--- TypeScript"
  if grep -q '"references"' tsconfig.json 2>/dev/null; then
    run "$BIN/tsc" --build --pretty false || { echo "tsc: FAILED"; CHECKS=1; }
  else
    run "$BIN/tsc" --noEmit --pretty false || { echo "tsc: FAILED"; CHECKS=1; }
  fi
fi
[ "$CHECKS" -eq 0 ] && echo "Static checks: passed" || echo "Static checks: FAILED - the findings are above"

banner 8 "Unit tests (Vitest)"
TEST_CMD="$BIN/vitest run"
if [ ! -x "$BIN/vitest" ]; then
  echo "package.json:1:1: vitest is not in devDependencies - add it"
  TESTS=1
else
  run "$BIN/vitest" run
  TESTS=$?
fi

if [ "$TESTS" -ne 0 ]; then
  STATUS=$TESTS
elif [ "$CHECKS" -ne 0 ]; then
  STATUS=80
else
  STATUS=0
fi
echo
echo "Summary: static checks exit $CHECKS; unit tests ($TEST_CMD) exit $TESTS; script exit $STATUS; working folder $WORKING_FOLDER"
exit "$STATUS"
