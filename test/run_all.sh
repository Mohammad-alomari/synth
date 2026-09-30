#!/bin/sh
# Runs all checks; exit code 0 = everything passed. Quick by default (about 1-2 minutes).
# FULL=1 sh test/run_all.sh  renders every program and combination instead of a sample (about 10 minutes).
# Needs Node 18+, python3, ffmpeg (combis.js) and Python Playwright with Chromium (browser test); missing tools are skipped.
cd "$(dirname "$0")/.." || exit 1
fail=0
log=$(mktemp)
run() { printf '== %s\n' "$*"; if "$@" > "$log" 2>&1; then tail -n 1 "$log"; else cat "$log"; echo "FAILED: $*"; fail=1; fi; }

# the tests play made-up test banks (test/fixtures.js), never your own files: the same results on every machine and in CI
run node test/fixtures.js
# index.html builds from the sources (with your own banks from private/, if you have any); the browser test builds its own page
run python3 build.py
run python3 test/check_public.py

run node test/fxunit.js
run node test/fuzz.js
run node test/fxfix.js
run node test/voicefix.js
run node test/combifix.js
run node test/progs.js
if command -v ffmpeg > /dev/null; then run node test/combis.js; else echo '== combis.js skipped (needs ffmpeg)'; fi
if python3 -c 'import playwright' 2> /dev/null; then run python3 test/browser_test.py; else echo '== browser_test.py skipped (needs: pip install playwright)'; fi

rm -f "$log"
[ $fail = 0 ] && echo 'ALL PASSED' || echo 'SOME CHECKS FAILED'
exit $fail
