import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/main/index.ts"),
          "terminal-worker": resolve("src/main/terminal-worker.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/preload/index.ts"),
          // 원격 창(다른 PC가 서빙한 페이지)에 심는 셸 브리지.
          "remote-shell": resolve("src/preload/remote-shell.ts"),
        },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
        "@shared": resolve("src/shared"),
      },
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/renderer/index.html"),
          // 모바일 컴패니언 화면. 데스크톱 설치본에 같이 들어가고 원격 서버가 /mobile/로 서빙한다.
          mobile: resolve("src/renderer/mobile.html"),
        },
      },
    },
  },
});
