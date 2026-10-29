import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AgentView } from "@shared/agent-types";
import type { SessionPreset } from "@shared/preset-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewSessionMenuItems } from "./NewSessionMenuItems";
import { PresetSettings } from "./PresetSettings";

afterEach(()=>{cleanup();delete window.mcwV2;});

const agents = [
  { id: "claude", label: "Claude Code", icon: "claude", available: true },
  { id: "codex", label: "Codex", icon: "codex", available: false },
] as AgentView[];

const pair: SessionPreset = {
  id: "builder-reviewer",
  name: "빌더 + 리뷰어",
  members: [
    { agentId: "claude", name: "빌더", prompt: "구현해" },
    { agentId: "codex", name: "리뷰어" },
  ],
};
const solo: SessionPreset = { id: "solo", name: "혼자", members: [{ agentId: "claude", name: "A" }] };

describe("NewSessionMenuItems presets", () => {
  it("lists presets and disables one whose CLI is missing", () => {
    const onStartPreset = vi.fn();
    render(<NewSessionMenuItems agents={agents} disabledReason={null} onStart={vi.fn()} presets={[pair, solo]} onStartPreset={onStartPreset} />);
    expect(screen.getByRole("menuitem", { name: /빌더 \+ 리뷰어/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitem", { name: /혼자/ }));
    expect(onStartPreset).toHaveBeenCalledWith("solo");
  });
});

describe("PresetSettings", () => {
  const presets = {
    list: vi.fn(async () => [pair]),
    save: vi.fn(async (preset: SessionPreset) => [preset]),
    remove: vi.fn(async () => []),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(window, { multiCliWork: { presets, agents: { list: vi.fn(async () => ({ agents })) } } });
  });

  it("edits a preset's member and saves the draft", async () => {
    render(<PresetSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "편집" }));
    fireEvent.change(screen.getByRole("textbox", { name: "멤버 2 이름" }), { target: { value: "검토자" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() =>
      expect(presets.save).toHaveBeenCalledWith(expect.objectContaining({ id: "builder-reviewer", members: [pair.members[0], { agentId: "codex", name: "검토자" }] })),
    );
  });
  it("marks custom jk prompts for migration without saving or launching on view",async()=>{
    window.mcwV2={version:2} as import("@shared/v2-api").McwV2Api;
    presets.list.mockResolvedValueOnce([{...pair,members:[{agentId:"claude",name:"대표",prompt:"jk post 내 지시"}]}]);
    render(<PresetSettings/>);
    expect(await screen.findByText(/이관 필요: 역할 프롬프트/)).toBeVisible();expect(presets.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"편집"}));
    expect(screen.getByRole("textbox",{name:"멤버 1 역할 프롬프트"})).toHaveValue("jk post 내 지시");
  });

  it("adds a member to a new preset and deletes a preset", async () => {
    render(<PresetSettings />);
    fireEvent.click(await screen.findByRole("button", { name: /새 프리셋/ }));
    fireEvent.click(screen.getByRole("button", { name: /멤버 추가/ }));
    expect(screen.getByRole("textbox", { name: "멤버 2 이름" })).toHaveValue("세션 2");
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    fireEvent.click(screen.getByRole("button", { name: "빌더 + 리뷰어 삭제" }));
    await waitFor(() => expect(presets.remove).toHaveBeenCalledWith("builder-reviewer"));
    expect(await screen.findByText("프리셋이 없습니다.")).toBeInTheDocument();
  });
});
