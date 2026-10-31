/// <reference types="vite/client" />

import type { MultiCliWorkApi } from "@shared/api-types";

declare global {
  interface Window {
    multiCliWork: MultiCliWorkApi;
    MonacoEnvironment: {
      getWorker(workerId: string, label: string): Worker;
    };
  }
}

export {};
