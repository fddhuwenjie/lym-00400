import * as fs from "fs";
import * as path from "path";

export class Aof {
  private stream: fs.WriteStream | null = null;
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  open() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.stream = fs.createWriteStream(this.filePath, { flags: "a" });
  }

  write(args: string[]) {
    if (!this.stream) return;
    const parts: string[] = [`*${args.length}`];
    for (const arg of args) {
      parts.push(`$${Buffer.byteLength(arg)}`);
      parts.push(arg);
    }
    const line = parts.join("\r\n") + "\r\n";
    this.stream.write(line);
  }

  replay(callback: (args: string[]) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(this.filePath)) {
        resolve();
        return;
      }
      const content = fs.readFileSync(this.filePath, "utf8");
      if (!content.trim()) {
        resolve();
        return;
      }
      const commands = this.parseAofContent(content);
      for (const cmd of commands) {
        try {
          callback(cmd);
        } catch (e) {
          // skip malformed entries
        }
      }
      resolve();
    });
  }

  private parseAofContent(content: string): string[][] {
    const commands: string[][] = [];
    let pos = 0;
    const lines = content.split("\r\n");
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      if (!line) {
        i++;
        continue;
      }
      if (line.startsWith("*")) {
        const count = parseInt(line.slice(1), 10);
        if (isNaN(count) || count < 0) {
          i++;
          continue;
        }
        const args: string[] = [];
        let valid = true;
        i++;
        for (let j = 0; j < count; j++) {
          if (i >= lines.length) {
            valid = false;
            break;
          }
          const sizeLine = lines[i];
          if (!sizeLine || !sizeLine.startsWith("$")) {
            valid = false;
            break;
          }
          i++;
          if (i >= lines.length) {
            valid = false;
            break;
          }
          args.push(lines[i]);
          i++;
        }
        if (valid && args.length === count) {
          commands.push(args);
        }
      } else {
        i++;
      }
    }
    return commands;
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.stream) {
        this.stream.on("finish", () => {
          this.stream = null;
          resolve();
        });
        this.stream.end();
      } else {
        resolve();
      }
    });
  }
}
