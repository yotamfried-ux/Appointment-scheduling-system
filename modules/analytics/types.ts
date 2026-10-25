export type AnalyticsEventType =
  | "business_registered"
  | "onboarding_completed"
  | "service_created"
  | "booking_page_published"
  | "booking_created"
  | "booking_cancelled"
  | "feature_used"
  | "notification_failed";

export interface AnalyticsEvent {
  id: string;
  businessId: string;
  eventType: AnalyticsEventType;
  eventTarget: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}
