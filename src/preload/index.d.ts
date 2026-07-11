export {};

declare global {
  interface Window {
    multiCliWork: {
      platform: NodeJS.Platform;
    };
  }
}

