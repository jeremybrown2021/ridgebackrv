CREATE TABLE IF NOT EXISTS reservation_statuses (
  code VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  label VARCHAR(80) NOT NULL,
  is_terminal TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS inventory_statuses (
  code VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  label VARCHAR(80) NOT NULL,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS payment_statuses (
  code VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  label VARCHAR(80) NOT NULL,
  is_terminal TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS quote_statuses (
  code VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  label VARCHAR(80) NOT NULL,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS pricing_units (
  code VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  label VARCHAR(80) NOT NULL,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS site_types (
  id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(500) NULL,
  max_guests_per_site TINYINT UNSIGNED NOT NULL DEFAULT 6,
  default_nightly_cents INT UNSIGNED NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_site_types_code (code),
  CONSTRAINT chk_site_types_max_guests CHECK (max_guests_per_site BETWEEN 1 AND 20),
  CONSTRAINT chk_site_types_rate CHECK (default_nightly_cents > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS sites (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_type_id SMALLINT UNSIGNED NOT NULL,
  site_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  max_rv_length_ft SMALLINT UNSIGNED NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_placeholder TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sites_code (site_code),
  KEY idx_sites_type_active_id (site_type_id, is_active, id),
  CONSTRAINT fk_sites_site_type FOREIGN KEY (site_type_id) REFERENCES site_types (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS rate_plans (
  id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(100) NOT NULL,
  minimum_nights SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  maximum_nights SMALLINT UNSIGNED NOT NULL DEFAULT 365,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_rate_plans_code (code),
  CONSTRAINT chk_rate_plans_nights CHECK (minimum_nights BETWEEN 1 AND maximum_nights AND maximum_nights <= 365)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS daily_rates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_type_id SMALLINT UNSIGNED NOT NULL,
  rate_plan_id SMALLINT UNSIGNED NOT NULL,
  stay_date DATE NOT NULL,
  nightly_cents INT UNSIGNED NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_daily_rates_type_plan_date (site_type_id, rate_plan_id, stay_date),
  KEY idx_daily_rates_plan_date (rate_plan_id, stay_date),
  CONSTRAINT fk_daily_rates_site_type FOREIGN KEY (site_type_id) REFERENCES site_types (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_daily_rates_rate_plan FOREIGN KEY (rate_plan_id) REFERENCES rate_plans (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_daily_rates_amount CHECK (nightly_cents > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS extras (
  id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(100) NOT NULL,
  pricing_unit_code VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  unit_amount_cents INT UNSIGNED NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_extras_code (code),
  KEY idx_extras_active_code (is_active, code),
  CONSTRAINT fk_extras_pricing_unit FOREIGN KEY (pricing_unit_code) REFERENCES pricing_units (code) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_extras_amount CHECK (unit_amount_cents > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS quotes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  quote_key CHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status_code VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'issued',
  site_type_id SMALLINT UNSIGNED NOT NULL,
  arrival_date DATE NOT NULL,
  departure_date DATE NOT NULL,
  nights SMALLINT UNSIGNED NOT NULL,
  site_count TINYINT UNSIGNED NOT NULL,
  adult_count SMALLINT UNSIGNED NOT NULL,
  child_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  booking_snapshot JSON NOT NULL,
  pricing_snapshot JSON NOT NULL,
  base_amount_cents BIGINT UNSIGNED NOT NULL,
  extras_amount_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  subtotal_amount_cents BIGINT UNSIGNED NOT NULL,
  tax_amount_cents BIGINT UNSIGNED NOT NULL,
  total_amount_cents BIGINT UNSIGNED NOT NULL,
  currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  issued_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  consumed_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_quotes_key (quote_key),
  KEY idx_quotes_status_expiry (status_code, expires_at),
  CONSTRAINT fk_quotes_status FOREIGN KEY (status_code) REFERENCES quote_statuses (code) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_quotes_site_type FOREIGN KEY (site_type_id) REFERENCES site_types (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_quotes_dates CHECK (departure_date > arrival_date),
  CONSTRAINT chk_quotes_counts CHECK (nights BETWEEN 1 AND 365 AND site_count BETWEEN 1 AND 5 AND adult_count >= site_count),
  CONSTRAINT chk_quotes_amounts CHECK (subtotal_amount_cents = base_amount_cents + extras_amount_cents AND total_amount_cents = subtotal_amount_cents + tax_amount_cents)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS reservations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reservation_number VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  quote_id BIGINT UNSIGNED NOT NULL,
  status_code VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending_payment',
  site_type_id SMALLINT UNSIGNED NOT NULL,
  arrival_date DATE NOT NULL,
  departure_date DATE NOT NULL,
  nights SMALLINT UNSIGNED NOT NULL,
  site_count TINYINT UNSIGNED NOT NULL,
  adult_count SMALLINT UNSIGNED NOT NULL,
  child_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  guest_full_name VARCHAR(120) NOT NULL,
  guest_email VARCHAR(254) NOT NULL,
  guest_phone VARCHAR(30) NOT NULL,
  rv_details VARCHAR(160) NOT NULL,
  base_amount_cents BIGINT UNSIGNED NOT NULL,
  extras_amount_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  discount_amount_cents BIGINT UNSIGNED NOT NULL DEFAULT 0,
  subtotal_amount_cents BIGINT UNSIGNED NOT NULL,
  tax_amount_cents BIGINT UNSIGNED NOT NULL,
  total_amount_cents BIGINT UNSIGNED NOT NULL,
  currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  terms_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  terms_accepted_at DATETIME(6) NOT NULL,
  terms_accepted_ip VARBINARY(16) NOT NULL,
  hold_expires_at DATETIME(6) NOT NULL,
  confirmed_at DATETIME(6) NULL,
  cancelled_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_reservations_number (reservation_number),
  UNIQUE KEY uq_reservations_quote (quote_id),
  KEY idx_reservations_status_arrival (status_code, arrival_date, id),
  KEY idx_reservations_email_created (guest_email, created_at),
  CONSTRAINT fk_reservations_quote FOREIGN KEY (quote_id) REFERENCES quotes (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_reservations_status FOREIGN KEY (status_code) REFERENCES reservation_statuses (code) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_reservations_site_type FOREIGN KEY (site_type_id) REFERENCES site_types (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_reservations_dates CHECK (departure_date > arrival_date),
  CONSTRAINT chk_reservations_counts CHECK (nights BETWEEN 1 AND 365 AND site_count BETWEEN 1 AND 5 AND adult_count >= site_count),
  CONSTRAINT chk_reservations_amounts CHECK (subtotal_amount_cents = base_amount_cents + extras_amount_cents - discount_amount_cents AND total_amount_cents = subtotal_amount_cents + tax_amount_cents)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS reservation_sites (
  reservation_id BIGINT UNSIGNED NOT NULL,
  site_id BIGINT UNSIGNED NOT NULL,
  assigned_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (reservation_id, site_id),
  KEY idx_reservation_sites_site (site_id, reservation_id),
  CONSTRAINT fk_reservation_sites_reservation FOREIGN KEY (reservation_id) REFERENCES reservations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_reservation_sites_site FOREIGN KEY (site_id) REFERENCES sites (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS reservation_extras (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reservation_id BIGINT UNSIGNED NOT NULL,
  extra_id SMALLINT UNSIGNED NOT NULL,
  extra_name VARCHAR(100) NOT NULL,
  pricing_unit_code VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  quantity SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  billable_units SMALLINT UNSIGNED NOT NULL,
  unit_amount_cents INT UNSIGNED NOT NULL,
  total_amount_cents BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_reservation_extras (reservation_id, extra_id),
  CONSTRAINT fk_reservation_extras_reservation FOREIGN KEY (reservation_id) REFERENCES reservations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_reservation_extras_extra FOREIGN KEY (extra_id) REFERENCES extras (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_reservation_extras_pricing_unit FOREIGN KEY (pricing_unit_code) REFERENCES pricing_units (code) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_reservation_extras_values CHECK (quantity > 0 AND billable_units > 0 AND unit_amount_cents > 0 AND total_amount_cents = quantity * billable_units * unit_amount_cents)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS site_inventory_days (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id BIGINT UNSIGNED NOT NULL,
  stay_date DATE NOT NULL,
  status_code VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'available',
  reservation_id BIGINT UNSIGNED NULL,
  hold_expires_at DATETIME(6) NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_inventory_site_date (site_id, stay_date),
  KEY idx_inventory_reservation_status_date (reservation_id, status_code, stay_date),
  KEY idx_inventory_status_expiry (status_code, hold_expires_at),
  CONSTRAINT fk_inventory_site FOREIGN KEY (site_id) REFERENCES sites (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_inventory_status FOREIGN KEY (status_code) REFERENCES inventory_statuses (code) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_inventory_reservation FOREIGN KEY (reservation_id) REFERENCES reservations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_inventory_assignment CHECK (
    (status_code = 'available' AND reservation_id IS NULL AND hold_expires_at IS NULL)
    OR (status_code = 'blocked' AND reservation_id IS NULL)
    OR (status_code = 'held' AND reservation_id IS NOT NULL AND hold_expires_at IS NOT NULL)
    OR (status_code = 'booked' AND reservation_id IS NOT NULL AND hold_expires_at IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS payment_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reservation_id BIGINT UNSIGNED NOT NULL,
  quote_id BIGINT UNSIGNED NOT NULL,
  provider_code VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'clover',
  idempotency_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider_payment_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
  provider_reference VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status_code VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'started',
  amount_cents BIGINT UNSIGNED NOT NULL,
  tax_amount_cents BIGINT UNSIGNED NOT NULL,
  currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  card_brand VARCHAR(32) NULL,
  card_last4 CHAR(4) CHARACTER SET ascii COLLATE ascii_bin NULL,
  failure_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  failure_message VARCHAR(255) NULL,
  is_retryable TINYINT(1) NOT NULL DEFAULT 0,
  client_ip VARBINARY(16) NOT NULL,
  result_snapshot JSON NULL,
  started_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  completed_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_attempts_idempotency (provider_code, idempotency_key),
  UNIQUE KEY uq_payment_attempts_provider_payment (provider_code, provider_payment_id),
  UNIQUE KEY uq_payment_attempts_quote (quote_id),
  KEY idx_payment_attempts_reservation_status (reservation_id, status_code, created_at),
  KEY idx_payment_attempts_status_started (status_code, started_at),
  CONSTRAINT fk_payment_attempts_reservation FOREIGN KEY (reservation_id) REFERENCES reservations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_payment_attempts_quote FOREIGN KEY (quote_id) REFERENCES quotes (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_payment_attempts_status FOREIGN KEY (status_code) REFERENCES payment_statuses (code) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_payment_attempts_amount CHECK (amount_cents > 0),
  CONSTRAINT chk_payment_attempts_last4 CHECK (card_last4 IS NULL OR card_last4 REGEXP '^[0-9]{4}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS webhook_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider_code VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'clover',
  dedupe_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider_event_id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL,
  event_type VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL,
  provider_object_id VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL,
  payload JSON NOT NULL,
  processing_attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  received_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  processed_at DATETIME(6) NULL,
  last_error VARCHAR(500) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_webhook_events_dedupe (provider_code, dedupe_key),
  KEY idx_webhook_events_unprocessed (processed_at, received_at),
  KEY idx_webhook_events_object (provider_code, provider_object_id, received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS reservation_status_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reservation_id BIGINT UNSIGNED NOT NULL,
  from_status_code VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NULL,
  to_status_code VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  changed_by VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reason VARCHAR(255) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_reservation_history_reservation_created (reservation_id, created_at, id),
  CONSTRAINT fk_reservation_history_reservation FOREIGN KEY (reservation_id) REFERENCES reservations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_reservation_history_from_status FOREIGN KEY (from_status_code) REFERENCES reservation_statuses (code) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_reservation_history_to_status FOREIGN KEY (to_status_code) REFERENCES reservation_statuses (code) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO reservation_statuses (code, label, is_terminal) VALUES
  ('pending_payment', 'Pending payment', 0), ('confirmed', 'Confirmed', 0),
  ('payment_failed', 'Payment failed', 1), ('cancelled', 'Cancelled', 1),
  ('expired', 'Expired', 1), ('checked_in', 'Checked in', 0), ('checked_out', 'Checked out', 1)
ON DUPLICATE KEY UPDATE label = VALUES(label), is_terminal = VALUES(is_terminal);

INSERT INTO inventory_statuses (code, label) VALUES
  ('available', 'Available'), ('held', 'Held for payment'),
  ('booked', 'Booked'), ('blocked', 'Blocked by staff')
ON DUPLICATE KEY UPDATE label = VALUES(label);

INSERT INTO payment_statuses (code, label, is_terminal) VALUES
  ('started', 'Started', 0), ('unknown', 'Outcome unknown', 0),
  ('succeeded', 'Succeeded', 1), ('declined', 'Declined', 1),
  ('failed', 'Failed', 1), ('partially_refunded', 'Partially refunded', 0), ('refunded', 'Refunded', 1)
ON DUPLICATE KEY UPDATE label = VALUES(label), is_terminal = VALUES(is_terminal);

INSERT INTO quote_statuses (code, label) VALUES
  ('issued', 'Issued'), ('consumed', 'Consumed'), ('expired', 'Expired')
ON DUPLICATE KEY UPDATE label = VALUES(label);

INSERT INTO pricing_units (code, label) VALUES
  ('per_night', 'Per night'), ('per_stay', 'Per stay')
ON DUPLICATE KEY UPDATE label = VALUES(label);

INSERT INTO site_types (code, name, description, max_guests_per_site, default_nightly_cents, is_active) VALUES
  ('standard', 'Standard Back-In', 'Local development catalog value; confirm against the client inventory.', 6, 6500, 1),
  ('premium', 'Big-Rig Premium', 'Local development catalog value; confirm against the client inventory.', 6, 7900, 1),
  ('monthly', 'Extended Stay', 'Local development catalog value; confirm whether this is a site type or a rate plan.', 6, 2500, 1)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), max_guests_per_site = VALUES(max_guests_per_site), default_nightly_cents = VALUES(default_nightly_cents), is_active = VALUES(is_active);

INSERT INTO rate_plans (code, name, minimum_nights, maximum_nights, is_active) VALUES
  ('public', 'Public rate', 1, 365, 1)
ON DUPLICATE KEY UPDATE name = VALUES(name), minimum_nights = VALUES(minimum_nights), maximum_nights = VALUES(maximum_nights), is_active = VALUES(is_active);

INSERT INTO extras (code, name, pricing_unit_code, unit_amount_cents, is_active) VALUES
  ('vehicle', 'Extra vehicle', 'per_night', 500, 1),
  ('pet', 'Additional pet', 'per_night', 300, 1),
  ('early', 'Early check-in', 'per_night', 1500, 1)
ON DUPLICATE KEY UPDATE name = VALUES(name), pricing_unit_code = VALUES(pricing_unit_code), unit_amount_cents = VALUES(unit_amount_cents), is_active = VALUES(is_active);

INSERT INTO sites (site_type_id, site_code, is_active, is_placeholder)
SELECT st.id, seed.site_code, 1, 1
FROM site_types AS st
JOIN (
  SELECT 'standard' AS type_code, 'DEV-STD-01' AS site_code UNION ALL
  SELECT 'standard', 'DEV-STD-02' UNION ALL SELECT 'standard', 'DEV-STD-03' UNION ALL
  SELECT 'standard', 'DEV-STD-04' UNION ALL SELECT 'standard', 'DEV-STD-05' UNION ALL
  SELECT 'premium', 'DEV-PRM-01' UNION ALL SELECT 'premium', 'DEV-PRM-02' UNION ALL
  SELECT 'premium', 'DEV-PRM-03' UNION ALL SELECT 'premium', 'DEV-PRM-04' UNION ALL
  SELECT 'premium', 'DEV-PRM-05' UNION ALL SELECT 'monthly', 'DEV-EXT-01' UNION ALL
  SELECT 'monthly', 'DEV-EXT-02' UNION ALL SELECT 'monthly', 'DEV-EXT-03' UNION ALL
  SELECT 'monthly', 'DEV-EXT-04' UNION ALL SELECT 'monthly', 'DEV-EXT-05'
) AS seed ON seed.type_code = st.code
ON DUPLICATE KEY UPDATE site_type_id = VALUES(site_type_id), is_active = VALUES(is_active), is_placeholder = VALUES(is_placeholder);
