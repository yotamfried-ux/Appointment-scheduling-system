export interface DashboardMetrics {
  totalBusinesses: number;
  newBusinesses: number;
  activeBusinesses: number;
  activePercentage: number;
  bookingsInPeriod: number;
  bookingsGrowth: number;
  completedPercentage: number;
  funnel: {
    registered: number;
    serviceCreated: number;
    servicePercentage: number;
    pagePublished: number;
    publishedPercentage: number;
    firstBooking: number;
    firstBookingPercentage: number;
  };
  registrationsOverTime: {
    period: string;
    count: number;
  }[];
}

export interface AdminBusiness {
  id: string;
  name: string;
  slug: string;
  kind: string;
  phone: string | null;
  published_at: string | null;
  created_at: string;
  owner_email: string | null;
  total_appointments: number;
  cancelled_appointments: number;
  cancellation_rate: number;
  services_count: number;
  staff_count: number;
  waitlist_enabled: boolean;
}

export interface AdminSystemError {
  id: string;
  category: string;
  type: string;
  error_message: string;
  business_name: string;
  created_at: string;
}
