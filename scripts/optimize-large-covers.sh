#!/usr/bin/env bash
set -euo pipefail

MAX_BYTES=$((2 * 1024 * 1024))
MIN_PSNR="35.0"
TARGETS=(
  "content/posts/Writing-and-speaking/cover.jpg"
  "content/posts/How-you-know/cover.jpg"
)

command -v identify >/dev/null || { echo "::error::ImageMagick identify is required"; exit 1; }
command -v convert >/dev/null || { echo "::error::ImageMagick convert is required"; exit 1; }
command -v compare >/dev/null || { echo "::error::ImageMagick compare is required"; exit 1; }

mkdir -p binary-image-maintenance
report="binary-image-maintenance/report.tsv"
printf 'path\toriginal_bytes\toptimized_bytes\toriginal_geometry\toptimized_geometry\tquality\tpsnr_db\n' > "$report"

for file in "${TARGETS[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "::error::Missing target: $file"
    exit 1
  fi

  original_bytes=$(stat -c '%s' "$file")
  original_geometry=$(identify -format '%wx%h' "$file")
  original_sha=$(sha256sum "$file" | awk '{print $1}')

  if (( original_bytes <= MAX_BYTES )); then
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$file" "$original_bytes" "$original_bytes" "$original_geometry" "$original_geometry" "unchanged" "n/a" >> "$report"
    echo "$file already within budget ($original_bytes bytes); no rewrite."
    continue
  fi

  backup=$(mktemp --suffix=.jpg)
  candidate=$(mktemp --suffix=.jpg)
  cp "$file" "$backup"
  selected_quality=""

  for quality in 88 85 82 79; do
    convert "$backup" \
      -auto-orient \
      -strip \
      -sampling-factor 4:2:0 \
      -interlace Plane \
      -quality "$quality" \
      "$candidate"

    candidate_bytes=$(stat -c '%s' "$candidate")
    if (( candidate_bytes <= MAX_BYTES )); then
      selected_quality="$quality"
      break
    fi
  done

  if [[ -z "$selected_quality" ]]; then
    echo "::error::$file could not be reduced below $MAX_BYTES bytes without going below JPEG quality 79"
    rm -f "$backup" "$candidate"
    exit 1
  fi

  optimized_geometry=$(identify -format '%wx%h' "$candidate")
  if [[ "$optimized_geometry" != "$original_geometry" ]]; then
    echo "::error::$file geometry changed: $original_geometry -> $optimized_geometry"
    rm -f "$backup" "$candidate"
    exit 1
  fi

  set +e
  psnr_output=$(compare -metric PSNR "$backup" "$candidate" null: 2>&1)
  compare_status=$?
  set -e
  # ImageMagick compare returns 1 when images differ; that is expected for lossy recompression.
  if (( compare_status > 1 )); then
    echo "::error::PSNR comparison failed for $file: $psnr_output"
    rm -f "$backup" "$candidate"
    exit 1
  fi
  psnr=$(printf '%s' "$psnr_output" | awk '{print $1}')

  if [[ "$psnr" == "inf" || "$psnr" == "Inf" ]]; then
    psnr_numeric="99.0"
  else
    psnr_numeric="$psnr"
  fi

  awk -v actual="$psnr_numeric" -v minimum="$MIN_PSNR" 'BEGIN { exit !(actual + 0 >= minimum + 0) }' || {
    echo "::error::$file PSNR too low: $psnr dB < $MIN_PSNR dB"
    rm -f "$backup" "$candidate"
    exit 1
  }

  cp "$candidate" "$file"
  optimized_bytes=$(stat -c '%s' "$file")
  optimized_sha=$(sha256sum "$file" | awk '{print $1}')

  if [[ "$optimized_sha" == "$original_sha" ]]; then
    echo "::error::$file binary did not change despite exceeding budget"
    rm -f "$backup" "$candidate"
    exit 1
  fi

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$file" "$original_bytes" "$optimized_bytes" "$original_geometry" "$optimized_geometry" "$selected_quality" "$psnr" >> "$report"

  echo "$file: $original_bytes -> $optimized_bytes bytes, geometry=$original_geometry, quality=$selected_quality, PSNR=${psnr}dB"
  rm -f "$backup" "$candidate"
done

cat "$report"
