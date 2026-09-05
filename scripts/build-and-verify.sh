#!/usr/bin/env bash
set -euo pipefail

PUBLIC_DIR="${1:-public}"

echo "Hugo / Go runtime"
hugo version
go version

python3 scripts/verify-source-contract.py

if [ "${REFRESH_HOMEPAGE_ROTATION:-0}" = "1" ]; then
  python3 scripts/prepare-homepage-rotation.py
else
  test -s data/homepage_runtime.toml || {
    echo "::error::Committed homepage rotation state is missing"
    exit 1
  }
fi

go mod download
hugo mod graph | tee /tmp/hugo-mod-graph.txt
grep -q 'github.com/nunocoracao/blowfish/v3@v3.6.0' /tmp/hugo-mod-graph.txt
test ! -d themes/blowfish

if ! git diff --exit-code -- go.mod go.sum; then
  echo "::error::Go module files are not fully committed"
  exit 1
fi

if grep -R -q 'github.com/nunocoracao/blowfish/v2' go.mod go.sum config/_default; then
  echo "::error::Blowfish v2 reference remains after the v3 upgrade"
  exit 1
fi

hugo --printPathWarnings --templateMetrics --templateMetricsHints 2>&1 | tee /tmp/hugo-template.log
if grep -Fq '.Site.Data was deprecated' /tmp/hugo-template.log; then
  echo "::error::Deprecated .Site.Data API is still used"
  exit 1
fi

rm -rf "$PUBLIC_DIR"
hugo --minify --destination "$PUBLIC_DIR"
python3 scripts/verify-rendered-site.py "$PUBLIC_DIR"
