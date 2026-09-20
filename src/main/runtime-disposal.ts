export type DisposalStage = () => void | Promise<void>;

/** Runs teardown stages once, retaining progress while allowing a failed stage to be retried. */
export function createRetryableDisposer(stages: readonly DisposalStage[]): () => Promise<void> {
  let nextStage = 0;
  let inFlight: Promise<void> | null = null;
  return () => {
    if (inFlight) return inFlight;
    const attempt = (async () => {
      while (nextStage < stages.length) {
        await stages[nextStage]();
        nextStage += 1;
      }
    })();
    inFlight = attempt;
    void attempt.finally(() => {
      if (inFlight === attempt) inFlight = null;
    }).catch(() => undefined);
    return attempt;
  };
}
