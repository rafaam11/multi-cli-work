export type DeliveryState = "held" | "delivered" | "failed" | "dropped";
export type HoldReason = "working" | "awaiting-approval" | "typing" | "starting" | "settling" | "dialog";
export interface DeliveryRecord {
  id: string;
  from: string | null;
  to: string;
  /** Target folder captured when queued, retained after the session is removed. */
  projectId?: string | null;
  /** Send response only: queue registration succeeded but board recording failed. */
  recordingWarning?: string;
  text: string;
  state: DeliveryState;
  reason: HoldReason | string | null;
  createdAt: number;
  settledAt: number | null;
}
