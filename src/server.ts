import * as net from "net";
import { RespParser, extractCommand, encodeSimpleString, encodeError, encodeInteger, encodeBulkString, encodeArray } from "./resp";
import { Store } from "./store";
import { Aof } from "./aof";
import { PubSub } from "./pubsub";
import { LuaScriptRunner } from "./lua";

const DEFAULT_PORT = 6380;
const AOF_PATH = "./data/mini-redis.aof";

const store = new Store();
const aof = new Aof(AOF_PATH);
const pubsub = new PubSub();
const luaRunner = new LuaScriptRunner(store, aof);

async function main() {
  await aof.replay((args) => store.replayCommand(args));
  aof.open();

  store.setOnExpired((key) => {
    // expired keys are lazily cleaned, no AOF entry needed
  });

  const server = net.createServer((socket) => {
    const parser = new RespParser();
    const clientName = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`Client connected: ${clientName}`);

    socket.on("data", (data: Buffer) => {
      const messages = parser.feed(data);
      for (const msg of messages) {
        const args = extractCommand(msg);
        if (!args || args.length === 0) {
          socket.write(encodeError("ERR empty command"));
          continue;
        }
        handleCommand(socket, args);
      }
    });

    socket.on("close", () => {
      console.log(`Client disconnected: ${clientName}`);
      pubsub.removeClient(socket);
    });

    socket.on("error", (err) => {
      console.error(`Socket error from ${clientName}:`, err.message);
      pubsub.removeClient(socket);
    });
  });

  server.listen(DEFAULT_PORT, () => {
    console.log(`MiniRedis server listening on port ${DEFAULT_PORT}`);
  });

  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    aof.close();
    store.destroy();
    server.close();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    aof.close();
    store.destroy();
    server.close();
    process.exit(0);
  });
}

function handleCommand(socket: net.Socket, args: string[]) {
  const cmd = args[0].toUpperCase();

  switch (cmd) {
    case "PING":
      if (args.length > 1) {
        socket.write(encodeBulkString(args[1]));
      } else {
        socket.write(encodeSimpleString("PONG"));
      }
      break;

    case "ECHO":
      socket.write(encodeBulkString(args[1] ?? ""));
      break;

    case "COMMAND":
      socket.write(encodeSimpleString("OK"));
      break;

    case "INFO":
      socket.write(encodeBulkString("# MiniRedis\r\nredis_version:1.0.0\r\n"));
      break;

    case "CLIENT":
      socket.write(encodeSimpleString("OK"));
      break;

    case "CONFIG":
      if (args.length > 1 && args[1].toUpperCase() === "GET") {
        socket.write(encodeArray([]));
      } else {
        socket.write(encodeSimpleString("OK"));
      }
      break;

    case "QUIT":
      socket.write(encodeSimpleString("OK"));
      socket.end();
      break;

    case "SELECT":
      socket.write(encodeSimpleString("OK"));
      break;

    case "SET": {
      if (args.length < 3) {
        socket.write(encodeError("ERR wrong number of arguments for 'set' command"));
        break;
      }
      const key = args[1];
      const value = args[2];
      let exSeconds: number | undefined;
      let pxMs: number | undefined;
      for (let i = 3; i < args.length; i++) {
        const opt = args[i].toUpperCase();
        if (opt === "EX" && i + 1 < args.length) {
          exSeconds = parseInt(args[++i], 10);
        } else if (opt === "PX" && i + 1 < args.length) {
          pxMs = parseInt(args[++i], 10);
        }
      }
      const result = store.set(key, value, exSeconds, pxMs);
      aof.write(args);
      socket.write(encodeSimpleString(result));
      break;
    }

    case "GET": {
      if (args.length < 2) {
        socket.write(encodeError("ERR wrong number of arguments for 'get' command"));
        break;
      }
      const val = store.get(args[1]);
      socket.write(encodeBulkString(val));
      break;
    }

    case "INCR": {
      if (args.length < 2) {
        socket.write(encodeError("ERR wrong number of arguments for 'incr' command"));
        break;
      }
      const result = store.incr(args[1]);
      if (typeof result === "string" && result.startsWith("ERR")) {
        socket.write(encodeError(result));
      } else if (typeof result === "string" && result.startsWith("WRONGTYPE")) {
        socket.write(encodeError(result));
      } else {
        aof.write(args);
        socket.write(encodeInteger(result as number));
      }
      break;
    }

    case "EXPIRE": {
      if (args.length < 3) {
        socket.write(encodeError("ERR wrong number of arguments for 'expire' command"));
        break;
      }
      const result = store.expire(args[1], parseInt(args[2], 10));
      if (result === 1) aof.write(args);
      socket.write(encodeInteger(result));
      break;
    }

    case "TTL": {
      if (args.length < 2) {
        socket.write(encodeError("ERR wrong number of arguments for 'ttl' command"));
        break;
      }
      const ttl = store.ttl(args[1]);
      socket.write(encodeInteger(ttl));
      break;
    }

    case "DEL": {
      let deleted = 0;
      for (let i = 1; i < args.length; i++) {
        deleted += store.del(args[i]);
      }
      if (deleted > 0) aof.write(args);
      socket.write(encodeInteger(deleted));
      break;
    }

    case "EXISTS": {
      const count = store.exists(args[1]);
      socket.write(encodeInteger(count));
      break;
    }

    case "KEYS": {
      const keys = store.keys(args[1] ?? "*");
      socket.write(encodeArray(keys));
      break;
    }

    case "TYPE": {
      const t = store.type(args[1]);
      socket.write(encodeSimpleString(t));
      break;
    }

    case "HSET": {
      if (args.length < 4 || (args.length - 2) % 2 !== 0) {
        socket.write(encodeError("ERR wrong number of arguments for 'hset' command"));
        break;
      }
      const key = args[1];
      let added = 0;
      for (let i = 2; i + 1 < args.length; i += 2) {
        const r = store.hset(key, args[i], args[i + 1]);
        if (r === -1) {
          socket.write(encodeError(store.get(args[1]) === null ? "WRONGTYPE Operation against a key holding the wrong kind of value" : "ERR"));
          return;
        }
        added += r;
      }
      aof.write(args);
      socket.write(encodeInteger(added));
      break;
    }

    case "HGET": {
      if (args.length < 3) {
        socket.write(encodeError("ERR wrong number of arguments for 'hget' command"));
        break;
      }
      const val = store.hget(args[1], args[2]);
      socket.write(encodeBulkString(val));
      break;
    }

    case "HGETALL": {
      if (args.length < 2) {
        socket.write(encodeError("ERR wrong number of arguments for 'hgetall' command"));
        break;
      }
      const fields = store.hgetall(args[1]);
      socket.write(encodeArray(fields));
      break;
    }

    case "LPUSH": {
      if (args.length < 3) {
        socket.write(encodeError("ERR wrong number of arguments for 'lpush' command"));
        break;
      }
      const result = store.lpush(args[1], ...args.slice(2));
      if (result === -1) {
        socket.write(encodeError("WRONGTYPE Operation against a key holding the wrong kind of value"));
        break;
      }
      aof.write(args);
      socket.write(encodeInteger(result));
      break;
    }

    case "RPUSH": {
      if (args.length < 3) {
        socket.write(encodeError("ERR wrong number of arguments for 'rpush' command"));
        break;
      }
      const result = store.rpush(args[1], ...args.slice(2));
      if (result === -1) {
        socket.write(encodeError("WRONGTYPE Operation against a key holding the wrong kind of value"));
        break;
      }
      aof.write(args);
      socket.write(encodeInteger(result));
      break;
    }

    case "LPOP": {
      if (args.length < 2) {
        socket.write(encodeError("ERR wrong number of arguments for 'lpop' command"));
        break;
      }
      const val = store.lpop(args[1]);
      if (val !== null) aof.write(args);
      socket.write(encodeBulkString(val));
      break;
    }

    case "RPOP": {
      if (args.length < 2) {
        socket.write(encodeError("ERR wrong number of arguments for 'rpop' command"));
        break;
      }
      const val = store.rpop(args[1]);
      if (val !== null) aof.write(args);
      socket.write(encodeBulkString(val));
      break;
    }

    case "LRANGE": {
      if (args.length < 4) {
        socket.write(encodeError("ERR wrong number of arguments for 'lrange' command"));
        break;
      }
      const items = store.lrange(args[1], parseInt(args[2], 10), parseInt(args[3], 10));
      socket.write(encodeArray(items));
      break;
    }

    case "SADD": {
      if (args.length < 3) {
        socket.write(encodeError("ERR wrong number of arguments for 'sadd' command"));
        break;
      }
      const result = store.sadd(args[1], ...args.slice(2));
      if (result === -1) {
        socket.write(encodeError("WRONGTYPE Operation against a key holding the wrong kind of value"));
        break;
      }
      aof.write(args);
      socket.write(encodeInteger(result));
      break;
    }

    case "SMEMBERS": {
      if (args.length < 2) {
        socket.write(encodeError("ERR wrong number of arguments for 'smembers' command"));
        break;
      }
      const members = store.smembers(args[1]);
      socket.write(encodeArray(members));
      break;
    }

    case "SISMEMBER": {
      if (args.length < 3) {
        socket.write(encodeError("ERR wrong number of arguments for 'sismember' command"));
        break;
      }
      const result = store.sismember(args[1], args[2]);
      socket.write(encodeInteger(result));
      break;
    }

    case "ZADD": {
      if (args.length < 4 || (args.length - 2) % 2 !== 0) {
        socket.write(encodeError("ERR wrong number of arguments for 'zadd' command"));
        break;
      }
      const result = store.zadd(args[1], ...args.slice(2));
      if (typeof result === "string" && result.startsWith("ERR")) {
        socket.write(encodeError(result));
      } else if (typeof result === "string" && result.startsWith("WRONGTYPE")) {
        socket.write(encodeError(result));
      } else {
        aof.write(args);
        socket.write(encodeInteger(result as number));
      }
      break;
    }

    case "ZSCORE": {
      if (args.length < 3) {
        socket.write(encodeError("ERR wrong number of arguments for 'zscore' command"));
        break;
      }
      const val = store.zscore(args[1], args[2]);
      socket.write(encodeBulkString(val));
      break;
    }

    case "ZRANK": {
      if (args.length < 3) {
        socket.write(encodeError("ERR wrong number of arguments for 'zrank' command"));
        break;
      }
      const rank = store.zrank(args[1], args[2]);
      if (rank === null) {
        socket.write(encodeBulkString(null));
      } else {
        socket.write(encodeInteger(rank));
      }
      break;
    }

    case "ZRANGE": {
      if (args.length < 4) {
        socket.write(encodeError("ERR wrong number of arguments for 'zrange' command"));
        break;
      }
      let withScores = false;
      for (let i = 4; i < args.length; i++) {
        if (args[i].toUpperCase() === "WITHSCORES") {
          withScores = true;
        }
      }
      const items = store.zrange(args[1], parseInt(args[2], 10), parseInt(args[3], 10), withScores);
      socket.write(encodeArray(items));
      break;
    }

    case "ZRANGEBYSCORE": {
      if (args.length < 4) {
        socket.write(encodeError("ERR wrong number of arguments for 'zrangebyscore' command"));
        break;
      }
      let withScores = false;
      for (let i = 4; i < args.length; i++) {
        if (args[i].toUpperCase() === "WITHSCORES") {
          withScores = true;
        }
      }
      const items = store.zrangebyscore(args[1], args[2], args[3], withScores);
      socket.write(encodeArray(items));
      break;
    }

    case "ZREM": {
      if (args.length < 3) {
        socket.write(encodeError("ERR wrong number of arguments for 'zrem' command"));
        break;
      }
      const result = store.zrem(args[1], ...args.slice(2));
      if (typeof result === "string" && result.startsWith("WRONGTYPE")) {
        socket.write(encodeError(result));
      } else {
        if ((result as number) > 0) aof.write(args);
        socket.write(encodeInteger(result as number));
      }
      break;
    }

    case "ZCARD": {
      if (args.length < 2) {
        socket.write(encodeError("ERR wrong number of arguments for 'zcard' command"));
        break;
      }
      const count = store.zcard(args[1]);
      socket.write(encodeInteger(count));
      break;
    }

    case "EVAL": {
      if (args.length < 3) {
        socket.write(encodeError("ERR wrong number of arguments for 'eval' command"));
        break;
      }
      const script = args[1];
      const numKeys = parseInt(args[2], 10);
      if (isNaN(numKeys)) {
        socket.write(encodeError("ERR value is not an integer or out of range"));
        break;
      }
      const scriptArgs = args.slice(3);
      try {
        const result = luaRunner.eval(script, numKeys, ...scriptArgs);
        socket.write(result);
      } catch (e: any) {
        socket.write(encodeError(`ERR ${e.message}`));
      }
      break;
    }

    case "SUBSCRIBE": {
      if (args.length < 2) {
        socket.write(encodeError("ERR wrong number of arguments for 'subscribe' command"));
        break;
      }
      for (let i = 1; i < args.length; i++) {
        const count = pubsub.subscribe(socket, args[i]);
        socket.write(`*3\r\n$9\r\nsubscribe\r\n$${Buffer.byteLength(args[i])}\r\n${args[i]}\r\n:${count}\r\n`);
      }
      break;
    }

    case "PUBLISH": {
      if (args.length < 3) {
        socket.write(encodeError("ERR wrong number of arguments for 'publish' command"));
        break;
      }
      const count = pubsub.publish(args[1], args[2]);
      socket.write(encodeInteger(count));
      break;
    }

    case "UNSUBSCRIBE": {
      if (args.length < 2) {
        const count = pubsub.unsubscribe(socket);
        socket.write(`*3\r\n$11\r\nunsubscribe\r\n$-1\r\n:${count}\r\n`);
      } else {
        for (let i = 1; i < args.length; i++) {
          const count = pubsub.unsubscribe(socket, args[i]);
          socket.write(`*3\r\n$11\r\nunsubscribe\r\n$${Buffer.byteLength(args[i])}\r\n${args[i]}\r\n:${count}\r\n`);
        }
      }
      break;
    }

    case "DBSIZE": {
      let size = 0;
      for (const key of store.getRawEntries().keys()) {
        if (store.get(key) !== null || store.type(key) !== "none") size++;
      }
      socket.write(encodeInteger(size));
      break;
    }

    case "FLUSHALL": {
      for (const key of Array.from(store.getRawEntries().keys())) {
        store.del(key);
      }
      socket.write(encodeSimpleString("OK"));
      break;
    }

    default:
      socket.write(encodeError(`ERR unknown command '${args[0]}', with args beginning with: ${args.slice(1).map(a => `'${a}'`).join(" ")}`));
      break;
  }
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
