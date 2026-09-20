export interface QuitRequest {
  confirm(): Promise<boolean>;
  exit(): void;
}

/** One gate for menu quit, window-close quit, before-quit, and updater restart. */
export class QuitCoordinator {
  private requestPromise: Promise<void> | null = null;
  private disposePromise: Promise<void> | null = null;
  private committed = false;

  constructor(private readonly disposeRuntime: () => Promise<void>) {}

  isCommitted(): boolean {
    return this.committed;
  }

  request(request: QuitRequest): Promise<void> {
    if (this.requestPromise) return this.requestPromise;
    const pending = (async () => {
      if (!(await request.confirm())) return;
      if (!this.disposePromise) {
        try {
          this.disposePromise = Promise.resolve(this.disposeRuntime());
        } catch (error) {
          this.disposePromise = Promise.reject(error);
        }
      }
      const disposing = this.disposePromise;
      try {
        await disposing;
      } catch (error) {
        if (this.disposePromise === disposing) this.disposePromise = null;
        throw error;
      }
      this.committed = true;
      request.exit();
    })();
    this.requestPromise = pending;
    void pending.finally(() => {
      if (!this.committed && this.requestPromise === pending) this.requestPromise = null;
    }).catch(() => undefined);
    return pending;
  }
}
