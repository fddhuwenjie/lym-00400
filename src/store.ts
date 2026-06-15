type StringValue = { value: string; expiresAt: number | null };
type HashValue = { fields: Map<string, string>; expiresAt: number | null };
type ListValue = { items: string[]; expiresAt: number | null };
type SetValue = { members: Set<string>; expiresAt: number | null };

type StoreEntry =
  | { type: "string"; data: StringValue }
  | { type: "hash"; data: HashValue }
  | { type: "list"; data: ListValue }
  | { type: "set"; data: SetValue };

export class Store {
  private entries = new Map<string, StoreEntry>();
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private onExpired: ((key: string) => void) | null = null;

  constructor() {
    this.startPeriodicScan();
  }

  setOnExpired(cb: (key: string) => void) {
    this.onExpired = cb;
  }

  private isExpired(entry: StoreEntry): boolean {
    if (
      entry.data.expiresAt !== null &&
      Date.now() >= entry.data.expiresAt
    ) {
      return true;
    }
    return false;
  }

  private checkKey(key: string): StoreEntry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.isExpired(entry)) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  private ensureType(key: string, expectedType: StoreEntry["type"]): boolean {
    const entry = this.checkKey(key);
    if (!entry) return true;
    return entry.type === expectedType;
  }

  private wrongTypeErr(): string {
    return "WRONGTYPE Operation against a key holding the wrong kind of value";
  }

  get(key: string): string | null {
    const entry = this.checkKey(key);
    if (!entry) return null;
    if (entry.type !== "string") return null;
    return entry.data.value;
  }

  set(
    key: string,
    value: string,
    exSeconds?: number,
    pxMilliseconds?: number
  ): string {
    let expiresAt: number | null = null;
    if (exSeconds !== undefined) {
      expiresAt = Date.now() + exSeconds * 1000;
    } else if (pxMilliseconds !== undefined) {
      expiresAt = Date.now() + pxMilliseconds;
    }
    this.entries.set(key, {
      type: "string",
      data: { value, expiresAt },
    });
    return "OK";
  }

  incr(key: string): string | number {
    const entry = this.checkKey(key);
    if (!entry) {
      this.entries.set(key, {
        type: "string",
        data: { value: "1", expiresAt: null },
      });
      return 1;
    }
    if (entry.type !== "string") return this.wrongTypeErr();
    const num = Number(entry.data.value);
    if (isNaN(num) || !isFinite(num)) {
      return "ERR value is not an integer or out of range";
    }
    const result = num + 1;
    entry.data.value = String(result);
    return result;
  }

  expire(key: string, seconds: number): number {
    const entry = this.checkKey(key);
    if (!entry) return 0;
    entry.data.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }

  ttl(key: string): number {
    const entry = this.checkKey(key);
    if (!entry) return -2;
    if (entry.data.expiresAt === null) return -1;
    const remaining = Math.ceil(
      (entry.data.expiresAt - Date.now()) / 1000
    );
    if (remaining <= 0) {
      this.entries.delete(key);
      return -2;
    }
    return remaining;
  }

  del(key: string): number {
    const entry = this.checkKey(key);
    if (!entry) return 0;
    this.entries.delete(key);
    return 1;
  }

  exists(key: string): number {
    const entry = this.checkKey(key);
    return entry ? 1 : 0;
  }

  hset(key: string, field: string, value: string): number {
    if (!this.ensureType(key, "hash")) return -1;
    let entry = this.checkKey(key) as StoreEntry | undefined;
    if (!entry) {
      entry = {
        type: "hash",
        data: { fields: new Map(), expiresAt: null },
      };
      this.entries.set(key, entry);
    }
    const isNew = !(entry.data as HashValue).fields.has(field);
    (entry.data as HashValue).fields.set(field, value);
    return isNew ? 1 : 0;
  }

  hget(key: string, field: string): string | null {
    const entry = this.checkKey(key);
    if (!entry) return null;
    if (entry.type !== "hash") return null;
    return (entry.data as HashValue).fields.get(field) ?? null;
  }

  hgetall(key: string): string[] {
    const entry = this.checkKey(key);
    if (!entry) return [];
    if (entry.type !== "hash") return [];
    const result: string[] = [];
    const fields = (entry.data as HashValue).fields;
    for (const [k, v] of fields) {
      result.push(k, v);
    }
    return result;
  }

  lpush(key: string, ...values: string[]): number {
    if (!this.ensureType(key, "list")) return -1;
    let entry = this.checkKey(key) as StoreEntry | undefined;
    if (!entry) {
      entry = {
        type: "list",
        data: { items: [], expiresAt: null },
      };
      this.entries.set(key, entry);
    }
    const list = entry.data as ListValue;
    for (const v of values) {
      list.items.unshift(v);
    }
    return list.items.length;
  }

  rpush(key: string, ...values: string[]): number {
    if (!this.ensureType(key, "list")) return -1;
    let entry = this.checkKey(key) as StoreEntry | undefined;
    if (!entry) {
      entry = {
        type: "list",
        data: { items: [], expiresAt: null },
      };
      this.entries.set(key, entry);
    }
    const list = entry.data as ListValue;
    for (const v of values) {
      list.items.push(v);
    }
    return list.items.length;
  }

  lpop(key: string): string | null {
    const entry = this.checkKey(key);
    if (!entry) return null;
    if (entry.type !== "list") return null;
    const list = entry.data as ListValue;
    if (list.items.length === 0) return null;
    return list.items.shift() ?? null;
  }

  rpop(key: string): string | null {
    const entry = this.checkKey(key);
    if (!entry) return null;
    if (entry.type !== "list") return null;
    const list = entry.data as ListValue;
    if (list.items.length === 0) return null;
    return list.items.pop() ?? null;
  }

  lrange(key: string, start: number, stop: number): string[] {
    const entry = this.checkKey(key);
    if (!entry) return [];
    if (entry.type !== "list") return [];
    const list = entry.data as ListValue;
    const len = list.items.length;
    let s = start < 0 ? len + start : start;
    let e = stop < 0 ? len + stop : stop;
    s = Math.max(0, s);
    e = Math.min(len - 1, e);
    if (s > e) return [];
    return list.items.slice(s, e + 1);
  }

  sadd(key: string, ...members: string[]): number {
    if (!this.ensureType(key, "set")) return -1;
    let entry = this.checkKey(key) as StoreEntry | undefined;
    if (!entry) {
      entry = {
        type: "set",
        data: { members: new Set(), expiresAt: null },
      };
      this.entries.set(key, entry);
    }
    const set = entry.data as SetValue;
    let added = 0;
    for (const m of members) {
      if (!set.members.has(m)) {
        set.members.add(m);
        added++;
      }
    }
    return added;
  }

  smembers(key: string): string[] {
    const entry = this.checkKey(key);
    if (!entry) return [];
    if (entry.type !== "set") return [];
    return Array.from((entry.data as SetValue).members);
  }

  sismember(key: string, member: string): number {
    const entry = this.checkKey(key);
    if (!entry) return 0;
    if (entry.type !== "set") return 0;
    return (entry.data as SetValue).members.has(member) ? 1 : 0;
  }

  keys(pattern: string): string[] {
    const result: string[] = [];
    const regex = globToRegex(pattern);
    for (const key of this.entries.keys()) {
      const entry = this.entries.get(key);
      if (entry && !this.isExpired(entry) && regex.test(key)) {
        result.push(key);
      }
    }
    return result;
  }

  type(key: string): string {
    const entry = this.checkKey(key);
    if (!entry) return "none";
    return entry.type;
  }

  private startPeriodicScan() {
    this.scanTimer = setInterval(() => {
      this.sampleExpireScan();
    }, 1000);
    if (this.scanTimer.unref) {
      this.scanTimer.unref();
    }
  }

  private sampleExpireScan() {
    const allKeys = Array.from(this.entries.keys());
    if (allKeys.length === 0) return;
    const sampleSize = Math.min(20, allKeys.length);
    const expiredKeys: string[] = [];
    for (let i = 0; i < sampleSize; i++) {
      const idx = Math.floor(Math.random() * allKeys.length);
      const key = allKeys[idx];
      const entry = this.entries.get(key);
      if (entry && this.isExpired(entry)) {
        expiredKeys.push(key);
      }
    }
    for (const key of expiredKeys) {
      this.entries.delete(key);
      if (this.onExpired) {
        this.onExpired(key);
      }
    }
  }

  getRawEntries(): Map<string, StoreEntry> {
    return this.entries;
  }

  replayCommand(args: string[]) {
    const cmd = args[0].toUpperCase();
    switch (cmd) {
      case "SET": {
        const [key, value, ...rest] = args.slice(1);
        let exSeconds: number | undefined;
        let pxMs: number | undefined;
        for (let i = 0; i < rest.length; i++) {
          const opt = rest[i].toUpperCase();
          if (opt === "EX" && rest[i + 1]) {
            exSeconds = parseInt(rest[i + 1], 10);
            i++;
          } else if (opt === "PX" && rest[i + 1]) {
            pxMs = parseInt(rest[i + 1], 10);
            i++;
          }
        }
        this.set(key, value, exSeconds, pxMs);
        break;
      }
      case "INCR":
        this.incr(args[1]);
        break;
      case "DEL":
        for (const k of args.slice(1)) this.del(k);
        break;
      case "HSET": {
        const fields = args.slice(2);
        for (let i = 0; i + 1 < fields.length; i += 2) {
          this.hset(args[1], fields[i], fields[i + 1]);
        }
        break;
      }
      case "LPUSH":
        this.lpush(args[1], ...args.slice(2));
        break;
      case "RPUSH":
        this.rpush(args[1], ...args.slice(2));
        break;
      case "LPOP":
        this.lpop(args[1]);
        break;
      case "RPOP":
        this.rpop(args[1]);
        break;
      case "SADD":
        this.sadd(args[1], ...args.slice(2));
        break;
      case "EXPIRE":
        this.expire(args[1], parseInt(args[2], 10));
        break;
    }
  }

  destroy() {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
  }
}

function globToRegex(pattern: string): RegExp {
  let regex = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      regex += ".*";
    } else if (ch === "?") {
      regex += ".";
    } else if (ch === "[") {
      regex += "[";
    } else {
      regex += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  regex += "$";
  return new RegExp(regex, "i");
}
