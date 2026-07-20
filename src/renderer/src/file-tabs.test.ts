import { describe, expect, it } from "vitest";
import { categorizeFile } from "./file-tabs";

describe("categorizeFile", () => {
  it("recognizes dotfiles and expanded plain-text formats", () => {
    expect(categorizeFile(".env", null)).toBe("text");
    expect(categorizeFile(".env.local", "local")).toBe("text");
    expect(categorizeFile("schema.graphql", "graphql")).toBe("text");
    expect(categorizeFile("Dockerfile", null)).toBe("text");
  });

  it("keeps images, executables, and unknown extensions out of normal text editing", () => {
    expect(categorizeFile("logo.png", "png")).toBe("image");
    expect(categorizeFile("setup.exe", "exe")).toBe("unsupported");
    expect(categorizeFile("archive.7z", "7z")).toBe("unsupported");
  });

  it("routes html to its own preview category, not plain text", () => {
    expect(categorizeFile("index.html", "html")).toBe("html");
    expect(categorizeFile("page.htm", "htm")).toBe("html");
    // Adjacent web assets still open as editable text, not preview.
    expect(categorizeFile("styles.css", "css")).toBe("text");
  });
});
