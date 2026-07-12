import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeCodeIcon, CodexIcon, GitHubIcon, PowerShellIcon, VSCodeIcon } from "./brand-icons";

afterEach(cleanup);

const icons = [
  { name: "PowerShell", Icon: PowerShellIcon },
  { name: "VS Code", Icon: VSCodeIcon },
  { name: "GitHub", Icon: GitHubIcon },
  { name: "Claude Code", Icon: ClaudeCodeIcon },
  { name: "Codex", Icon: CodexIcon },
];

describe("brand icons", () => {
  it.each(icons)("renders $name as an svg sized by the size prop", ({ Icon }) => {
    const { container } = render(<Icon size={18} />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("width", "18");
    expect(svg).toHaveAttribute("height", "18");
  });

  it.each(icons)("passes className through onto the svg for $name", ({ Icon }) => {
    const { container } = render(<Icon size={16} className="brand-icon-test" />);
    expect(container.querySelector("svg.brand-icon-test")).toBeInTheDocument();
  });
});
