import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MultiCliWorkApi } from "@shared/api-types";
import { DEFAULT_SETTINGS } from "@shared/settings-types";
import { SettingsDialog } from "./SettingsDialog";

const DEFAULT_CATEGORIES = DEFAULT_SETTINGS.projects.categories;

const update = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
const notion = {
  status: vi.fn(),
  setToken: vi.fn(),
  clearToken: vi.fn(),
  inspectLink: vi.fn(),
};

beforeEach(() => {
  update.mockClear();
  notion.status.mockReset().mockResolvedValue({ configured: false, encryptionAvailable: true });
  notion.setToken.mockReset().mockResolvedValue({ configured: true, encryptionAvailable: true });
  notion.clearToken.mockReset().mockResolvedValue({ configured: false, encryptionAvailable: true });
  window.multiCliWork = {
    settings: { get: vi.fn().mockResolvedValue(DEFAULT_SETTINGS), update, onChange: vi.fn(() => () => undefined) },
    notion,
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

describe("프로젝트 탭", () => {
  function openProjects(settings = DEFAULT_SETTINGS) {
    render(<SettingsDialog settings={settings} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "프로젝트" }));
  }

  it("기본 목록 4행을 순서대로 보여주고, 첫 행의 색이 선택돼 있다", () => {
    openProjects();
    const list = screen.getByRole("list", { name: "구분 목록" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(screen.getByLabelText("구분 1 이름")).toHaveValue("업무");
    const swatches = within(rows[0]!).getByRole("radiogroup", { name: "업무 색" });
    expect(within(swatches).getByRole("radio", { name: "색 1" })).toHaveAttribute("aria-checked", "true");
  });

  it("색을 클릭하면 그 행만 바뀐 전체 목록을 즉시 저장한다", async () => {
    openProjects();
    const firstRow = screen.getAllByRole("listitem")[0]!;
    fireEvent.click(within(firstRow).getByRole("radio", { name: "색 6" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        projects: { categories: [{ name: "업무", color: 6 }, ...DEFAULT_CATEGORIES.slice(1)] },
      }),
    );
  });

  it("위로 버튼이 항목 순서를 바꾼다", async () => {
    openProjects();
    fireEvent.click(screen.getByRole("button", { name: "개인 위로" }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    const sent = update.mock.calls.at(-1)![0];
    expect(sent.projects.categories[0].name).toBe("개인");
    expect(screen.getByLabelText("구분 1 이름")).toHaveValue("개인");
  });

  it("하나만 남으면 삭제가 비활성화된다", async () => {
    openProjects();
    fireEvent.click(screen.getByRole("button", { name: "개인 삭제" }));
    fireEvent.click(screen.getByRole("button", { name: "연구 삭제" }));
    fireEvent.click(screen.getByRole("button", { name: "기타 삭제" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(1));
    expect(screen.getByRole("button", { name: "업무 삭제" })).toBeDisabled();
  });

  it("구분 추가는 새 구분을 끝에 붙이고 그 입력에 포커스한다", () => {
    openProjects();
    fireEvent.click(screen.getByRole("button", { name: "구분 추가" }));
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    const newInput = screen.getByLabelText("구분 5 이름");
    expect(newInput).toHaveValue("새 구분");
    expect(newInput).toHaveFocus();
  });

  it("이름은 blur에서만 저장되고, 빈 값 blur는 저장 없이 원복한다", async () => {
    openProjects();
    const input = screen.getByLabelText("구분 1 이름");
    fireEvent.change(input, { target: { value: "영업" } });
    expect(update).not.toHaveBeenCalled();
    fireEvent.blur(input);
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        projects: { categories: [{ name: "영업", color: 1 }, ...DEFAULT_CATEGORIES.slice(1)] },
      }),
    );
    update.mockClear();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(update).not.toHaveBeenCalled();
    expect(input).toHaveValue("영업");
  });

  it("기본 구분 선택이 즉시 저장된다", async () => {
    openProjects();
    fireEvent.change(screen.getByLabelText("기본 구분"), { target: { value: "연구" } });
    await waitFor(() => expect(update).toHaveBeenCalledWith({ projects: { defaultCategory: "연구" } }));
  });

  it("기본 구분을 지우면 목록만 보내고, 화면은 첫 항목을 새 기본 구분으로 보여준다", async () => {
    openProjects(); // 기본 구분은 DEFAULT_SETTINGS 기준 "기타"(4번째 행)
    fireEvent.click(screen.getByRole("button", { name: "기타 삭제" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        projects: { categories: DEFAULT_CATEGORIES.slice(0, 3) },
      }),
    );
    expect(screen.getByLabelText("기본 구분")).toHaveValue("업무");
  });

  it("기본 구분의 이름을 바꾸면 한 패치에 목록과 새 기본 구분을 함께 보낸다", async () => {
    openProjects();
    const input = screen.getByLabelText("구분 4 이름"); // "기타" — 기본 구분
    fireEvent.change(input, { target: { value: "잡무" } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        projects: {
          categories: [...DEFAULT_CATEGORIES.slice(0, 3), { name: "잡무", color: 5 }],
          defaultCategory: "잡무",
        },
      }),
    );
    expect(screen.getByLabelText("기본 구분")).toHaveValue("잡무");
  });

  it("Enter는 이름을 커밋하고, 조합 중 Enter는 무시한다", async () => {
    openProjects();
    const input = screen.getByLabelText("구분 1 이름");
    input.focus(); // blur()는 실제로 포커스된 엘리먼트에서만 이벤트를 낸다
    fireEvent.change(input, { target: { value: "영업" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(update).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        projects: { categories: [{ name: "영업", color: 1 }, ...DEFAULT_CATEGORIES.slice(1)] },
      }),
    );
  });
});

describe("노션 탭", () => {
  async function openNotion() {
    render(<SettingsDialog settings={DEFAULT_SETTINGS} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "노션" }));
    await waitFor(() => expect(notion.status).toHaveBeenCalled());
  }

  it("현재 상태를 보여주고, 저장하면 입력칸을 비운다 — 토큰은 DOM에 남지 않는다", async () => {
    await openNotion();
    expect(await screen.findByText("설정되지 않음")).toBeInTheDocument();

    const input = screen.getByLabelText("통합 토큰") as HTMLInputElement;
    expect(input.type).toBe("password");
    fireEvent.change(input, { target: { value: "  ntn_supersecret  " } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(notion.setToken).toHaveBeenCalledWith("ntn_supersecret"));
    expect(await screen.findByText("연결됨")).toBeInTheDocument();
    expect(input.value).toBe("");
    expect(document.body.innerHTML).not.toContain("ntn_supersecret");
  });

  it("저장이 거절되면 사유를 그대로 보여주고 상태는 그대로다", async () => {
    notion.setToken.mockRejectedValue(
      new Error("Error invoking remote method 'notion:set-token': Error: 노션 토큰이 유효하지 않습니다"),
    );
    await openNotion();
    fireEvent.change(screen.getByLabelText("통합 토큰"), { target: { value: "ntn_wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("노션 토큰이 유효하지 않습니다");
    expect(screen.getByText("설정되지 않음")).toBeInTheDocument();
  });

  it("설정된 토큰만 제거할 수 있다", async () => {
    notion.status.mockResolvedValue({ configured: true, encryptionAvailable: true });
    await openNotion();
    const remove = await screen.findByRole("button", { name: "제거" });
    await waitFor(() => expect(remove).toBeEnabled());
    fireEvent.click(remove);
    await waitFor(() => expect(notion.clearToken).toHaveBeenCalled());
    expect(await screen.findByText("설정되지 않음")).toBeInTheDocument();
  });

  it("안전한 저장이 불가능한 환경이면 입력을 막는다", async () => {
    notion.status.mockResolvedValue({ configured: false, encryptionAvailable: false });
    await openNotion();
    await waitFor(() => expect(screen.getByLabelText("통합 토큰")).toBeDisabled());
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("안전하게 저장할 수 없어");
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
