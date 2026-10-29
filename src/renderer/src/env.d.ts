/// <reference types="vite/client" />

import type { MultiCliWorkApi } from "@shared/api-types";

declare global {
  interface Window {
    mcwV2?: import("@shared/v2-api").McwV2Api;
    multiCliWork: MultiCliWorkApi;
    MonacoEnvironment: {
      getWorker(workerId: string, label: string): Worker;
    };
  }
}

export {};
