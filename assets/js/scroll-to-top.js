const scrollToTop = document.getElementById("scroll-to-top");
const siteFooter = document.getElementById("site-footer");
const SHOW_AFTER_VIEWPORTS = 2;
const MOBILE_INLINE_END = 20;
const DESKTOP_INLINE_END = 24;
const READING_GUTTER_GAP = 20;
const FOOTER_GAP = 16;

let framePending = false;

function setVisible(visible) {
  if (!scrollToTop) return;

  scrollToTop.classList.toggle("translate-y-0", visible);
  scrollToTop.classList.toggle("opacity-100", visible);
  scrollToTop.classList.toggle("translate-y-4", !visible);
  scrollToTop.classList.toggle("opacity-0", !visible);
  scrollToTop.setAttribute("aria-hidden", visible ? "false" : "true");
  scrollToTop.tabIndex = visible ? 0 : -1;
}

function updateInlinePosition() {
  if (!scrollToTop) return;

  const viewportWidth = document.documentElement.clientWidth;
  const baseInlineEnd = viewportWidth >= 768 ? DESKTOP_INLINE_END : MOBILE_INLINE_END;
  let inlineEnd = baseInlineEnd;

  if (viewportWidth >= 1280) {
    const readingLayout = document.querySelector(".article-reading-layout.has-toc");
    if (readingLayout) {
      const layoutRect = readingLayout.getBoundingClientRect();
      const preferredInlineEnd = viewportWidth - (
        layoutRect.right + READING_GUTTER_GAP + scrollToTop.offsetWidth
      );
      inlineEnd = Math.max(baseInlineEnd, preferredInlineEnd);
    }
  }

  scrollToTop.style.setProperty("--scroll-to-top-inline-end", `${Math.round(inlineEnd)}px`);
}

function updateFooterAvoidance() {
  if (!scrollToTop) return;

  const viewportWidth = document.documentElement.clientWidth;
  const baseBottom = viewportWidth >= 768 ? 24 : 16;
  let footerLift = 0;

  if (siteFooter) {
    const footerTop = siteFooter.getBoundingClientRect().top;
    const desiredBottom = window.innerHeight - footerTop + FOOTER_GAP;
    footerLift = Math.max(0, desiredBottom - baseBottom);
  }

  scrollToTop.style.setProperty("--scroll-to-top-footer-lift", `${Math.round(footerLift)}px`);
}

function updateScrollToTop() {
  if (!scrollToTop) return;

  setVisible(window.scrollY > window.innerHeight * SHOW_AFTER_VIEWPORTS);
  updateInlinePosition();
  updateFooterAvoidance();
}

function scheduleUpdate() {
  if (framePending) return;
  framePending = true;
  requestAnimationFrame(() => {
    framePending = false;
    updateScrollToTop();
  });
}

if (scrollToTop) {
  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate);
  window.addEventListener("load", scheduleUpdate);
  scheduleUpdate();
}
