import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteHostInfo } from "@shared/remote-types";
import { RemoteHostsSettings } from "./RemoteHostsSettings";

const OFFICE: RemoteHostInfo = { hostId: "h1", name: "회사PC", address: "100.64.0.9:47821", notify: true, paired: true, addedAt: "" };
const HOME: RemoteHostInfo = { hostId: "h2", name: "집PC", address: "100.64.0.7:47821", notify: true, paired: false, addedAt: "" };

let changed: ((hosts: RemoteHostInfo[]) => void) | null = null;
const remoteHosts = {
  list: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  open: vi.fn(),
  onChanged: vi.fn((listener: (hosts: RemoteHostInfo[]) => void) => {
    changed = listener;
    return () => undefined;
  }),
};

afterEach(cleanup);

beforeEach(() => {
  remoteHosts.list.mockResolvedValue([OFFICE, HOME]);
  remoteHosts.add.mockResolvedValue(OFFICE);
  remoteHosts.remove.mockResolvedValue(undefined);
  remoteHosts.open.mockResolvedValue(undefined);
  (window as unknown as { multiCliWork: unknown }).multiCliWork = { remoteHosts };
});

describe("RemoteHostsSettings", () => {
  it("lists hosts and marks the one that needs pairing again", async () => {
    render(<RemoteHostsSettings />);
    expect(await screen.findByText("회사PC")).toBeInTheDocument();
    expect(screen.getByText(/다시 페어링 필요/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "집PC 열기" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "회사PC 열기" }));
    expect(remoteHosts.open).toHaveBeenCalledWith("h1");
  });

  it("adds a host by address and code", async () => {
    render(<RemoteHostsSettings />);
    const add = screen.getByRole("button", { name: "PC 추가" });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText("페어링 링크 또는 주소"), { target: { value: "100.64.0.9:47821" } });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText("페어링 코드"), { target: { value: "ABCD-EFGH" } });
    fireEvent.click(add);
    await waitFor(() => expect(remoteHosts.add).toHaveBeenCalledWith({ address: "100.64.0.9:47821", code: "ABCD-EFGH" }));
    await waitFor(() => expect(screen.getByLabelText("페어링 링크 또는 주소")).toHaveValue(""));
  });

  it("adds a host by pairing link without a code", async () => {
    render(<RemoteHostsSettings />);
    const link = "mcw://pair?host=100.64.0.9:47821&name=PC&code=ABCDEFGH&fp=h1";
    fireEvent.change(screen.getByLabelText("페어링 링크 또는 주소"), { target: { value: link } });
    expect(screen.getByLabelText("페어링 코드")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "PC 추가" }));
    await waitFor(() => expect(remoteHosts.add).toHaveBeenCalledWith({ uri: link }));
  });

  it("shows why adding failed and keeps what was typed", async () => {
    remoteHosts.add.mockRejectedValue(new Error("Error invoking remote method 'remote-hosts:add': Error: 코드가 맞지 않거나 만료되었습니다"));
    render(<RemoteHostsSettings />);
    fireEvent.change(screen.getByLabelText("페어링 링크 또는 주소"), { target: { value: "100.64.0.9:47821" } });
    fireEvent.change(screen.getByLabelText("페어링 코드"), { target: { value: "WRONG" } });
    fireEvent.click(screen.getByRole("button", { name: "PC 추가" }));
    expect(await screen.findByText(/코드가 맞지 않거나 만료되었습니다/)).toBeInTheDocument();
    expect(screen.getByLabelText("페어링 코드")).toHaveValue("WRONG");
  });

  it("removes a host and follows changes from main", async () => {
    render(<RemoteHostsSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "회사PC 삭제" }));
    expect(remoteHosts.remove).toHaveBeenCalledWith("h1");
    changed!([HOME]);
    await waitFor(() => expect(screen.queryByText("회사PC")).not.toBeInTheDocument());
  });
});
