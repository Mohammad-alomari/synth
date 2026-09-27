#!/bin/sh
# Runs the fast offline checks and verifies index.html matches its sources. Exit code 0 = all passed.
# Usage: sh test/run_all.sh        (from the repository root; needs Node 18+, python3; ffmpeg for combis.js)
cd "$(dirname "$0")/.." || exit 1
fail=0
run() { printf '== %s\n' "$*"; if "$@" > /tmp/run_all.$$ 2>&1; then tail -n 2 /tmp/run_all.$$; else cat /tmp/run_all.$$; echo "FAILED: $*"; fail=1; fi; }

# index.html must be the build of the current sources (rebuild with: python3 build.py)
printf '== index.html up to date\n'
python3 build.py /tmp/run_all_index.$$.html > /dev/null && if cmp -s index.html /tmp/run_all_index.$$.html; then echo ok; else echo 'FAILED: index.html is stale - run: python3 build.py'; fail=1; fi
rm -f /tmp/run_all_index.$$.html

run node test/fxunit.js
run node test/fuzz.js
run node test/fxfix.js
run node test/voicefix.js
run node test/progs.js
if command -v ffmpeg > /dev/null; then run node test/combis.js; else echo '== combis.js skipped (needs ffmpeg)'; fi

rm -f /tmp/run_all.$$
[ $fail = 0 ] && echo 'ALL PASSED' || echo 'SOME CHECKS FAILED'
exit $fail
