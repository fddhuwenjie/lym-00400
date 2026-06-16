declare module "fengari" {
  export type LuaState = any;

  export function to_luastring(s: string): any;
  export function to_jsstring(s: any): string;

  export const lua: {
    LUA_OK: number;
    LUA_TNIL: number;
    LUA_TBOOLEAN: number;
    LUA_TNUMBER: number;
    LUA_TSTRING: number;
    LUA_TTABLE: number;
    LUA_TFUNCTION: number;
    LUA_TUSERDATA: number;
    LUA_TTHREAD: number;
    LUA_TLIGHTUSERDATA: number;

    lua_pushnil(L: State): void;
    lua_pushboolean(L: State, b: number): void;
    lua_pushinteger(L: State, n: number): void;
    lua_pushnumber(L: State, n: number): void;
    lua_pushstring(L: State, s: any): void;
    lua_pushliteral(L: State, s: string): void;
    lua_pushcfunction(L: State, fn: (L: State) => number): void;
    lua_pushjsfunction(L: State, fn: (L: State) => number): void;
    lua_pushjsclosure(L: State, fn: (L: State) => number, n: number): void;

    lua_toboolean(L: State, idx: number): number;
    lua_tointeger(L: State, idx: number): number;
    lua_tonumber(L: State, idx: number): number;
    lua_tostring(L: State, idx: number): any;

    lua_type(L: State, idx: number): number;
    lua_isstring(L: State, idx: number): boolean;
    lua_isnumber(L: State, idx: number): boolean;
    lua_isnil(L: State, idx: number): boolean;

    lua_gettop(L: State): number;
    lua_settop(L: State, idx: number): void;
    lua_pop(L: State, n: number): void;

    lua_createtable(L: State, narr: number, nrec: number): void;
    lua_newtable(L: State): void;
    lua_setfield(L: State, idx: number, k: any): void;
    lua_getfield(L: State, idx: number, k: any): void;
    lua_rawseti(L: State, idx: number, n: number): void;
    lua_rawgeti(L: State, idx: number, n: number): void;
    lua_next(L: State, idx: number): number;

    lua_setglobal(L: State, name: any): void;
    lua_getglobal(L: State, name: any): void;

    lua_error(L: State): number;
    luaL_error(L: State, fmt: string, ...args: any[]): number;

    lua_close(L: State): void;
  };

  export const lauxlib: {
    luaL_newstate(): State;
    luaL_dostring(L: State, s: any): number;
    luaL_loadstring(L: State, s: any): number;
    luaL_checkstring(L: State, idx: number): any;
    luaL_checknumber(L: State, idx: number): number;
    luaL_checkinteger(L: State, idx: number): number;
    luaL_optstring(L: State, idx: number, def: string): any;
    luaL_optnumber(L: State, idx: number, def: number): number;
    luaL_optinteger(L: State, idx: number, def: number): number;
  };

  export const lualib: {
    luaL_openlibs(L: State): void;
  };
}

declare module "fengari-interop" {
  export function luaopen_js(L: any): number;
  export function push(L: any, value: any): void;
  export function tojs(L: any, idx: number): any;
}
