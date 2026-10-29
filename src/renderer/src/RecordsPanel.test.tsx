import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MultiCliWorkApi, TerminalSessionView } from "@shared/api-types";
import type { BoardMessage } from "@shared/board-types";
import type { DeliveryRecord } from "@shared/delivery-types";
import { RecordsPanel, type RecordsPanelProps } from "./RecordsPanel";

afterEach(cleanup);
const sessions = ["p1", "p2"].map((projectId, index): TerminalSessionView => ({ id: `s${index + 1}`, projectId, worktreeId: index ? undefined : "w1", kind: "codex", name: `Builder ${index + 1}`, title: null, tool: null, cwd: `C:\\${projectId}`, status: "working", pid: 1, exitCode: null, providerConversationId: null, interruptedByShutdown: false, createdAt: "2026-10-29T01:00:00Z", updatedAt: "2026-10-29T01:00:00Z" }));
const message: BoardMessage = { id: "m1", projectId: "p1", author: { kind: "user" }, kind: "direct", text: "original request", to: [{ sessionId: "s1", name: "Builder 1", agent: "codex", deliveryId: "d1", delivery: "held", deliveryText: "revised request" }], createdAt: "2026-10-29T02:00:00Z" };
const delivery: DeliveryRecord = { id: "d1", projectId: "p1", from: null, to: "s1", text: "revised request", state: "held", reason: "working", createdAt: 1, settledAt: null };
let listener: (message: BoardMessage) => void;
const board = { list: vi.fn(), onChange: vi.fn((fn: typeof listener) => { listener = fn; return () => undefined; }) };
const deliveries = { list: vi.fn() };
const activity = { list: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  board.list.mockResolvedValue([message]); deliveries.list.mockResolvedValue([delivery]); activity.list.mockResolvedValue([]);
  window.multiCliWork = { board, deliveries, activity, workbench: { state: async () => ({ state: { forks: {} }, writable: true }) } } as unknown as MultiCliWorkApi;
});
function mount(overrides: Partial<RecordsPanelProps> = {}) {
  const props: RecordsPanelProps = { hidden: false, projectId: "p1", projectLabel: "Atlas", sessions, selected: sessions[0], indicators: {}, activityLog: [], onFocusSession: vi.fn(), onUnreadChange: vi.fn(), onManageDeliveries: vi.fn(), ...overrides };
  return { props, ...render(<RecordsPanel {...props} />) };
}
it("shows original and recipient-specific text while keeping activity collapsed until requested", async () => {
  mount();
  expect(await screen.findByText("original request")).toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(activity.list).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("전달 내용"));
  expect(screen.getAllByText("revised request").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "상세 활동 펼치기" }));
  await waitFor(() => expect(activity.list).toHaveBeenCalledWith("s1"));
  expect(screen.getByRole("region", { name: "선택 세션 정보" })).toHaveTextContent("Builder 1");
});
it("scopes queue records by the captured folder even after a target closes", async () => {
  deliveries.list.mockResolvedValue([delivery, { ...delivery, id: "other", to: "s2", projectId: "p2", text: "foreign" }]);
  mount({ sessions: [sessions[1]], selected: sessions[1] });
  fireEvent.click(await screen.findByRole("button", { name: /전달 대기 1/ }));
  expect(within(screen.getByRole("region", { name: "전달 대기 및 실패" })).queryByText("foreign")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "상세 활동 펼치기" })).not.toBeInTheDocument();
});
it("does not present a historical held message as an active queued delivery after restart", async () => {
  deliveries.list.mockResolvedValue([]);
  mount();
  expect(await screen.findByText("현재 전달 상태 확인 불가")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /전달 대기 1/ })).not.toBeInTheDocument();
});
it("keeps changes that arrive while the first list is still loading", async () => {
  let resolve!: (messages: BoardMessage[]) => void;
  board.list.mockImplementationOnce(() => new Promise<BoardMessage[]>(r => { resolve = r; }));
  mount();
  act(() => listener({ ...message, id: "m2", text: "arrived during load", createdAt: "2026-10-29T03:00:00Z" }));
  await act(async () => resolve([message]));
  expect(await screen.findByText("arrived during load")).toBeInTheDocument();
  expect(screen.getAllByRole("article")[0]).toHaveTextContent("arrived during load");
});
it("ignores an old folder load and does not show another folder's selected activity", async () => {
  let resolve!: (messages: BoardMessage[]) => void;
  board.list.mockImplementationOnce(() => new Promise<BoardMessage[]>(r => { resolve = r; }));
  const view = mount();
  board.list.mockResolvedValue([]);
  view.rerender(<RecordsPanel {...view.props} projectId="p2" projectLabel="Other" />);
  await act(async () => resolve([message]));
  expect(screen.queryByText("original request")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "상세 활동 펼치기" })).not.toBeInTheDocument();
});
it("shows read failures separately from empty states and recovers on retry", async () => {
  board.list.mockRejectedValueOnce(new Error("read denied"));
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("read denied");
  expect(screen.queryByText("아직 메시지가 없습니다.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "메시지 다시 불러오기" }));
  expect(await screen.findByText("original request")).toBeInTheDocument();
});
it("counts new messages while hidden but not delivery updates", async () => {
  const view = mount({ hidden: true });
  await waitFor(() => expect(board.list).toHaveBeenCalled());
  await act(async () => undefined);
  act(() => listener({ ...message, id: "m2" }));
  await waitFor(() => expect(view.props.onUnreadChange).toHaveBeenLastCalledWith(1));
  act(() => listener({ ...message, to: [] }));
  expect(view.props.onUnreadChange).toHaveBeenLastCalledWith(1);
  view.rerender(<RecordsPanel {...view.props} hidden={false} />);
  await waitFor(() => expect(view.props.onUnreadChange).toHaveBeenLastCalledWith(0));
});
it("asks for a folder without querying global records", () => {
  mount({ projectId: null });
  expect(screen.getByText("폴더를 선택하면 기록을 표시합니다.")).toBeInTheDocument();
  expect(board.list).not.toHaveBeenCalled(); expect(deliveries.list).not.toHaveBeenCalled();
});
it("does not mark an event already viewed during initial loading unread after switching tabs", async () => {
  let resolve!: (messages: BoardMessage[]) => void;
  board.list.mockImplementationOnce(() => new Promise<BoardMessage[]>(r => { resolve = r; }));
  const view = mount();
  act(() => listener({ ...message, id: "seen-during-load" }));
  expect(await screen.findByText("original request")).toBeInTheDocument();
  view.rerender(<RecordsPanel {...view.props} hidden />);
  await act(async () => resolve([]));
  await waitFor(() => expect(view.props.onUnreadChange).toHaveBeenLastCalledWith(0));
});
