import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

describe("단축키 탭", () => {
  function openKeybindings(settings = DEFAULT_SETTINGS) {
    render(<SettingsDialog settings={settings} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "단축키" }));
  }

  it("카테고리별 목록과 현재 키를 보여주고, 고정 액션에는 변경 버튼이 없다", () => {
    openKeybindings();
    expect(screen.getByText("빠른 열기")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+P")).toBeInTheDocument();
    expect(screen.getByText("슬롯 1 포커스")).toBeInTheDocument();
    const pasteRow = screen.getByText("붙여넣기").closest(".settings-key-row")! as HTMLElement;
    expect(within(pasteRow).getByText("고정")).toBeInTheDocument();
    expect(within(pasteRow).queryByRole("button", { name: "키 변경" })).toBeNull();
  });

  it("키 캡처가 다음 입력을 오버라이드로 저장하고, 기본값 선택은 오버라이드를 지운다", async () => {
    openKeybindings();
    const row = screen.getByText("빠른 열기").closest(".settings-key-row")! as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "키 변경" }));
    expect(document.querySelector("[data-key-capture]")).not.toBeNull();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => expect(update).toHaveBeenCalledWith({ keybindings: { "view.quick-open": "Ctrl+K" } }));
  });

  it("수식어 없는 단독 문자는 거부하고 캡처를 유지한다", async () => {
    openKeybindings();
    const row = screen.getByText("빠른 열기").closest(".settings-key-row")! as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "키 변경" }));
    fireEvent.keyDown(window, { key: "a" });
    expect(update).not.toHaveBeenCalled();
    expect(document.querySelector("[data-key-capture]")).not.toBeNull(); // 계속 캡처 중
  });

  it("충돌 시 기존 바인딩 해제를 물어보고, 확인하면 둘 다 반영한다", async () => {
    openKeybindings();
    const row = screen.getByText("세션 새로고침").closest(".settings-key-row")! as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "키 변경" }));
    fireEvent.keyDown(window, { key: "p", ctrlKey: true }); // 빠른 열기의 Ctrl+P와 충돌
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("빠른 열기"); // 충돌 안내
    fireEvent.click(screen.getByRole("button", { name: "기존 바인딩 해제" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        keybindings: { "session.refresh": "Ctrl+P", "view.quick-open": null },
      }),
    );
  });

  it("고정 키(Ctrl+V 등)와의 충돌은 거부한다", async () => {
    openKeybindings();
    const row = screen.getByText("세션 새로고침").closest(".settings-key-row")! as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "키 변경" }));
    fireEvent.keyDown(window, { key: "v", ctrlKey: true });
    expect(await screen.findByText(/고정 키입니다/)).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it("모두 초기화는 빈 오버라이드 맵을 저장한다", async () => {
    openKeybindings({ ...DEFAULT_SETTINGS, keybindings: { "view.quick-open": "Ctrl+K" } });
    fireEvent.click(screen.getByRole("button", { name: "모두 초기화" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ keybindings: {} }));
  });
});
