#!/usr/bin/env bash
set -euo pipefail
python_dependencies=$1
reporting_archives=$2

printf 'CI installed Python: %s\n' "$(python --version)"
python -m pip install mypy==1.18.2
python packages/jiggy-reporting/tests/package_smoke.py \
  "$reporting_archives"/*.whl "$reporting_archives"/*.tar.gz "$python_dependencies"/*.whl
