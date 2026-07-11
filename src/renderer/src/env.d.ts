import type { MultiCliWorkApi } from "@shared/api-types";

declare global {
  interface Window {
    multiCliWork: MultiCliWorkApi;
  }
}

export {};
