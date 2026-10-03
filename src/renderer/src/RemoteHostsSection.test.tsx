import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteHostView } from "@shared/remote-types";
import { RemoteHostsSection } from "./RemoteHostsSection";

const OFFICE: RemoteHostView = { hostId: "h1", name: "회사PC", address: "100.64.0.9:47821", notify: true, paired: true, addedAt: "", link: "open", awaiting: 2 };
const HOME: RemoteHostView = { hostId: "h2", name: "집PC", address: "100.64.0.7:47821", notify: true, paired: false, addedAt: "", link: "off", awaiting: 0 };

const remoteHosts = {
  list: vi.fn(),
  open: vi.fn(),
  onChanged: vi.fn(() => () => undefined),
};

afterEach(cleanup);

beforeEach(() => {
  remoteHosts.list.mockResolvedValue([OFFICE, HOME]);
  remoteHosts.open.mockResolvedValue(undefined);
  (window as unknown as { multiCliWork: unknown }).multiCliWork = { remoteHosts };
});

describe("RemoteHostsSection", () => {
  it("draws nothing when no host is registered", async () => {
    remoteHosts.list.mockResolvedValue([]);
    const { container } = render(<RemoteHostsSection onOpenSettings={vi.fn()} />);
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
  });

  it("opens a paired host's window", async () => {
    render(<RemoteHostsSection onOpenSettings={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /회사PC/ }));
    expect(remoteHosts.open).toHaveBeenCalledWith("h1");
  });

  it("sends a host that needs pairing again to the settings", async () => {
    const onOpenSettings = vi.fn();
    render(<RemoteHostsSection onOpenSettings={onOpenSettings} />);
    fireEvent.click(await screen.findByRole("button", { name: /집PC/ }));
    expect(screen.getByText("다시 페어링 필요")).toBeInTheDocument();
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(remoteHosts.open).not.toHaveBeenCalled();
  });

  it("shows that a host is being opened until the window is up", async () => {
    let finish: () => void = () => undefined;
    remoteHosts.open.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<RemoteHostsSection onOpenSettings={vi.fn()} />);
    const button = await screen.findByRole("button", { name: /회사PC/ });
    fireEvent.click(button);
    expect(await screen.findByText("여는 중…")).toBeInTheDocument();
    expect(button).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.queryByText("여는 중…")).not.toBeInTheDocument());
    expect(button).toBeEnabled();
  });

  it("shows the link state and how many sessions wait", async () => {
    remoteHosts.list.mockResolvedValue([
      OFFICE,
      HOME,
      { ...OFFICE, hostId: "h3", name: "서버", link: "reconnecting", awaiting: 0 },
      { ...OFFICE, hostId: "h4", name: "옛PC", link: "incompatible", awaiting: 0 },
    ]);
    render(<RemoteHostsSection onOpenSettings={vi.fn()} />);
    const office = await screen.findByRole("button", { name: /회사PC/ });
    expect(within(office).getByLabelText("연결됨")).toBeInTheDocument();
    expect(within(office).getByLabelText("대기 중인 세션 2개")).toHaveTextContent("2");
    // 다시 페어링해야 하는 호스트에는 연결이 없다 — 상태 점도 대기 수도 없다.
    const home = screen.getByRole("button", { name: /집PC/ });
    expect(within(home).queryByRole("img")).not.toBeInTheDocument();
    expect(within(home).queryByLabelText(/대기 중인 세션/)).not.toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: /서버/ })).getByLabelText("연결 끊김")).toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: /옛PC/ })).getByLabelText("버전이 맞지 않음")).toBeInTheDocument();
  });

  it("says why a host could not be opened", async () => {
    remoteHosts.open.mockRejectedValue(new Error("Error invoking remote method 'remote-hosts:open': Error: 호스트에 연결하지 못했습니다"));
    render(<RemoteHostsSection onOpenSettings={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /회사PC/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("호스트에 연결하지 못했습니다");
  });
});
