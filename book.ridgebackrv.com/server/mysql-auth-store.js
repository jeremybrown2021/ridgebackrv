function asDate(value) {
  if (value instanceof Date) return value;
  const text = String(value);
  return new Date(text.includes("T") ? text : `${text.replace(" ", "T")}Z`);
}

async function rollbackQuietly(connection) {
  try {
    await connection.rollback();
  } catch {
    // Preserve the original transaction error.
  }
}

export class MySqlAuthStore {
  constructor(pool) {
    this.pool = pool;
  }

  async createUser({ email, fullName, passwordHash }) {
    try {
      const [result] = await this.pool.execute(
        `INSERT INTO users (email, full_name, password_hash)
         VALUES (?, ?, ?)`,
        [email, fullName, passwordHash],
      );
      return this.findUserById(result.insertId);
    } catch (error) {
      if (Number(error.errno) === 1062) return null;
      throw error;
    }
  }

  async findUserByEmail(email) {
    const [rows] = await this.pool.execute(
      `SELECT id, email, full_name, password_hash, phone, rv_details, is_active
       FROM users
       WHERE email = ?
       LIMIT 1`,
      [email],
    );
    return rows[0] || null;
  }

  async findUserById(userId) {
    const [rows] = await this.pool.execute(
      `SELECT id, email, full_name, password_hash, phone, rv_details, is_active
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [userId],
    );
    return rows[0] || null;
  }

  async markLogin(userId) {
    await this.pool.execute(
      "UPDATE users SET last_login_at = UTC_TIMESTAMP(6) WHERE id = ?",
      [userId],
    );
  }

  async createSession({ userId, tokenHash, persistent, expiresAt, clientIp, userAgent }) {
    await this.pool.execute(
      `INSERT INTO auth_sessions (
         user_id, token_hash, is_persistent, expires_at, created_ip, user_agent
       ) VALUES (?, ?, ?, ?, INET6_ATON(?), ?)`,
      [userId, tokenHash, persistent ? 1 : 0, expiresAt, clientIp, userAgent || null],
    );
  }

  async findSession(tokenHash) {
    const [rows] = await this.pool.execute(
      `SELECT s.id AS session_id, s.expires_at, s.last_seen_at,
              u.id, u.email, u.full_name, u.phone, u.rv_details, u.is_active
       FROM auth_sessions AS s
       JOIN users AS u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP(6) AND u.is_active = 1
       LIMIT 1`,
      [tokenHash],
    );
    const session = rows[0] || null;
    if (!session) return null;
    if (Date.now() - asDate(session.last_seen_at).getTime() > 15 * 60_000) {
      await this.pool.execute(
        "UPDATE auth_sessions SET last_seen_at = UTC_TIMESTAMP(6) WHERE id = ?",
        [session.session_id],
      );
    }
    return session;
  }

  async deleteSession(tokenHash) {
    await this.pool.execute("DELETE FROM auth_sessions WHERE token_hash = ?", [tokenHash]);
  }

  async deleteExpiredSessions() {
    await this.pool.execute("DELETE FROM auth_sessions WHERE expires_at <= UTC_TIMESTAMP(6)");
  }

  async createPasswordReset({ userId, tokenHash, expiresAt, clientIp }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        "UPDATE password_reset_tokens SET consumed_at = UTC_TIMESTAMP(6) WHERE user_id = ? AND consumed_at IS NULL",
        [userId],
      );
      await connection.execute(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, requested_ip)
         VALUES (?, ?, ?, INET6_ATON(?))`,
        [userId, tokenHash, expiresAt, clientIp],
      );
      await connection.commit();
    } catch (error) {
      await rollbackQuietly(connection);
      throw error;
    } finally {
      connection.release();
    }
  }

  async consumePasswordReset({ tokenHash, passwordHash }) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [tokens] = await connection.execute(
        `SELECT id, user_id
         FROM password_reset_tokens
         WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > UTC_TIMESTAMP(6)
         FOR UPDATE`,
        [tokenHash],
      );
      if (tokens.length !== 1) {
        await connection.rollback();
        return null;
      }
      const token = tokens[0];
      await connection.execute(
        `UPDATE users
         SET password_hash = ?, password_changed_at = UTC_TIMESTAMP(6)
         WHERE id = ? AND is_active = 1`,
        [passwordHash, token.user_id],
      );
      await connection.execute(
        "UPDATE password_reset_tokens SET consumed_at = UTC_TIMESTAMP(6) WHERE user_id = ? AND consumed_at IS NULL",
        [token.user_id],
      );
      await connection.execute("DELETE FROM auth_sessions WHERE user_id = ?", [token.user_id]);
      await connection.commit();
      return this.findUserById(token.user_id);
    } catch (error) {
      await rollbackQuietly(connection);
      throw error;
    } finally {
      connection.release();
    }
  }

  async updateProfile(userId, { fullName, phone, rvDetails }) {
    await this.pool.execute(
      `UPDATE users
       SET full_name = ?, phone = ?, rv_details = ?
       WHERE id = ? AND is_active = 1`,
      [fullName, phone || null, rvDetails || null, userId],
    );
    return this.findUserById(userId);
  }

  async changePassword(userId, passwordHash) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `UPDATE users
         SET password_hash = ?, password_changed_at = UTC_TIMESTAMP(6)
         WHERE id = ? AND is_active = 1`,
        [passwordHash, userId],
      );
      await connection.execute("DELETE FROM auth_sessions WHERE user_id = ?", [userId]);
      await connection.execute(
        "UPDATE password_reset_tokens SET consumed_at = UTC_TIMESTAMP(6) WHERE user_id = ? AND consumed_at IS NULL",
        [userId],
      );
      await connection.commit();
    } catch (error) {
      await rollbackQuietly(connection);
      throw error;
    } finally {
      connection.release();
    }
  }

  async listReservations(userId) {
    const [rows] = await this.pool.execute(
      `SELECT r.reservation_number, r.status_code, r.arrival_date, r.departure_date,
              r.nights, r.site_count, r.adult_count, r.child_count,
              r.total_amount_cents, r.currency, r.created_at,
              st.name AS site_type_name,
              pa.card_brand, pa.card_last4, pa.provider_reference
       FROM reservations AS r
       JOIN site_types AS st ON st.id = r.site_type_id
       LEFT JOIN payment_attempts AS pa ON pa.reservation_id = r.id AND pa.status_code = 'succeeded'
       WHERE r.user_id = ?
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT 100`,
      [userId],
    );
    return rows.map((row) => ({
      reservationNumber: row.reservation_number,
      status: row.status_code,
      arrival: String(row.arrival_date).slice(0, 10),
      departure: String(row.departure_date).slice(0, 10),
      nights: Number(row.nights),
      sites: Number(row.site_count),
      adults: Number(row.adult_count),
      children: Number(row.child_count),
      totalCents: Number(row.total_amount_cents),
      currency: row.currency,
      siteType: row.site_type_name,
      payment: row.provider_reference ? {
        reference: row.provider_reference,
        cardBrand: row.card_brand || "",
        cardLast4: row.card_last4 || "",
      } : null,
    }));
  }
}
