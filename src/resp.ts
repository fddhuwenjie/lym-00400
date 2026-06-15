export type RespValue =
  | { type: "simple-string"; value: string }
  | { type: "error"; value: string }
  | { type: "integer"; value: number }
  | { type: "bulk-string"; value: string | null }
  | { type: "array"; value: RespValue[] | null };

const CRLF = Buffer.from("\r\n");
const CRLF_BYTE = 0x0d;

export class RespParser {
  private buffer = Buffer.alloc(0);

  feed(data: Buffer): RespValue[] {
    this.buffer = Buffer.concat([this.buffer, data]);
    const results: RespValue[] = [];
    while (this.buffer.length > 0) {
      const result = this.tryParse();
      if (result === null) break;
      const [value, consumed] = result;
      results.push(value);
      this.buffer = this.buffer.slice(consumed);
    }
    return results;
  }

  private tryParse(): [RespValue, number] | null {
    if (this.buffer.length === 0) return null;
    const typeByte = this.buffer[0];
    switch (typeByte) {
      case 0x2b:
        return this.parseSimpleString();
      case 0x2d:
        return this.parseError();
      case 0x3a:
        return this.parseInteger();
      case 0x24:
        return this.parseBulkString();
      case 0x2a:
        return this.parseArray();
      default: {
        const inlineEnd = this.findCRLF(0);
        if (inlineEnd === -1) return null;
        const line = this.buffer.toString("utf8", 0, inlineEnd);
        const parts = line.split(/\s+/);
        const elements: RespValue[] = parts.map(
          (p) =>
            ({
              type: "bulk-string",
              value: p,
            }) as RespValue
        );
        return [{ type: "array", value: elements }, inlineEnd + 2];
      }
    }
  }

  private findCRLF(offset: number): number {
    for (let i = offset; i < this.buffer.length - 1; i++) {
      if (
        this.buffer[i] === CRLF_BYTE &&
        this.buffer[i + 1] === 0x0a
      ) {
        return i;
      }
    }
    return -1;
  }

  private parseSimpleString(): [RespValue, number] | null {
    const crlfIdx = this.findCRLF(1);
    if (crlfIdx === -1) return null;
    const value = this.buffer.toString("utf8", 1, crlfIdx);
    return [{ type: "simple-string", value }, crlfIdx + 2];
  }

  private parseError(): [RespValue, number] | null {
    const crlfIdx = this.findCRLF(1);
    if (crlfIdx === -1) return null;
    const value = this.buffer.toString("utf8", 1, crlfIdx);
    return [{ type: "error", value }, crlfIdx + 2];
  }

  private parseInteger(): [RespValue, number] | null {
    const crlfIdx = this.findCRLF(1);
    if (crlfIdx === -1) return null;
    const value = parseInt(this.buffer.toString("utf8", 1, crlfIdx), 10);
    return [{ type: "integer", value }, crlfIdx + 2];
  }

  private parseBulkString(): [RespValue, number] | null {
    const crlfIdx = this.findCRLF(1);
    if (crlfIdx === -1) return null;
    const len = parseInt(this.buffer.toString("utf8", 1, crlfIdx), 10);
    if (len === -1) {
      return [{ type: "bulk-string", value: null }, crlfIdx + 2];
    }
    const dataStart = crlfIdx + 2;
    const dataEnd = dataStart + len;
    if (dataEnd + 2 > this.buffer.length) return null;
    const value = this.buffer.toString("utf8", dataStart, dataEnd);
    return [{ type: "bulk-string", value }, dataEnd + 2];
  }

  private parseArray(): [RespValue, number] | null {
    const crlfIdx = this.findCRLF(1);
    if (crlfIdx === -1) return null;
    const count = parseInt(this.buffer.toString("utf8", 1, crlfIdx), 10);
    if (count === -1) {
      return [{ type: "array", value: null }, crlfIdx + 2];
    }
    const elements: RespValue[] = [];
    let offset = crlfIdx + 2;
    for (let i = 0; i < count; i++) {
      const saved = this.buffer;
      this.buffer = this.buffer.slice(offset);
      const result = this.tryParse();
      this.buffer = saved;
      if (result === null) return null;
      const [value, consumed] = result;
      elements.push(value);
      offset += consumed;
    }
    return [{ type: "array", value: elements }, offset];
  }
}

export function encodeSimpleString(s: string): string {
  return `+${s}\r\n`;
}

export function encodeError(s: string): string {
  return `-${s}\r\n`;
}

export function encodeInteger(n: number): string {
  return `:${n}\r\n`;
}

export function encodeBulkString(s: string | null): string {
  if (s === null) return "$-1\r\n";
  return `$${s.length}\r\n${s}\r\n`;
}

export function encodeArray(items: (string | null)[]): string {
  let result = `*${items.length}\r\n`;
  for (const item of items) {
    result += encodeBulkString(item);
  }
  return result;
}

export function extractCommand(resp: RespValue): string[] | null {
  if (resp.type !== "array" || resp.value === null) return null;
  const parts: string[] = [];
  for (const el of resp.value) {
    if (el.type === "bulk-string" && el.value !== null) {
      parts.push(el.value);
    } else if (el.type === "simple-string") {
      parts.push(el.value);
    } else if (el.type === "integer") {
      parts.push(String(el.value));
    } else {
      return null;
    }
  }
  return parts;
}
