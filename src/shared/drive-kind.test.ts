import { describe, expect, it } from "vitest";
import { driveKindLabel, inferDriveKind, isDriveKind, isSyncedDriveKind } from "./drive-kind";

describe("inferDriveKind", () => {
  it("동기화 클라이언트의 관례 경로로 종류를 짐작한다", () => {
    expect(inferDriveKind("G:\\내 드라이브")).toBe("gdrive");
    expect(inferDriveKind("/Users/me/Google Drive/My Drive")).toBe("gdrive");
    expect(inferDriveKind("C:\\Users\\PC\\OneDrive - 노바테크")).toBe("onedrive");
    expect(inferDriveKind("C:\\Users\\PC\\Dropbox")).toBe("dropbox");
    expect(inferDriveKind("C:\\Users\\PC\\iCloudDrive")).toBe("icloud");
    expect(inferDriveKind("\\\\nas\\docs")).toBe("nas");
  });

  it("모르는 경로와 루트 없음은 일반 폴더다", () => {
    expect(inferDriveKind("D:\\문서")).toBe("folder");
    expect(inferDriveKind("G:\\내 드라이브백업")).toBe("folder");
    expect(inferDriveKind(null)).toBe("folder");
  });
});

describe("drive kind helpers", () => {
  it("id를 검사하고 이름을 돌려준다", () => {
    expect(isDriveKind("nas")).toBe(true);
    expect(isDriveKind("ftp")).toBe(false);
    expect(driveKindLabel("onedrive")).toBe("OneDrive");
  });

  it("로컬 디스크·일반 폴더만 동기화 저장소가 아니다", () => {
    expect(isSyncedDriveKind("gdrive")).toBe(true);
    expect(isSyncedDriveKind("nas")).toBe(true);
    expect(isSyncedDriveKind("local")).toBe(false);
    expect(isSyncedDriveKind("folder")).toBe(false);
  });
});
