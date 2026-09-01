import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export class PaymentConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "PaymentConflictError";
  }
}

function recordPath(directory, quoteId) {
  if (!/^[a-f0-9]{24}$/.test(quoteId)) throw new Error("Invalid quote ID.");
  return join(directory, `${quoteId}.json`);
}

async function readRecord(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeRecord(path, record) {
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  await rename(temporaryPath, path);
}

export class PaymentLedger {
  constructor(directory) {
    this.directory = directory;
  }

  async reserve(quoteId, idempotencyKey) {
    const path = recordPath(this.directory, quoteId);
    await mkdir(dirname(path), { recursive: true });
    const initialRecord = {
      quoteId,
      idempotencyKey,
      status: "started",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      const handle = await open(path, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(initialRecord)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      return { state: "new", record: initialRecord };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }

    const record = await readRecord(path);
    if (record.idempotencyKey !== idempotencyKey) {
      throw new PaymentConflictError("This quote has already been used for another payment attempt.");
    }
    return { state: record.status, record };
  }

  async complete(quoteId, idempotencyKey, result) {
    const path = recordPath(this.directory, quoteId);
    const existing = await readRecord(path);
    if (existing.idempotencyKey !== idempotencyKey) {
      throw new PaymentConflictError("Payment attempt does not match this quote.");
    }
    const record = {
      ...existing,
      status: "succeeded",
      result,
      updatedAt: new Date().toISOString(),
    };
    await writeRecord(path, record);
    return record;
  }

  async fail(quoteId, idempotencyKey, result) {
    const path = recordPath(this.directory, quoteId);
    const existing = await readRecord(path);
    if (existing.idempotencyKey !== idempotencyKey) {
      throw new PaymentConflictError("Payment attempt does not match this quote.");
    }
    const record = {
      ...existing,
      status: "failed",
      result,
      updatedAt: new Date().toISOString(),
    };
    await writeRecord(path, record);
    return record;
  }
}
