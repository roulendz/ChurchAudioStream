import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./i18n/init";
import App from "./App";
import "./styles/themes.css";
import "./styles/index.css";
import { registerControllerChangeListener } from "./lib/sw-lifecycle";

registerControllerChangeListener();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
