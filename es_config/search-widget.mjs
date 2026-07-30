const CSE_CX = "61bca292898fc4066";
const MODAL_ID = "es-search-modal";

function isDark() {
  return document.documentElement.classList.contains("dark");
}

function ensureModal() {
  let overlay = document.getElementById(MODAL_ID);
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = MODAL_ID;
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 9999; display: none;
    align-items: flex-start; justify-content: center;
    padding: 12vh 1rem 1rem; background: rgba(0, 0, 0, 0.5);
  `;

  const panel = document.createElement("div");
  panel.id = "es-search-panel";
  panel.style.cssText = `
    width: min(640px, 100%); max-height: 70vh; overflow: auto;
    border-radius: 0.5rem; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
    padding: 1rem 1.25rem 1.25rem;
  `;

  const closeButton = document.createElement("button");
  closeButton.setAttribute("aria-label", "Close search");
  closeButton.textContent = "✕";
  closeButton.style.cssText = `
    float: right; border: none; background: transparent; font-size: 1rem;
    cursor: pointer; line-height: 1; padding: 0.25rem;
  `;
  closeButton.addEventListener("click", closeModal);

  const title = document.createElement("div");
  title.textContent = "Search EarthScope Docs";
  title.style.cssText = `
    font-weight: 600; font-size: 1rem; margin-bottom: 0.75rem;
  `;

  const container = document.createElement("div");
  container.id = "gcse-search-container";

  panel.appendChild(closeButton);
  panel.appendChild(title);
  panel.appendChild(container);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModal();
  });

  // Google's autocomplete dropdown (`.gssb_c`, a <table> appended to
  // <body>) sets its own inline z-index of 5000, below our overlay's 9999.
  // A stylesheet rule with !important beats a non-!important inline style.
  const style = document.createElement("style");
  style.textContent = `.gssb_c { z-index: 10000 !important; }`;
  document.head.appendChild(style);

  applyTheme(overlay, panel, closeButton, title);
  new MutationObserver(() =>
    applyTheme(overlay, panel, closeButton, title),
  ).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });

  return overlay;
}

function applyTheme(overlay, panel, closeButton, title) {
  const dark = isDark();
  panel.style.background = dark ? "#1c1917" : "#ffffff";
  panel.style.color = dark ? "#e7e5e4" : "#1c1917";
  closeButton.style.color = dark ? "#e7e5e4" : "#1c1917";
  title.style.color = dark ? "#e7e5e4" : "#1c1917";
}

function openModal() {
  const overlay = ensureModal();
  overlay.style.display = "flex";
  ensureSearchRendered();
}

function closeModal() {
  const overlay = document.getElementById(MODAL_ID);
  if (overlay) overlay.style.display = "none";
}

function ensureSearchRendered() {
  if (window.__gcseRendered) return;

  const doRender = () => {
    window.__gcseRendered = true;
    window.google.search.cse.element.render({
      div: "gcse-search-container",
      tag: "search",
    });
  };

  if (window.google && window.google.search) {
    doRender();
    return;
  }

  window.__gcse = window.__gcse || { parsetags: "explicit" };
  window.__gcse.callback = doRender;

  if (!window.__gcseScriptLoading) {
    window.__gcseScriptLoading = true;
    const script = document.createElement("script");
    script.src = `https://cse.google.com/cse.js?cx=${CSE_CX}`;
    script.async = true;
    document.head.appendChild(script);
  }
}

function render({ el }) {
  el.innerHTML = "";
  const button = document.createElement("button");
  button.setAttribute("aria-label", "Search");
  button.style.cssText = `
    display: flex; align-items: center; justify-content: center;
    width: 2.25rem; height: 2.25rem; border-radius: 9999px; border: none;
    background: transparent; cursor: pointer; color: inherit;
  `;
  button.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"
      viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="8"></circle>
      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
    </svg>
  `;
  button.addEventListener("click", openModal);
  el.appendChild(button);
}

export default { render };
