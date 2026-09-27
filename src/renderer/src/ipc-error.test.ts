import { describe, expect, it } from "vitest";
import { errorMessage } from "./ipc-error";

describe("errorMessage", () => {
  it("drops Electron's invoke wrapper and keeps the reason main gave", () => {
    const wrapped = new Error(
      "Error invoking remote method 'terminals:resume': Error: Unknown agent: echo-agent. Add it back to agents.json to run it again.",
    );
    expect(errorMessage(wrapped)).toBe("Unknown agent: echo-agent. Add it back to agents.json to run it again.");
  });

  it("also drops a named error class main threw", () => {
    const wrapped = new Error("Error invoking remote method 'projects:add': ProjectServiceError: 이미 등록된 폴더입니다");
    expect(errorMessage(wrapped)).toBe("이미 등록된 폴더입니다");
  });

  it("passes other errors and non-errors through", () => {
    expect(errorMessage(new Error("plain"))).toBe("plain");
    expect(errorMessage("text")).toBe("text");
  });
});
