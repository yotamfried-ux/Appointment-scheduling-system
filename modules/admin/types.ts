export interface FinancialMetrics {
  // SaaS Platform Revenue
  contractualMrrNis: number;
  payingMrrNis?: number;
  collectedRevenueNis: number;
  arrNis: number;
  activeSubscribers: number;
  payingSubscribers?: number;
  complimentarySubscribers?: number;
  complimentaryValueNis?: number;
  totalActiveProSubscribers?: number;
  trialingSubscribers: number;
  trialPotentialMrrNis: number;
  pastDueSubscribers: number;

  // Booking Values Across Explicit Cohorts
  confirmedBookingValueNis: number;
  confirmedBookingsCount: number;
  avgConfirmedBookingValueNis: number;

  completedServicesValueNis: number;
  completedBookingsCount: number;
  avgCompletedServiceValueNis: number;

  totalAppointmentsCount: number;
  totalBookingValueNis: number;
  avgTotalBookingValueNis: number;

  periodConfirmedBookingValueNis: number;
  periodConfirmedBookingsCount: number;

  // Backwards compatibility aliases
  mrrNis: number;
  totalGmvNis: number;
  periodGmvNis: number;
  averageBookingValueNis: number;

  plans: {
    planId: string;
    planName: string;
    priceNis: number;
    subscribers: number;
    revenueNis: number;
  }[];
}

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
  financial?: FinancialMetrics;
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
  subscription_tier?: string;
  subscription_type?: "paying" | "complimentary" | "trial" | "canceled" | "free";
}

export interface AdminSystemError {
  id: string;
  category: string;
  type: string;
  error_message: string;
  business_name: string;
  created_at: string;
}
