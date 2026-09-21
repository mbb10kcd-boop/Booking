export interface FacilityDTO {
  id: string;
  name: string;
  description: string | null;
  parentId: string | null;
  conflictMode: "block" | "warn" | null;
  capacity: number | null;
  pricePerHour: number | null;
  requiresPayment: boolean | null;
  color: string | null;
  sortOrder: number | null;
  archived: boolean | null;
  bookingTypes: string[] | null;
  restrictions: string | null;
  hiddenFromOrgPortal: boolean | null;
  hiddenFromInfoScreen: boolean | null;
}

export interface BookingDTO {
  id: string;
  facilityId: string;
  organizationId: string | null;
  title: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
  seasonGroupId: string | null;
  recurrenceRule: { freq: "weekly"; weekday: number; until: string } | null;
  price: number | null;
  paymentStatus: string | null;
  accessCode: string | null;
  extraEmail: string | null;
  notes: string | null;
  source: string | null;
}

export interface DayNoteDTO {
  id: string;
  date: string;
  text: string;
  createdBy: string | null;
  createdAt: string | null;
}

export interface OrganizationDTO {
  id: string;
  name: string;
  cvr: string | null;
  address: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
  status: "godkendt" | "afventer_godkendelse" | "afvist";
}

export interface RescheduleRequestDTO {
  id: string;
  organizationId: string;
  facilityIds: string[];
  startsAt: string;
  endsAt: string;
  extraEmail: string | null;
  notes: string | null;
  conflictingBookingIds: string[];
  status: "afventer" | "godkendt" | "afvist";
  decidedAt: string | null;
  createdAt: string | null;
}
