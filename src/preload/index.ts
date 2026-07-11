import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("multiCliWork", {
  platform: process.platform,
});

