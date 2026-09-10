const readingProgressBar = document.getElementById("reading-progress");
const readingArticle = document.querySelector(".article-main");
const READING_LINE_RATIO = 0.33;

let readingProgressFramePending = false;

function clampReadingProgress(value) {
  return Math.min(1, Math.max(0, value));
}

function updateReadingProgress() {
  if (!readingProgressBar || !readingArticle) return;

  const articleRect = readingArticle.getBoundingClientRect();
  const articleTop = articleRect.top + window.scrollY;
  const articleBottom = articleRect.bottom + window.scrollY;
  const articleHeight = Math.max(1, articleBottom - articleTop);
  const readingLine = window.scrollY + window.innerHeight * READING_LINE_RATIO;
  const progress = clampReadingProgress((readingLine - articleTop) / articleHeight);

  readingProgressBar.style.width = `${(progress * 100).toFixed(3)}%`;
  readingProgressBar.dataset.progress = progress.toFixed(4);
}

function scheduleReadingProgressUpdate() {
  if (readingProgressFramePending) return;
  readingProgressFramePending = true;
  requestAnimationFrame(() => {
    readingProgressFramePending = false;
    updateReadingProgress();
  });
}

if (readingProgressBar && readingArticle) {
  window.addEventListener("scroll", scheduleReadingProgressUpdate, { passive: true });
  window.addEventListener("resize", scheduleReadingProgressUpdate);
  window.addEventListener("load", scheduleReadingProgressUpdate);
  scheduleReadingProgressUpdate();
}
