// @vitest-environment node

import { describe, expect, it } from "vitest";
import { parseCodexExitConversationId } from "./codex-resume";

const ID = "01a10c79-b290-7af0-9e7c-23294236d4f1";

describe("parseCodexExitConversationId", () => {
  it.each([
    ["empty-session footer", `Session ID: ${ID}\r\n`],
    ["resume-command footer", `Token usage: total=42\r\nTo continue this session, run codex resume ${ID}\r\n`],
    ["coloured footer", `\u001b[?2004l\r\nTo continue this session, run \u001b[32mcodex resume ${ID}\u001b[0m\r\n\u001b]0;PowerShell\u0007`],
    ["wrapped footer", `To continue this session, run codex resume\r\n${ID}\r\n`],
  ])("reads the exact id from a %s", (_label, output) => {
    expect(parseCodexExitConversationId(output)).toBe(ID);
  });

  it.each([
    `The command is codex resume ${ID}\n`,
    `> Session ID: ${ID}\n`,
    `Session ID: ${ID}\nNew conversation is still running\n`,
    `To continue this session, run codex resume --last\n`,
    "Session ID: not-a-conversation-id\n",
    `Session ID: ${ID}extra\n`,
  ])("does not claim an id from prose, an old footer or a malformed footer (%#)", (output) => {
    expect(parseCodexExitConversationId(output)).toBeNull();
  });
});
