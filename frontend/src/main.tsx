import { applyGlobalPreferences, getPreferences } from "./lib/preferences";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

// Before anything renders: #root is empty until createRoot below, so applying
// the cached display/accessibility preferences here means no page can paint
// in the wrong text size, contrast or motion setting first.
applyGlobalPreferences(getPreferences());

const container = document.getElementById("root");
if (!container) throw new Error("#root missing from index.html");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
