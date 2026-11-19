#!/bin/sh
# Every suite, stopping at the first failure. Needs .venv (see Setup in CLAUDE.md).
set -e
cd "$(dirname "$0")"
[ -x .venv/bin/python ] || { echo "no .venv: see Setup in CLAUDE.md" >&2; exit 1; }
.venv/bin/python tests/test_search.py
.venv/bin/python tests/test_ai.py
(cd web && npm run build && npm test)
.venv/bin/python tests/test_site.py
(cd worker && npm test)
