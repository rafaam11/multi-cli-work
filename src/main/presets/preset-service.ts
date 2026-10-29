import type { CreateTerminalInput, TerminalSessionView } from "../../shared/api-types";
import type { PresetLaunchInput, SessionPreset } from "../../shared/preset-types";
import type { BoardService } from "../board/board-service";
import type { DeliveryQueue } from "../control/delivery-queue";

/**
 * Starts a preset: one session per member, named as the preset says, each member's role prompt
 * queued to go in once its CLI is ready, and a line on the folder's board saying who was started.
 *
 * Members start one after another rather than all at once — two CLIs racing to create the same
 * per-folder state on first run is not worth the second it would save.
 */

export interface PresetServiceOptions {
  presets(): Promise<SessionPreset[]>;
  create(input: CreateTerminalInput): Promise<TerminalSessionView>;
  delivery: Pick<DeliveryQueue, "enqueue">;
  board: Pick<BoardService, "event" | "recordDirect">;
}

const PRESET_COLS = 120;
const PRESET_ROWS = 32;

export class PresetLaunchError extends Error {}

export async function launchPreset(request: PresetLaunchInput, options: PresetServiceOptions): Promise<TerminalSessionView[]> {
  const preset = (await options.presets()).find((candidate) => candidate.id === request.presetId);
  if (!preset) throw new PresetLaunchError(`알 수 없는 프리셋: ${request.presetId}`);
  const started: TerminalSessionView[] = [];
  const prompts: Array<{ session: TerminalSessionView; prompt: string }> = [];
  for (const member of preset.members) {
    const session = await options.create({
      projectId: request.projectId,
      kind: member.agentId,
      ...(request.worktreeId ? { worktreeId: request.worktreeId } : {}),
      name: member.name,
      ...(member.launchProfileId !== undefined ? { launchProfileId: member.launchProfileId } : {}),
      cols: PRESET_COLS,
      rows: PRESET_ROWS,
      background: true,
    });
    started.push(session);
    if (member.prompt) prompts.push({ session, prompt: member.prompt });
  }
  // The board line goes first so the feed reads in order: who was started, then what each was told.
  await options.board
    .event(request.projectId, `프리셋 ‘${preset.name}’으로 ${started.map((session) => session.name ?? session.kind).join(", ")} 시작`)
    .catch((error) => console.error("Failed to note a preset launch on the board", error));
  for (const { session, prompt } of prompts) {
    const record = await options.delivery.enqueue({ to: session.id, text: prompt, raw: true });
    await options.board
      .recordDirect(record, "역할 프롬프트")
      .catch((error) => console.error("Failed to put a preset prompt on the board", error));
  }
  return started;
}
