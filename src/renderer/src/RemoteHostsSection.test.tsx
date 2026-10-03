import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteHostInfo } from "@shared/remote-types";
import { RemoteHostsSection } from "./RemoteHostsSection";

const OFFICE: RemoteHostInfo = { hostId: "h1", name: "회사PC", address: "100.64.0.9:47821", notify: true, paired: true, addedAt: "" };
const HOME: RemoteHostInfo = { hostId: "h2", name: "집PC", address: "100.64.0.7:47821", notify: true, paired: false, addedAt: "" };

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

  it("says why a host could not be opened", async () => {
    remoteHosts.open.mockRejectedValue(new Error("Error invoking remote method 'remote-hosts:open': Error: 호스트에 연결하지 못했습니다"));
    render(<RemoteHostsSection onOpenSettings={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /회사PC/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("호스트에 연결하지 못했습니다");
  });
});
