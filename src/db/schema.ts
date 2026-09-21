import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Faciliteter (med hierarki: en hal kan opdeles i underressourcer)
// ---------------------------------------------------------------------------
export const facilities = sqliteTable("facilities", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  parentId: text("parent_id"), // selvreference -> underressource af en anden facilitet
  // Hvordan denne facilitet konflikter med sin `parentId` (irrelevant for
  // topniveau-faciliteter uden forælder). "block" (standard) er den hidtidige
  // opførsel: booking af den ene forhindrer booking af den anden (fx
  // badmintonbaner i træningshallen - banerne kan ikke bruges hvis hele
  // hallen er booket, og omvendt). "warn" er en løsere kobling: de kan godt
  // bookes samtidig (fx en klatrevæg i opvisningshallen - man kan sagtens
  // bruge hallen mens nogen klatrer), men et forsøg på at booke den ene mens
  // den anden allerede er booket i samme tidsrum giver en (ikke-blokerende)
  // bemærkning, så personalet kan tage stilling til det.
  conflictMode: text("conflict_mode", { enum: ["block", "warn"] })
    .notNull()
    .default("block"),
  capacity: integer("capacity"),
  openingHours: text("opening_hours", { mode: "json" }).$type<
    Record<string, { open: string; close: string } | null>
  >(), // pr. ugedag
  pricePerHour: real("price_per_hour").default(0),
  requiresPayment: integer("requires_payment", { mode: "boolean" }).default(false),
  bookingTypes: text("booking_types", { mode: "json" }).$type<string[]>().default(
    sql`'[]'`
  ),
  restrictions: text("restrictions"),
  color: text("color").default("#2563eb"),
  sortOrder: integer("sort_order").default(0),
  archived: integer("archived", { mode: "boolean" }).default(false),
  // Skjuler faciliteten i foreningsportalen (fx badmintonbanerne, som kun må
  // bookes af privatpersoner) - påvirker IKKE den almindelige administration,
  // pedelvisningen eller den offentlige portal for privatpersoner.
  hiddenFromOrgPortal: integer("hidden_from_org_portal", { mode: "boolean" }).default(false),
  // Skjuler faciliteten HELT på infoskærmene (fx badmintonbanerne - de må
  // ikke fremgå af nogen infoskærm, uanset hvilke faciliteter den enkelte
  // skærm ellers er sat op til at vise) - se /api/screens/[id].
  hiddenFromInfoScreen: integer("hidden_from_info_screen", { mode: "boolean" }).default(false),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const facilitiesRelations = relations(facilities, ({ many }) => ({
  bookings: many(bookings),
}));

// ---------------------------------------------------------------------------
// Foreninger / organisationer
// ---------------------------------------------------------------------------
export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  cvr: text("cvr"),
  address: text("address"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  notes: text("notes"),
  billingInfo: text("billing_info"),
  // Foreninger oprettet via foreningsportalen ("Opret forening") starter som
  // "afventer_godkendelse" og kan ikke bruges til at booke, før personalet
  // har godkendt dem i administrationen (se /foreninger). Foreninger oprettet
  // direkte af personalet er godkendt med det samme (standardværdien).
  status: text("status", { enum: ["godkendt", "afventer_godkendelse", "afvist"] })
    .notNull()
    .default("godkendt"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// ---------------------------------------------------------------------------
// Brugere / roller
// ---------------------------------------------------------------------------
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", {
    enum: ["admin", "medarbejder", "pedel", "forening", "kunde"],
  }).notNull(),
  organizationId: text("organization_id"),
  phone: text("phone"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// ---------------------------------------------------------------------------
// Bookinger
// ---------------------------------------------------------------------------
export const bookings = sqliteTable("bookings", {
  id: text("id").primaryKey(),
  facilityId: text("facility_id").notNull(),
  organizationId: text("organization_id"),
  title: text("title").notNull(),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  startsAt: text("starts_at").notNull(), // ISO datetime
  endsAt: text("ends_at").notNull(),
  status: text("status", {
    enum: [
      "forespoergsel",
      "afventer_godkendelse",
      "reserveret",
      "bekraeftet",
      "betalt",
      "aflyst",
      "flyttet",
      "afvist",
      "midlertidig",
    ],
  })
    .notNull()
    .default("forespoergsel"),
  seasonGroupId: text("season_group_id"), // grupperer gentagne sæsonbookinger
  recurrenceRule: text("recurrence_rule", { mode: "json" }).$type<{
    freq: "weekly";
    weekday: number; // 0=søndag..6=lørdag
    until: string; // ISO dato
  } | null>(),
  price: real("price").default(0),
  paymentStatus: text("payment_status", {
    enum: ["ikke_paakraevet", "afventer", "betalt", "annulleret", "refunderet"],
  }).default("ikke_paakraevet"),
  accessCode: text("access_code"),
  // Ekstra notifikationsmodtager tilføjet af en forening ved booking via
  // foreningsportalen - fremtidige aflysninger/flytninger sendes til BÅDE
  // denne og den registrerede kontaktmail (contactEmail/foreningens mail).
  extraEmail: text("extra_email"),
  notes: text("notes"),
  source: text("source", {
    enum: ["manuel", "mail", "portal", "pedel", "saesonimport"],
  }).default("manuel"),
  createdBy: text("created_by"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

export const bookingsRelations = relations(bookings, ({ one }) => ({
  facility: one(facilities, {
    fields: [bookings.facilityId],
    references: [facilities.id],
  }),
  organization: one(organizations, {
    fields: [bookings.organizationId],
    references: [organizations.id],
  }),
}));

// ---------------------------------------------------------------------------
// Bookingindbakke: rå mails der skal fortolkes
// ---------------------------------------------------------------------------
export const bookingRequests = sqliteTable("booking_requests", {
  id: text("id").primaryKey(),
  rawText: text("raw_text").notNull(),
  sourceEmail: text("source_email"),
  type: text("type", { enum: ["saeson", "enkelt"] }).notNull(),
  parsedOrganizationName: text("parsed_organization_name"),
  parsedContactName: text("parsed_contact_name"),
  parsedContactEmail: text("parsed_contact_email"),
  parsedContactPhone: text("parsed_contact_phone"),
  matchedOrganizationId: text("matched_organization_id"),
  status: text("status", {
    enum: ["ny", "behandlet", "afsluttet"],
  })
    .notNull()
    .default("ny"),
  aiSummary: text("ai_summary"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// Hver linje er ét bookingønske udtrukket af mailen
export const bookingRequestLines = sqliteTable("booking_request_lines", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull(),
  weekdayText: text("weekday_text"), // "Mandag" osv. som skrevet i mailen
  weekday: integer("weekday"), // 0-6, udledt
  startTime: text("start_time").notNull(), // "16:00"
  endTime: text("end_time").notNull(),
  singleDate: text("single_date"), // for enkeltbookinger
  periodStart: text("period_start"), // for sæsonbookinger
  periodEnd: text("period_end"),
  facilityText: text("facility_text"), // rå tekst ("Hal 1")
  facilityId: text("facility_id"), // matchet facilitet
  comment: text("comment"),
  status: text("status", {
    enum: ["ledig", "konflikt", "godkendt", "afvist", "flyttet"],
  })
    .notNull()
    .default("ledig"),
  conflictBookingId: text("conflict_booking_id"),
  resultingBookingId: text("resulting_booking_id"),
});

// ---------------------------------------------------------------------------
// Konfliktlog
// ---------------------------------------------------------------------------
export const conflictLogs = sqliteTable("conflict_logs", {
  id: text("id").primaryKey(),
  requestLineId: text("request_line_id"),
  newBookingId: text("new_booking_id"),
  existingBookingId: text("existing_booking_id").notNull(),
  resolution: text("resolution", {
    enum: ["uafklaret", "afvist_ny", "overtaget", "flyttet_eksisterende"],
  })
    .notNull()
    .default("uafklaret"),
  generatedMessage: text("generated_message"),
  resolvedBy: text("resolved_by"),
  resolvedAt: text("resolved_at"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// ---------------------------------------------------------------------------
// Anmodninger om aflysning/flytning fra foreningsportalen: når en forening
// forsøger at booke en tid, der allerede er optaget af en anden forening,
// bliver de IKKE bare blokeret - de kan i stedet sende en anmodning. Under
// /anmodninger kan personalet godkende eller afvise. Ved godkendelse
// aflyses de(n) konflikterende booking(er) (den forening får automatisk en
// aflysningsmail, som ved enhver anden aflysning), og der oprettes en ny
// booking til den anmodende forening (som får en bekræftelsesmail). Ved
// afvisning ændres intet ved den eksisterende booking, og kun den
// anmodende forening får besked - se PATCH i
// src/app/api/reschedule-requests/[id]/route.ts.
// ---------------------------------------------------------------------------
export const rescheduleRequests = sqliteTable("reschedule_requests", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").notNull(),
  facilityIds: text("facility_ids", { mode: "json" }).$type<string[]>().notNull(),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  extraEmail: text("extra_email"),
  notes: text("notes"),
  // De bookinger der konflikterede med det ønskede tidsrum, da anmodningen
  // blev sendt - til visning for personalet. Selve godkendelsen tjekker
  // konflikter igen på godkendelsestidspunktet, i tilfælde af at situationen
  // har ændret sig (fx hvis personalet allerede selv har flyttet den anden
  // booking manuelt).
  conflictingBookingIds: text("conflicting_booking_ids", { mode: "json" }).$type<string[]>().notNull(),
  status: text("status", { enum: ["afventer", "godkendt", "afvist"] })
    .notNull()
    .default("afventer"),
  decidedAt: text("decided_at"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// ---------------------------------------------------------------------------
// Betalinger
// ---------------------------------------------------------------------------
export const payments = sqliteTable("payments", {
  id: text("id").primaryKey(),
  bookingId: text("booking_id").notNull(),
  amount: real("amount").notNull(),
  vat: real("vat").default(0),
  discount: real("discount").default(0),
  status: text("status", {
    enum: ["afventer", "betalt", "annulleret", "refunderet"],
  })
    .notNull()
    .default("afventer"),
  provider: text("provider").default("ikke_valgt"),
  providerRef: text("provider_ref"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// ---------------------------------------------------------------------------
// Adgangskoder
// ---------------------------------------------------------------------------
export const accessCodes = sqliteTable("access_codes", {
  id: text("id").primaryKey(),
  bookingId: text("booking_id").notNull(),
  facilityId: text("facility_id").notNull(),
  code: text("code").notNull(),
  validFrom: text("valid_from").notNull(),
  validTo: text("valid_to").notNull(),
  active: integer("active", { mode: "boolean" }).default(true),
  usageLog: text("usage_log", { mode: "json" }).$type<
    { at: string; event: string }[]
  >().default(sql`'[]'`),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// ---------------------------------------------------------------------------
// Infoskærme
// ---------------------------------------------------------------------------
export const infoScreens = sqliteTable("info_screens", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location"),
  facilityIds: text("facility_ids", { mode: "json" }).$type<string[]>().default(
    sql`'[]'`
  ),
  // Faciliteter der ALTID vises på denne skærm, også selvom de ikke har
  // nogen booking i dag (fx "Ledig hele dagen") - fx de tre store haller på
  // oversigtsskærmen. Faciliteter der er i `facilityIds` (eller alle, hvis
  // `facilityIds` er tom) men IKKE i `pinnedFacilityIds`, vises kun på
  // skærmen de dage, hvor de rent faktisk har en booking - så skærmen ikke
  // skal bruge plads (og risikere at skulle scrolle, hvilket ikke er muligt
  // på en fastmonteret infoskærm) på tomme lokaler. Se /api/screens/[id].
  pinnedFacilityIds: text("pinned_facility_ids", { mode: "json" }).$type<string[]>().default(
    sql`'[]'`
  ),
  layout: text("layout", { enum: ["standard", "kompakt", "enkelt_facilitet"] })
    .notNull()
    .default("standard"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// ---------------------------------------------------------------------------
// Notifikationsskabeloner + log
// ---------------------------------------------------------------------------
export const notificationTemplates = sqliteTable("notification_templates", {
  id: text("id").primaryKey(),
  type: text("type", {
    enum: [
      "bekraeftelse",
      "aflysning",
      "aendring",
      "paamindelse",
      "betalingskvittering",
      "adgangskode",
      "konflikt",
      "afvisning",
    ],
  }).notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
});

export const notificationLog = sqliteTable("notification_log", {
  id: text("id").primaryKey(),
  bookingId: text("booking_id"),
  type: text("type").notNull(),
  recipient: text("recipient"),
  subject: text("subject"),
  body: text("body"),
  sentAt: text("sent_at").default(sql`CURRENT_TIMESTAMP`),
});

// ---------------------------------------------------------------------------
// Dagsnoter: fritekst-noter knyttet til en bestemt dato (fx "Tekniker kommer
// til ventilationen kl. 10" eller "Brandøvelse i Fit og Sund") - vises både i
// kalenderen og i pedelvisningen, uafhængigt af de almindelige bookinger, så
// personalet/pedellerne kan skrive og se praktiske beskeder der ikke i sig
// selv er en booking af en facilitet. Der kan sagtens være flere noter på
// samme dato.
// ---------------------------------------------------------------------------
export const dayNotes = sqliteTable("day_notes", {
  id: text("id").primaryKey(),
  date: text("date").notNull(), // "YYYY-MM-DD"
  text: text("text").notNull(),
  createdBy: text("created_by"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// ---------------------------------------------------------------------------
// Audit log (bookinghistorik på tværs af hele systemet)
// ---------------------------------------------------------------------------
export const auditLog = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(),
  actorName: text("actor_name"),
  detail: text("detail"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});
