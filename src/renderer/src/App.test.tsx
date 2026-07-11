import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App shell", () => {
  it("presents the project workspace and focused terminal surface", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Multi CLI Work" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Terminal workspace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add project" })).toBeEnabled();
    expect(screen.getByText("Choose a project to start a session")).toBeInTheDocument();
  });
});

