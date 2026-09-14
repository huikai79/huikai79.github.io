export const DEFAULT_TRANSLATION_BATCH_MAX_SEGMENTS = 80;
export const DEFAULT_TRANSLATION_BATCH_MAX_SOURCE_CHARS = 24000;
export const DEFAULT_TRANSLATION_BATCH_MAX_ATTEMPTS = 2;

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

export function chunkTranslationSegments(
  segments = [],
  {
    maxSegments = DEFAULT_TRANSLATION_BATCH_MAX_SEGMENTS,
    maxSourceChars = DEFAULT_TRANSLATION_BATCH_MAX_SOURCE_CHARS
  } = {}
) {
  positiveInteger(maxSegments, "maxSegments");
  positiveInteger(maxSourceChars, "maxSourceChars");
  if (!Array.isArray(segments)) throw new Error("segments must be an array");

  const batches = [];
  let current = [];
  let currentChars = 0;

  function flush() {
    if (!current.length) return;
    batches.push(current);
    current = [];
    currentChars = 0;
  }

  for (const segment of segments) {
    if (!segment || typeof segment.id !== "string" || typeof segment.text !== "string") {
      throw new Error("Each translation segment requires string id/text");
    }
    const segmentChars = segment.text.length;
    const exceedsCurrent =
      current.length > 0 &&
      (current.length >= maxSegments || currentChars + segmentChars > maxSourceChars);
    if (exceedsCurrent) flush();

    current.push(segment);
    currentChars += segmentChars;

    // A single Notion rich-text segment is normally far below this threshold,
    // but keeping an oversized segment alone preserves ordering and fail-closed
    // validation instead of silently splitting semantic text mid-segment.
    if (segmentChars > maxSourceChars || current.length >= maxSegments) flush();
  }

  flush();
  return batches;
}

export async function requestValidatedTranslationBatch({
  segments = [],
  request,
  validate,
  maxAttempts = DEFAULT_TRANSLATION_BATCH_MAX_ATTEMPTS
} = {}) {
  if (!Array.isArray(segments)) throw new Error("segments must be an array");
  if (typeof request !== "function") throw new Error("request must be a function");
  if (typeof validate !== "function") throw new Error("validate must be a function");
  positiveInteger(maxAttempts, "maxAttempts");

  let previousValidationError = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // Request failures are intentionally not caught here: only a response that
    // reached the strict translation validator is eligible for a bounded retry.
    const response = await request({ segments, attempt, previousValidationError });
    try {
      return validate(segments, response);
    } catch (error) {
      previousValidationError = error instanceof Error ? error.message : String(error);
      if (attempt >= maxAttempts) throw error;
    }
  }

  throw new Error("Translation batch validation exhausted unexpectedly");
}
