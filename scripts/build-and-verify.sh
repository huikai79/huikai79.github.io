#!/usr/bin/env bash
set -euo pipefail

PUBLIC_DIR="${1:-public}"

echo "Hugo / Go runtime"
hugo version
go version

python3 -m py_compile scripts/optimize-managed-covers.py scripts/localize-multilingual-page-resources.py scripts/apply-editorial-metadata.py scripts/test-editorial-metadata.py
node --check scripts/check-notion-publication-contract.mjs
node --check scripts/live-reader-qa.mjs
node --check scripts/verify-comments-integration.mjs
python3 scripts/test-language-route-alias-contract.py
python3 scripts/verify-translation-workflow-safety.py
python3 scripts/test-main-release-contract.mjs
python3 scripts/test-editorial-metadata.py
node scripts/test-notion-video-transformer.mjs
node scripts/test-notion-audio-transformer.mjs
node workers/notion-media-gateway/test-paths.mjs
node workers/notion-media-gateway/test-runtime.mjs
python3 scripts/test-notion-media-localization.py
python3 scripts/test-media-budget.py
python3 scripts/localize-notion-media.py
python3 scripts/verify-media-budget.py
python3 scripts/test-cover-resolution.py
python3 scripts/resolve-article-covers.py
python3 scripts/localize-multilingual-page-resources.py
python3 scripts/localize-multilingual-page-resources.py --check
python3 scripts/test-discovery-taxonomy-contract.py
if [ "${STRICT_CONTENT:-0}" != "1" ]; then
  # PR/local builds may start from the last committed production snapshot. The
  # production sync writes this projection directly; non-strict validation
  # normalizes the candidate snapshot so the new discovery templates can be
  # exercised before merge without mutating an exact production deployment.
  python3 scripts/apply-discovery-taxonomies.py
fi
python3 scripts/ensure-multilingual-section-indexes.py
python3 scripts/verify-source-contract.py
python3 scripts/verify-video-rendering.py source
python3 scripts/verify-audio-rendering.py source
python3 scripts/verify-notion-media-gateway.py

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

if python3 - <<'PY'
import json
from pathlib import Path
p=json.loads(Path('.notion-sync-manifest.json').read_text(encoding='utf-8')).get('pages',{})
raise SystemExit(0 if p and all(isinstance(v,dict) and v.get('language') and v.get('contentFile') for v in p.values()) else 1)
PY
then
  python3 scripts/verify-routed-rendered-site.py "$PUBLIC_DIR"
else
  python3 scripts/verify-rendered-site.py "$PUBLIC_DIR"
fi

python3 scripts/verify-social-preview.py "$PUBLIC_DIR"
python3 scripts/verify-discovery-pages.py "$PUBLIC_DIR"
python3 scripts/verify-taxonomy-localization.py "$PUBLIC_DIR"
python3 scripts/verify-video-rendering.py rendered "$PUBLIC_DIR"
python3 scripts/verify-audio-rendering.py rendered "$PUBLIC_DIR"
python3 scripts/verify-article-nativeization.py "$PUBLIC_DIR"
python3 scripts/verify-gate7-cleanup.py "$PUBLIC_DIR"
python3 scripts/verify-site-identity.py "$PUBLIC_DIR"
python3 scripts/verify-comments-policy.py "$PUBLIC_DIR"
python3 scripts/verify-article-sharing.py "$PUBLIC_DIR"
python3 scripts/verify-multilingual-site.py "$PUBLIC_DIR"
python3 scripts/verify-multilingual-seo.py "$PUBLIC_DIR"
python3 scripts/verify-reader-completeness.py "$PUBLIC_DIR"
python3 scripts/verify-reader-navigation.py "$PUBLIC_DIR"
python3 scripts/verify-rss-integrity.py "$PUBLIC_DIR"

# Preserve historical root article URLs only when no real default-language
# article owns that route. The final verifier runs after this mutation and
# guards both redirect aliases and every canonical zh-TW article against
# overwrite/noindex/canonical drift.
python3 scripts/write-language-route-aliases.py "$PUBLIC_DIR"
python3 scripts/verify-language-route-aliases.py "$PUBLIC_DIR"
