import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MobileApp } from "./MobileApp";
import "../theme-colors.css";
import "./mobile.css";

// 원격 화면은 호스트의 테마 설정을 모른다 — 이 기기의 밝기 설정을 따른다(기본은 어둡게).
const lightQuery = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: light)") : null;
const applyColorScheme = () => {
  document.documentElement.dataset.theme = lightQuery?.matches ? "light" : "dark";
};
applyColorScheme();
lightQuery?.addEventListener("change", applyColorScheme);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MobileApp />
  </StrictMode>,
);
