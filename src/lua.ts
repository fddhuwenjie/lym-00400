import { to_luastring, to_jsstring, lua, lauxlib, lualib, LuaState } from "fengari";
import * as interop from "fengari-interop";
import { Store } from "./store";
import { Aof } from "./aof";

type RedisCallResult =
  | { type: "integer"; value: number }
  | { type: "bulk"; value: string | null }
  | { type: "simple"; value: string }
  | { type: "error"; value: string }
  | { type: "array"; value: RedisCallResult[] | null };

export class LuaScriptRunner {
  private store: Store;
  private aof: Aof;

  constructor(store: Store, aof: Aof) {
    this.store = store;
    this.aof = aof;
  }

  private pushResult(L: LuaState, result: RedisCallResult): void {
    switch (result.type) {
      case "integer":
        lua.lua_pushinteger(L, result.value);
        break;
      case "bulk":
        if (result.value === null) {
          lua.lua_pushnil(L);
        } else {
          lua.lua_pushstring(L, to_luastring(result.value));
        }
        break;
      case "simple":
        lua.lua_pushstring(L, to_luastring(result.value));
        break;
      case "error":
        lua.lua_pushstring(L, to_luastring(result.value));
        break;
      case "array":
        if (result.value === null) {
          lua.lua_pushnil(L);
        } else {
          lua.lua_createtable(L, result.value.length, 0);
          for (let i = 0; i < result.value.length; i++) {
            this.pushResult(L, result.value[i]);
            lua.lua_rawseti(L, -2, i + 1);
          }
        }
        break;
    }
  }

  private callCommand(args: string[]): RedisCallResult {
    const cmd = args[0].toUpperCase();

    switch (cmd) {
      case "PING":
        return { type: "simple", value: args[1] || "PONG" };
      case "ECHO":
        return { type: "bulk", value: args[1] || "" };
      case "SET": {
        if (args.length < 3) return { type: "error", value: "ERR wrong number of arguments" };
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
        this.store.set(key, value, exSeconds, pxMs);
        return { type: "simple", value: "OK" };
      }
      case "GET": {
        if (args.length < 2) return { type: "error", value: "ERR wrong number of arguments" };
        const val = this.store.get(args[1]);
        return { type: "bulk", value: val };
      }
      case "INCR": {
        if (args.length < 2) return { type: "error", value: "ERR wrong number of arguments" };
        const result = this.store.incr(args[1]);
        if (typeof result === "string") {
          return { type: "error", value: result };
        }
        return { type: "integer", value: result };
      }
      case "DEL": {
        let deleted = 0;
        for (let i = 1; i < args.length; i++) {
          deleted += this.store.del(args[i]);
        }
        return { type: "integer", value: deleted };
      }
      case "EXISTS": {
        return { type: "integer", value: this.store.exists(args[1]) };
      }
      case "EXPIRE": {
        if (args.length < 3) return { type: "error", value: "ERR wrong number of arguments" };
        const result = this.store.expire(args[1], parseInt(args[2], 10));
        return { type: "integer", value: result };
      }
      case "TTL": {
        if (args.length < 2) return { type: "error", value: "ERR wrong number of arguments" };
        return { type: "integer", value: this.store.ttl(args[1]) };
      }
      case "TYPE": {
        return { type: "simple", value: this.store.type(args[1]) };
      }
      case "HSET": {
        if (args.length < 4) return { type: "error", value: "ERR wrong number of arguments" };
        const key = args[1];
        let added = 0;
        for (let i = 2; i + 1 < args.length; i += 2) {
          const r = this.store.hset(key, args[i], args[i + 1]);
          if (r === -1) return { type: "error", value: "WRONGTYPE" };
          added += r;
        }
        return { type: "integer", value: added };
      }
      case "HGET": {
        if (args.length < 3) return { type: "error", value: "ERR wrong number of arguments" };
        const val = this.store.hget(args[1], args[2]);
        return { type: "bulk", value: val };
      }
      case "HGETALL": {
        if (args.length < 2) return { type: "error", value: "ERR wrong number of arguments" };
        const fields = this.store.hgetall(args[1]);
        const result: RedisCallResult[] = fields.map((f) => ({ type: "bulk", value: f }));
        return { type: "array", value: result };
      }
      case "LPUSH": {
        if (args.length < 3) return { type: "error", value: "ERR wrong number of arguments" };
        const result = this.store.lpush(args[1], ...args.slice(2));
        if (result === -1) return { type: "error", value: "WRONGTYPE" };
        return { type: "integer", value: result };
      }
      case "RPUSH": {
        if (args.length < 3) return { type: "error", value: "ERR wrong number of arguments" };
        const result = this.store.rpush(args[1], ...args.slice(2));
        if (result === -1) return { type: "error", value: "WRONGTYPE" };
        return { type: "integer", value: result };
      }
      case "LPOP": {
        if (args.length < 2) return { type: "error", value: "ERR wrong number of arguments" };
        const val = this.store.lpop(args[1]);
        return { type: "bulk", value: val };
      }
      case "RPOP": {
        if (args.length < 2) return { type: "error", value: "ERR wrong number of arguments" };
        const val = this.store.rpop(args[1]);
        return { type: "bulk", value: val };
      }
      case "LRANGE": {
        if (args.length < 4) return { type: "error", value: "ERR wrong number of arguments" };
        const items = this.store.lrange(args[1], parseInt(args[2], 10), parseInt(args[3], 10));
        const result: RedisCallResult[] = items.map((item) => ({ type: "bulk", value: item }));
        return { type: "array", value: result };
      }
      case "SADD": {
        if (args.length < 3) return { type: "error", value: "ERR wrong number of arguments" };
        const result = this.store.sadd(args[1], ...args.slice(2));
        if (result === -1) return { type: "error", value: "WRONGTYPE" };
        return { type: "integer", value: result };
      }
      case "SMEMBERS": {
        if (args.length < 2) return { type: "error", value: "ERR wrong number of arguments" };
        const members = this.store.smembers(args[1]);
        const result: RedisCallResult[] = members.map((m) => ({ type: "bulk", value: m }));
        return { type: "array", value: result };
      }
      case "SISMEMBER": {
        if (args.length < 3) return { type: "error", value: "ERR wrong number of arguments" };
        return { type: "integer", value: this.store.sismember(args[1], args[2]) };
      }
      case "ZADD": {
        if (args.length < 4) return { type: "error", value: "ERR wrong number of arguments" };
        const result = this.store.zadd(args[1], ...args.slice(2));
        if (typeof result === "string") {
          return { type: "error", value: result };
        }
        return { type: "integer", value: result };
      }
      case "ZSCORE": {
        if (args.length < 3) return { type: "error", value: "ERR wrong number of arguments" };
        const val = this.store.zscore(args[1], args[2]);
        return { type: "bulk", value: val };
      }
      case "ZRANK": {
        if (args.length < 3) return { type: "error", value: "ERR wrong number of arguments" };
        const rank = this.store.zrank(args[1], args[2]);
        if (rank === null) return { type: "bulk", value: null };
        return { type: "integer", value: rank };
      }
      case "ZRANGE": {
        if (args.length < 4) return { type: "error", value: "ERR wrong number of arguments" };
        let withScores = false;
        for (let i = 4; i < args.length; i++) {
          if (args[i].toUpperCase() === "WITHSCORES") withScores = true;
        }
        const items = this.store.zrange(
          args[1],
          parseInt(args[2], 10),
          parseInt(args[3], 10),
          withScores
        );
        const result: RedisCallResult[] = items.map((item) => ({ type: "bulk", value: item }));
        return { type: "array", value: result };
      }
      case "ZRANGEBYSCORE": {
        if (args.length < 4) return { type: "error", value: "ERR wrong number of arguments" };
        let withScores = false;
        for (let i = 4; i < args.length; i++) {
          if (args[i].toUpperCase() === "WITHSCORES") withScores = true;
        }
        const items = this.store.zrangebyscore(args[1], args[2], args[3], withScores);
        const result: RedisCallResult[] = items.map((item) => ({ type: "bulk", value: item }));
        return { type: "array", value: result };
      }
      case "ZREM": {
        if (args.length < 3) return { type: "error", value: "ERR wrong number of arguments" };
        const result = this.store.zrem(args[1], ...args.slice(2));
        if (typeof result === "string") {
          return { type: "error", value: result };
        }
        return { type: "integer", value: result };
      }
      case "ZCARD": {
        if (args.length < 2) return { type: "error", value: "ERR wrong number of arguments" };
        return { type: "integer", value: this.store.zcard(args[1]) };
      }
      default:
        return { type: "error", value: `ERR unknown command '${args[0]}'` };
    }
  }

  private isWriteCommand(cmd: string): boolean {
    const writeCmds = new Set([
      "SET", "INCR", "DEL", "EXPIRE",
      "HSET",
      "LPUSH", "RPUSH", "LPOP", "RPOP",
      "SADD",
      "ZADD", "ZREM",
    ]);
    return writeCmds.has(cmd.toUpperCase());
  }

  eval(script: string, numKeys: number, ...args: string[]): string {
    const L = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(L);

    const keys = args.slice(0, numKeys);
    const argv = args.slice(numKeys);

    lua.lua_createtable(L, keys.length, 0);
    for (let i = 0; i < keys.length; i++) {
      lua.lua_pushstring(L, to_luastring(keys[i]));
      lua.lua_rawseti(L, -2, i + 1);
    }
    lua.lua_setglobal(L, to_luastring("KEYS"));

    lua.lua_createtable(L, argv.length, 0);
    for (let i = 0; i < argv.length; i++) {
      lua.lua_pushstring(L, to_luastring(argv[i]));
      lua.lua_rawseti(L, -2, i + 1);
    }
    lua.lua_setglobal(L, to_luastring("ARGV"));

    const writeCommands: string[][] = [];

    const redisCall = (L: LuaState): number => {
      const n = lua.lua_gettop(L);
      const callArgs: string[] = [];
      for (let i = 1; i <= n; i++) {
        if (lua.lua_isstring(L, i)) {
          const s = lua.lua_tostring(L, i);
          callArgs.push(to_jsstring(s));
        } else if (lua.lua_isnumber(L, i)) {
          const num = lua.lua_tonumber(L, i);
          callArgs.push(String(num));
        } else {
          callArgs.push("");
        }
      }

      if (callArgs.length === 0) {
        lua.lua_pushstring(L, to_luastring("ERR wrong number of arguments"));
        return lua.lua_error(L);
      }

      const cmd = callArgs[0].toUpperCase();
      const result = this.callCommand(callArgs);

      if (result.type === "error") {
        lua.lua_pushstring(L, to_luastring(result.value));
        return lua.lua_error(L);
      }

      if (this.isWriteCommand(cmd)) {
        writeCommands.push(callArgs);
      }

      this.pushResult(L, result);
      return 1;
    };

    const redisPCall = (L: LuaState): number => {
      const n = lua.lua_gettop(L);
      const callArgs: string[] = [];
      for (let i = 1; i <= n; i++) {
        if (lua.lua_isstring(L, i)) {
          const s = lua.lua_tostring(L, i);
          callArgs.push(to_jsstring(s));
        } else if (lua.lua_isnumber(L, i)) {
          const num = lua.lua_tonumber(L, i);
          callArgs.push(String(num));
        } else {
          callArgs.push("");
        }
      }

      if (callArgs.length === 0) {
        lua.lua_pushnil(L);
        lua.lua_pushstring(L, to_luastring("ERR wrong number of arguments"));
        return 2;
      }

      const cmd = callArgs[0].toUpperCase();
      const result = this.callCommand(callArgs);

      if (result.type === "error") {
        lua.lua_pushboolean(L, 0);
        lua.lua_pushstring(L, to_luastring(result.value));
        return 2;
      }

      if (this.isWriteCommand(cmd)) {
        writeCommands.push(callArgs);
      }

      lua.lua_pushboolean(L, 1);
      this.pushResult(L, result);
      return 2;
    };

    const redisTable = lua.lua_createtable(L, 0, 2);
    lua.lua_pushjsfunction(L, redisCall);
    lua.lua_setfield(L, -2, to_luastring("call"));
    lua.lua_pushjsfunction(L, redisPCall);
    lua.lua_setfield(L, -2, to_luastring("pcall"));
    lua.lua_setglobal(L, to_luastring("redis"));

    interop.luaopen_js(L);
    lua.lua_pop(L, 1);

    const status = lauxlib.luaL_dostring(L, to_luastring(script));

    if (status !== lua.LUA_OK) {
      const err = lua.lua_tostring(L, -1);
      const errMsg = to_jsstring(err);
      lua.lua_close(L);
      throw new Error(errMsg);
    }

    const returnCount = lua.lua_gettop(L);

    let result: string;
    if (returnCount === 0) {
      result = "$-1\r\n";
    } else if (returnCount === 1) {
      result = this.encodeLuaValue(L, -1);
    } else {
      const items: string[] = [];
      for (let i = 1; i <= returnCount; i++) {
        items.push(this.encodeLuaValue(L, i));
      }
      result = `*${items.length}\r\n${items.join("")}`;
    }

    lua.lua_close(L);

    for (const cmd of writeCommands) {
      this.aof.write(cmd);
    }

    return result;
  }

  private encodeLuaValue(L: LuaState, index: number): string {
    const type = lua.lua_type(L, index);
    switch (type) {
      case lua.LUA_TNIL:
        return "$-1\r\n";
      case lua.LUA_TBOOLEAN:
        return `:${lua.lua_toboolean(L, index) ? 1 : 0}\r\n`;
      case lua.LUA_TNUMBER: {
        const num = lua.lua_tonumber(L, index);
        if (Number.isInteger(num)) {
          return `:${num}\r\n`;
        } else {
          const str = String(num);
          return `$${str.length}\r\n${str}\r\n`;
        }
      }
      case lua.LUA_TSTRING: {
        const s = to_jsstring(lua.lua_tostring(L, index));
        return `$${s.length}\r\n${s}\r\n`;
      }
      case lua.LUA_TTABLE: {
        return this.encodeLuaTable(L, index);
      }
      default:
        return "$-1\r\n";
    }
  }

  private encodeLuaTable(L: LuaState, index: number): string {
    const items: string[] = [];

    lua.lua_rawgeti(L, index, 1);
    const hasFirst = !lua.lua_isnil(L, -1);
    lua.lua_pop(L, 1);

    if (hasFirst) {
      let i = 1;
      while (true) {
        lua.lua_rawgeti(L, index, i);
        if (lua.lua_isnil(L, -1)) {
          lua.lua_pop(L, 1);
          break;
        }
        items.push(this.encodeLuaValue(L, -1));
        lua.lua_pop(L, 1);
        i++;
      }
    } else {
      lua.lua_pushnil(L);
      while (lua.lua_next(L, index - 1) !== 0) {
        items.push(this.encodeLuaValue(L, -1));
        lua.lua_pop(L, 1);
      }
    }

    return `*${items.length}\r\n${items.join("")}`;
  }
}
