import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/settings-types";
import { RemoteSettings } from "./RemoteSettings";

const remote = {
  status: vi.fn(),
  issuePairingCode: vi.fn(),
  listDevices: vi.fn(),
  revokeDevice: vi.fn(),
};
const update = vi.fn();

afterEach(cleanup);

beforeEach(() => {
  remote.status.mockResolvedValue({ state: "listening", url: "http://100.64.0.9:47821/mobile/", port: 47821, message: null });
  remote.listDevices.mockResolvedValue([{ deviceId: "d1", name: "내 폰", createdAt: "2026-09-30T00:00:00.000Z", lastSeenAt: null }]);
  remote.issuePairingCode.mockResolvedValue({ code: "ABCD-EFGH", expiresAt: "2026-09-30T00:05:00.000Z", url: "http://100.64.0.9:47821/mobile/",
    pairUri: "mcw://pair?host=100.64.0.9:47821&name=PC&code=ABCDEFGH&fp=h",
    installUrl: "http://100.64.0.9:47821/install",
  });
  remote.revokeDevice.mockResolvedValue(undefined);
  update.mockResolvedValue(DEFAULT_SETTINGS);
  (window as unknown as { multiCliWork: unknown }).multiCliWork = {
    remote,
    settings: { update },
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    remoteHosts: { list: vi.fn().mockResolvedValue([]), onChanged: vi.fn(() => () => undefined) },
  };
});

describe("RemoteSettings", () => {
  it("toggles the server through settings", async () => {
    render(<RemoteSettings settings={DEFAULT_SETTINGS} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "원격 접속 허용" }));
    expect(update).toHaveBeenCalledWith({ remote: { enabled: true } });
  });

  it("copies the pairing link for another PC", async () => {
    render(<RemoteSettings settings={{ ...DEFAULT_SETTINGS, remote: { enabled: true, port: 47821 } }} />);
    fireEvent.click(await screen.findByRole("button", { name: "기기 추가" }));
    fireEvent.click(await screen.findByRole("button", { name: "페어링 링크 복사" }));
    const api = (window as unknown as { multiCliWork: { clipboard: { writeText: ReturnType<typeof vi.fn> } } }).multiCliWork;
    expect(api.clipboard.writeText).toHaveBeenCalledWith("mcw://pair?host=100.64.0.9:47821&name=PC&code=ABCDEFGH&fp=h");
  });

  it("shows the address, issues a pairing code, and lists devices", async () => {
    render(<RemoteSettings settings={{ ...DEFAULT_SETTINGS, remote: { enabled: true, port: 47821 } }} />);
    expect(await screen.findByText("http://100.64.0.9:47821/mobile/")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "기기 추가" }));
    expect(await screen.findByText("ABCD-EFGH")).toBeInTheDocument();
    expect(screen.getByText("내 폰")).toBeInTheDocument();
  });

  it("draws the pairing and install QR codes", async () => {
    render(<RemoteSettings settings={{ ...DEFAULT_SETTINGS, remote: { enabled: true, port: 47821 } }} />);
    fireEvent.click(await screen.findByRole("button", { name: "기기 추가" }));
    const pairQr = await screen.findByRole("img", { name: "페어링 QR 코드" });
    expect(pairQr.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(screen.getByRole("img", { name: "앱 설치 QR 코드" })).toBeInTheDocument();
  });

  it("revokes a device and refreshes the list", async () => {
    render(<RemoteSettings settings={{ ...DEFAULT_SETTINGS, remote: { enabled: true, port: 47821 } }} />);
    fireEvent.click(await screen.findByRole("button", { name: "내 폰 연결 해제" }));
    await waitFor(() => expect(remote.revokeDevice).toHaveBeenCalledWith("d1"));
    expect(remote.listDevices).toHaveBeenCalledTimes(2);
  });

  it("rejects an out-of-range port without saving", async () => {
    render(<RemoteSettings settings={DEFAULT_SETTINGS} />);
    const port = screen.getByLabelText("포트");
    fireEvent.change(port, { target: { value: "80" } });
    fireEvent.blur(port);
    expect(update).not.toHaveBeenCalled();
    expect(await screen.findByText(/1024–65535/)).toBeInTheDocument();
  });

  it("explains a missing Tailscale address", async () => {
    remote.status.mockResolvedValue({ state: "no-tailscale", url: null, port: 47821, message: "Tailscale 주소(100.64.0.0/10)를 찾지 못했습니다." });
    render(<RemoteSettings settings={{ ...DEFAULT_SETTINGS, remote: { enabled: true, port: 47821 } }} />);
    expect(await screen.findByText(/Tailscale 주소/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "기기 추가" })).toBeDisabled();
  });
});
