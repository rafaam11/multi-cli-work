import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { startColorScheme } from "./color-scheme";
import { MobileApp } from "./MobileApp";
import "../theme-colors.css";
import "./mobile.css";

startColorScheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MobileApp />
  </StrictMode>,
);
