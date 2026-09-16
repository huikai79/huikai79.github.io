(() => {
  const fallbackCopy = (value) => {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("copy command failed");
  };

  const copyText = async (value) => {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }
    fallbackCopy(value);
  };

  document.querySelectorAll("[data-copy-share-url]").forEach((button) => {
    if (button.dataset.copyBound === "true") return;
    button.dataset.copyBound = "true";

    const label = button.querySelector("[data-copy-share-label]");
    const original = button.dataset.copyLabel || label?.textContent || "Copy link";
    const success = button.dataset.copySuccess || original;
    const failure = button.dataset.copyFailure || original;
    let resetTimer;

    button.addEventListener("click", async () => {
      window.clearTimeout(resetTimer);
      try {
        await copyText(button.dataset.copyShareUrl || window.location.href);
        if (label) label.textContent = success;
      } catch {
        if (label) label.textContent = failure;
      }

      resetTimer = window.setTimeout(() => {
        if (label) label.textContent = original;
      }, 2200);
    });
  });
})();
