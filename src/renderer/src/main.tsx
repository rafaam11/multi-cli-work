import React from "react";
import ReactDOM from "react-dom/client";
import { MotionConfig } from "motion/react";
import { App } from "./App";
import { applyStoredTheme } from "./theme";
import "./theme-colors.css";
import "./index.css";

applyStoredTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Follows the OS "show animations" setting, as index.css's reduced-motion block does. */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </React.StrictMode>,
);

