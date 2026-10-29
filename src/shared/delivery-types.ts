export type DeliveryState = "held" | "delivered" | "failed" | "dropped";
export type HoldReason = "working" | "awaiting-approval" | "typing" | "starting" | "settling" | "dialog";
export interface DeliveryRecord {
  id: string;
  from: string | null;
  to: string;
  text: string;
  state: DeliveryState;
  reason: HoldReason | string | null;
  createdAt: number;
  settledAt: number | null;
}
