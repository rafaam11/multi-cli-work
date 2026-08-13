import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MultiCliWorkApi } from "@shared/api-types";
import { DEFAULT_SETTINGS } from "@shared/settings-types";
import { SettingsDialog } from "./SettingsDialog";

const update = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);

beforeEach(() => {
  update.mockClear();
  window.multiCliWork = {
    settings: { get: vi.fn().mockResolvedValue(DEFAULT_SETTINGS), update, onChange: vi.fn(() => () => undefined) },
  } as unknown as MultiCliWorkApi;
});

afterEach(cleanup);

describe("SettingsDialog", () => {
  it("일반 탭에서 언어·트레이·자동 재개·업데이트 확인이 부분 패치로 저장된다", async () => {
    render(<SettingsDialog settings={DEFAULT_SETTINGS} onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText("언어"), { target: { value: "en" } });
    await waitFor(() => expect(update).toHaveBeenCalledWith({ language: "en" }));
    fireEvent.click(screen.getByLabelText("창을 닫으면 트레이에 남기기"));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ general: { closeToTray: false } }));
  });

  it("터미널 탭의 글꼴 크기 변경이 저장되고, 범위 밖 값은 보내지 않는다", async () => {
    render(<SettingsDialog settings={DEFAULT_SETTINGS} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "터미널" }));
    const fontSize = screen.getByLabelText("글꼴 크기");
    fireEvent.change(fontSize, { target: { value: "16" } });
    await waitFor(() => expect(update).toHaveBeenCalledWith({ terminal: { fontSize: 16 } }));
    update.mockClear();
    fireEvent.change(fontSize, { target: { value: "99" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(update).not.toHaveBeenCalled();
  });

  it("알림 탭에서 마스터·상태별 토글이 저장된다", async () => {
    render(<SettingsDialog settings={DEFAULT_SETTINGS} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "알림" }));
    fireEvent.click(screen.getByLabelText("데스크톱 알림"));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ notifications: { desktop: false } }));
    fireEvent.click(screen.getByLabelText("종료"));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ notifications: { statuses: { exited: true } } }),
    );
  });

  it("ESC와 바깥 클릭이 닫는다", () => {
    const onClose = vi.fn();
    render(<SettingsDialog settings={DEFAULT_SETTINGS} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(document.querySelector(".modal-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
