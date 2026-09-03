import type { TerminalSessionView } from "@shared/api-types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentRow, SessionRow, type DocumentRowProps, type SessionRowProps } from "./PaneRows";
import type { DocumentPane } from "./pane-items";

const session: TerminalSessionView = {
  id: "session-1",
  projectId: "project-atlas",
  tool: null,
  title: null,
  name: "배포 준비",
  kind: "powershell",
  cwd: "C:\\work\\atlas",
  providerConversationId: null,
  interruptedByShutdown: false,
  status: "working",
  pid: 4100,
  exitCode: null,
  createdAt: "2026-08-11T01:00:00.000Z",
  updatedAt: "2026-08-11T01:00:00.000Z",
};

const documentPane: DocumentPane = {
  id: "file:readme",
  kind: "file",
  label: "README.md",
  detail: "Atlas",
  dirty: false,
  owner: { kind: "project", id: "project-atlas" },
};

const dragProps = { draggable: true, onDragStart: vi.fn(), onDragEnd: vi.fn() };

function renderSession(overrides: Partial<SessionRowProps> = {}) {
  const props: SessionRowProps = {
    session,
    label: "배포 준비",
    agent: undefined,
    tool: false,
    attention: null,
    current: false,
    onScreen: false,
    verb: "세션 열기",
    onSelect: vi.fn(),
    onContextMenu: vi.fn(),
    renaming: false,
    initialName: "배포 준비",
    onRename: vi.fn(),
    onCancelRename: vi.fn(),
    dragProps,
    ...overrides,
  };
  render(
    <ul>
      <SessionRow {...props} />
    </ul>,
  );
  return props;
}

function renderDocument(overrides: Partial<DocumentRowProps> = {}) {
  const props: DocumentRowProps = {
    pane: documentPane,
    label: documentPane.label,
    current: false,
    onScreen: false,
    verb: "문서 열기",
    onOpen: vi.fn(),
    dragProps,
    ...overrides,
  };
  render(
    <ul>
      <DocumentRow {...props} />
    </ul>,
  );
  return props;
}

afterEach(() => {
  cleanup();
});

describe("SessionRow", () => {
  it("접근성 이름의 동사가 부르는 쪽을 따른다 — 트리는 세션 열기, 패널은 패인 열기", () => {
    renderSession();
    expect(screen.getByRole("button", { name: "배포 준비 세션 열기" })).toBeInTheDocument();

    cleanup();
    renderSession({ verb: "패인 열기" });
    expect(screen.getByRole("button", { name: "배포 준비 패인 열기" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "배포 준비 세션 열기" })).not.toBeInTheDocument();
  });

  it("읽지 않음은 이름 뒤에 붙고, 점은 이름에 새지 않는다", () => {
    renderSession({ attention: "approval" });
    const row = screen.getByRole("button", { name: "배포 준비 세션 열기 (읽지 않음)" });
    expect(row.querySelector(".unread-dot")).toHaveClass("unread-approval");
  });

  it("상태·초점·화면 클래스가 한 행에 함께 선다", () => {
    renderSession({ current: true, onScreen: true });
    const row = screen.getByRole("button", { name: "배포 준비 세션 열기" }).closest(".session-row");
    expect(row).toHaveClass("file-tab-row", "status-working", "current", "on-screen");
    expect(row?.querySelector(".status-dot")).toHaveClass("status-working");
  });

  it("초점도 화면도 아니면 그 두 클래스가 없다", () => {
    renderSession();
    const row = screen.getByRole("button", { name: "배포 준비 세션 열기" }).closest(".session-row");
    expect(row).not.toHaveClass("current");
    expect(row).not.toHaveClass("on-screen");
  });

  it("이름 변경 중에는 열기 버튼 대신 입력칸이 선다", () => {
    const props = renderSession({ renaming: true });
    expect(screen.queryByRole("button", { name: /세션 열기/ })).not.toBeInTheDocument();

    const field = screen.getByRole("textbox", { name: "세션 이름" });
    fireEvent.change(field, { target: { value: "새 이름" } });
    fireEvent.submit(field);
    expect(props.onRename).toHaveBeenCalledWith("새 이름");
  });

  it("소속 칸은 넘겨준 곳에서만 보이고, title에 함께 실린다", () => {
    renderSession({ place: "Atlas", branch: "feature-x", verb: "패인 열기" });
    const row = screen.getByRole("button", { name: "배포 준비 패인 열기" });
    expect(row).toHaveAttribute("title", "Atlas · ⎇ feature-x · 배포 준비");
    expect(row.querySelector(".session-row-place")).toHaveTextContent("Atlas");

    cleanup();
    renderSession();
    const bare = screen.getByRole("button", { name: "배포 준비 세션 열기" });
    expect(bare).toHaveAttribute("title", "배포 준비");
    expect(bare.querySelector(".session-row-place")).toBeNull();
  });

  it("행 끝 슬롯은 열기 버튼 밖의 형제로 선다", () => {
    renderSession({
      trailing: (
        <button type="button" className="file-tab-close" aria-label="배포 준비 작업공간에서 숨기기" />
      ),
    });
    const open = screen.getByRole("button", { name: "배포 준비 세션 열기" });
    const trailing = screen.getByRole("button", { name: "배포 준비 작업공간에서 숨기기" });
    expect(open.contains(trailing)).toBe(false);
    expect(open.parentElement).toBe(trailing.parentElement);
  });

  it("클릭은 열기를, 우클릭은 메뉴를 부른다", () => {
    const props = renderSession();
    const row = screen.getByRole("button", { name: "배포 준비 세션 열기" });

    fireEvent.click(row);
    expect(props.onSelect).toHaveBeenCalledTimes(1);

    fireEvent.contextMenu(row);
    expect(props.onContextMenu).toHaveBeenCalledTimes(1);
  });
});

describe("DocumentRow", () => {
  it("동사가 부르는 쪽을 따르고, 저장 안 됨은 이름 뒤에 붙는다", () => {
    renderDocument();
    expect(screen.getByRole("button", { name: "README.md 문서 열기" })).toBeInTheDocument();

    cleanup();
    renderDocument({ pane: { ...documentPane, dirty: true } });
    const dirty = screen.getByRole("button", { name: "README.md 문서 열기 (저장 안 됨)" });
    expect(dirty.querySelector(".file-tab-dot")).toHaveClass("dirty");

    cleanup();
    renderDocument({ verb: "패인 열기" });
    expect(screen.getByRole("button", { name: "README.md 패인 열기" })).toBeInTheDocument();
  });

  it("트리의 ✕는 행 끝 슬롯으로 들어와 열기 버튼과 나란히 선다", () => {
    const onClose = vi.fn();
    renderDocument({
      trailing: (
        <button type="button" className="file-tab-close" aria-label="README.md 닫기" onClick={onClose} />
      ),
    });

    fireEvent.click(screen.getByRole("button", { name: "README.md 닫기" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "README.md 문서 열기" }).closest(".session-row")).toHaveClass(
      "file-tab-row",
    );
  });

  it("초점과 화면 클래스는 세션 행과 같은 규칙을 쓴다", () => {
    renderDocument({ current: true, onScreen: false });
    const row = screen.getByRole("button", { name: "README.md 문서 열기" }).closest(".session-row");
    expect(row).toHaveClass("current");
    expect(row).not.toHaveClass("on-screen");
  });
});
