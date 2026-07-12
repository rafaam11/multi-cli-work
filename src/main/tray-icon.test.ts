import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  TRAY_ICON_PNG_16_BASE64,
  TRAY_ICON_PNG_32_BASE64,
  trayIconDataUrl,
} from "./tray-icon";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readPngDimensions(buffer: Buffer): { width: number; height: number } {
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

describe("tray-icon PNG data", () => {
  it("decodes the 16px PNG with a valid signature and 16x16 dimensions", () => {
    const buffer = Buffer.from(TRAY_ICON_PNG_16_BASE64, "base64");
    expect(buffer.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    expect(readPngDimensions(buffer)).toEqual({ width: 16, height: 16 });
  });

  it("decodes the 32px PNG with a valid signature and 32x32 dimensions", () => {
    const buffer = Buffer.from(TRAY_ICON_PNG_32_BASE64, "base64");
    expect(buffer.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    expect(readPngDimensions(buffer)).toEqual({ width: 32, height: 32 });
  });

  it("builds a data URL with the PNG mime prefix", () => {
    expect(trayIconDataUrl(16)).toBe(`data:image/png;base64,${TRAY_ICON_PNG_16_BASE64}`);
    expect(trayIconDataUrl(32)).toBe(`data:image/png;base64,${TRAY_ICON_PNG_32_BASE64}`);
  });
});

describe("build/icon.png", () => {
  const iconPath = path.resolve(__dirname, "../../build/icon.png");

  it("exists as a 256x256 PNG for electron-builder", () => {
    const buffer = fs.readFileSync(iconPath);
    expect(buffer.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    expect(readPngDimensions(buffer)).toEqual({ width: 256, height: 256 });
  });
});
