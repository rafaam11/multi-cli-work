import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { MultiCliWorkApi } from "@shared/api-types";
import type { LaunchProfile } from "@shared/launch-profile";
import { LaunchProfileSettings } from "./LaunchProfileSettings";

afterEach(cleanup);
it("edits model and effort, then sets a default only after saving the profile", async () => {
  const state = { schemaVersion: 1 as const, prompts: [], drafts: {}, launchProfiles: [] as LaunchProfile[] };
  const saveLaunchProfile = vi.fn(async (profile: LaunchProfile) => ({ ...state, launchProfiles: [profile] }));
  const setDefaultLaunchProfile = vi.fn(async () => state);
  window.multiCliWork = { workbench: { state: async () => ({ state, writable: true }), saveLaunchProfile, setDefaultLaunchProfile } } as unknown as MultiCliWorkApi;
  render(<LaunchProfileSettings />);
  await waitFor(() => expect(screen.getByRole("button", { name: "새 시작 프로필" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "새 시작 프로필" }));
  fireEvent.change(screen.getByLabelText("프로필 이름"), { target: { value: "Deep review" } });
  fireEvent.change(screen.getByLabelText("모델 ID"), { target: { value: "gpt-5.5" } });
  fireEvent.change(screen.getByLabelText("추론 수준"), { target: { value: "high" } });
  expect(saveLaunchProfile).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "프로필 저장" }));
  await waitFor(() => expect(saveLaunchProfile).toHaveBeenCalledWith(expect.objectContaining({ name: "Deep review", agentId: "codex", model: "gpt-5.5", effort: "high" })));
  await waitFor(() => expect(screen.queryByRole("form", { name: "시작 프로필 편집" })).not.toBeInTheDocument());
  const id = saveLaunchProfile.mock.calls[0][0].id;
  fireEvent.change(screen.getByLabelText("Codex 기본 프로필"), { target: { value: id } });
  await waitFor(() => expect(setDefaultLaunchProfile).toHaveBeenCalledWith("codex", id));
});
it("keeps a damaged store read-only and exposes its diagnostic", async () => {
  window.multiCliWork = { workbench: { state: async () => ({ writable: false, warning: "저장소 복구 필요", state: { schemaVersion: 1, prompts: [], drafts: {} } }) } } as unknown as MultiCliWorkApi;
  render(<LaunchProfileSettings />);
  expect(await screen.findByRole("alert")).toHaveTextContent("저장소 복구 필요");
  expect(screen.getByRole("button", { name: "새 시작 프로필" })).toBeDisabled();
  expect(screen.getByLabelText("Codex 기본 프로필")).toBeDisabled();
});
