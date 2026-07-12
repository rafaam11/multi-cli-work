import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MultiCliWorkApi } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectMetadataEditor } from "./ProjectMetadataEditor";

const project: SharedProject = {
  id: "project-atlas",
  rootPath: "C:\\work\\atlas",
  displayName: "Atlas",
  sources: ["manual"],
  providerRefs: { claude: [], codex: [] },
  status: null,
  memo: "",
  tracks: [],
  hidden: false,
  order: 0,
  createdAt: "2026-07-11T00:00:00.000Z",
  updatedAt: "2026-07-11T01:00:00.000Z",
};

function mountEditor(update: ReturnType<typeof vi.fn>, target: SharedProject = project) {
  window.multiCliWork = { projects: { update } } as unknown as MultiCliWorkApi;
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(<ProjectMetadataEditor project={target} onSaved={onSaved} onClose={onClose} />);
  return { onSaved, onClose };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ProjectMetadataEditor", () => {
  it("renames the folder", async () => {
    const updated = { ...project, displayName: "Atlas Prime" };
    const update = vi.fn().mockResolvedValue(updated);
    const { onSaved, onClose } = mountEditor(update);

    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Atlas Prime" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated));
    expect(update).toHaveBeenCalledWith(project.id, { displayName: "Atlas Prime" });
    expect(onClose).toHaveBeenCalled();
  });

  it("clears the name back to the folder basename when the field is emptied", async () => {
    const updated = { ...project, displayName: null };
    const update = vi.fn().mockResolvedValue(updated);
    mountEditor(update);

    expect(screen.getByLabelText("Display name")).toHaveAttribute("placeholder", "atlas");
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(update).toHaveBeenCalledWith(project.id, { displayName: null }));
  });

  it("closes without updating when nothing changed or when cancelled", async () => {
    const update = vi.fn();
    const { onSaved, onClose } = mountEditor(update);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("shows the failure and stays open when the update is rejected", async () => {
    const update = vi.fn().mockRejectedValue(new Error("registry is read-only"));
    const { onSaved, onClose } = mountEditor(update);

    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Atlas Prime" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("registry is read-only");
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape without updating", () => {
    const update = vi.fn();
    const { onClose } = mountEditor(update);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });
});
