const SITE_TYPES = Object.freeze({
  standard: { label: "Full Hookup Site", nightlyCents: 6500 },
});

const EXTRAS = Object.freeze({
  vehicle: { label: "Extra vehicle", nightlyCents: 500 },
  pet: { label: "Additional pet", nightlyCents: 300 },
  early: { label: "Early check-in", nightlyCents: 1500 },
});

const TAX_BASIS_POINTS = 1700;

export class ValidationError extends Error {
  constructor(message, fields = {}) {
    super(message);
    this.name = "ValidationError";
    this.fields = fields;
  }
}

function integerInRange(value, minimum, maximum, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new ValidationError(`Invalid ${field}.`, { [field]: `Must be between ${minimum} and ${maximum}.` });
  }
  return number;
}

function normalizeArrival(value, now = new Date()) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError("Select a valid arrival date.", { arrival: "Use YYYY-MM-DD." });
  }

  const arrival = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(arrival.getTime()) || arrival.toISOString().slice(0, 10) !== value) {
    throw new ValidationError("Select a valid arrival date.", { arrival: "The date does not exist." });
  }

  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (arrival.getTime() < todayUtc) {
    throw new ValidationError("Arrival cannot be in the past.", { arrival: "Choose today or a future date." });
  }
  if (arrival.getTime() > todayUtc + 366 * 86_400_000) {
    throw new ValidationError("Arrival is too far in the future.", { arrival: "Choose a date within one year." });
  }

  return value;
}

function normalizeChildAges(value, childCount) {
  const ages = value === undefined && childCount === 0 ? [] : value;
  if (!Array.isArray(ages) || ages.length !== childCount) {
    throw new ValidationError("Select an age for every child.", {
      childAges: `Provide exactly ${childCount} child age${childCount === 1 ? "" : "s"}.`,
    });
  }

  return ages.map((value) => {
    const age = Number(value);
    if (!Number.isInteger(age) || age < 0 || age > 14) {
      throw new ValidationError("Select a valid age for every child.", {
        childAges: "Each child must be between 0 and 14 years old.",
      });
    }
    return age;
  });
}

export function normalizeBooking(input, now = new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ValidationError("Booking details are required.");
  }

  const arrival = normalizeArrival(input.arrival, now);
  const nights = integerInRange(input.nights, 1, 365, "nights");
  const sites = integerInRange(input.sites, 1, 5, "sites");
  const adults = integerInRange(input.adults, 1, sites * 6, "adults");
  const children = integerInRange(input.children, 0, sites * 6, "children");

  if (adults < sites) {
    throw new ValidationError("Each site requires at least one adult.", {
      adults: "Add at least one adult for every site.",
    });
  }

  if (adults + children > sites * 6) {
    throw new ValidationError("Guest count exceeds site capacity.", {
      guests: "Each site can accommodate up to six guests and requires at least one adult.",
    });
  }

  const childAges = normalizeChildAges(input.childAges, children);

  const siteType = typeof input.siteType === "string" ? input.siteType : "";
  if (!SITE_TYPES[siteType]) {
    throw new ValidationError("Select a valid site type.", { siteType: "Unknown site type." });
  }

  const requestedExtras = Array.isArray(input.extras) ? input.extras : [];
  const extras = [...new Set(requestedExtras)];
  if (extras.some((extra) => typeof extra !== "string" || !EXTRAS[extra])) {
    throw new ValidationError("One or more add-ons are invalid.", { extras: "Unknown add-on." });
  }

  return { arrival, nights, sites, adults, children, childAges, siteType, extras };
}

export function calculatePrice(booking) {
  const site = SITE_TYPES[booking.siteType];
  const baseCents = site.nightlyCents * booking.nights * booking.sites;
  const addOnCents = booking.extras.reduce(
    (total, extra) => total + EXTRAS[extra].nightlyCents * booking.nights,
    0,
  );
  const subtotalCents = baseCents + addOnCents;
  const taxCents = Math.round((subtotalCents * TAX_BASIS_POINTS) / 10_000);

  return {
    currency: "usd",
    siteLabel: site.label,
    baseCents,
    addOnCents,
    subtotalCents,
    taxCents,
    totalCents: subtotalCents + taxCents,
  };
}

export { EXTRAS, SITE_TYPES, TAX_BASIS_POINTS };
