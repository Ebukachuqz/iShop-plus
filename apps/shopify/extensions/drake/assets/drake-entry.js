// Shopify's automatically loaded entrypoint stays small; voice loads the other modules in order.
(function () {
  "use strict";
  const root = document.getElementById("ishop-drake-root");
  if (!root || root.dataset.drakeEntryLoaded) return;
  root.dataset.drakeEntryLoaded = "true";
  const script = document.createElement("script");
  script.src = root.dataset.voiceScriptUrl;
  script.onerror = () => {
    root.dataset.bootstrapState = "failed";
    root.hidden = false;
    root.textContent = "Drake could not load. Please refresh to retry.";
  };
  document.head.appendChild(script);
})();
