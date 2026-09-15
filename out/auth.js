"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.jwtExpiry = jwtExpiry;
exports.invalidateAuth = invalidateAuth;
exports.resetAutoReadBlock = resetAutoReadBlock;
exports.getAuth = getAuth;
exports.useTokenStore = useTokenStore;
exports.authHeaders = authHeaders;
const child_process_1 = require("child_process");
const util_1 = require("util");
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
/**
 * CodeBuddy 登录态读取（accessToken 模式）
 * ============================================================
 * 目标：从本机 CodeBuddy 登录态里拿到 `accessToken`（JWT），以 `Authorization: Bearer`
 * 调用 workbuddy.cn 接口，彻底摆脱 Cookie（短命 + 与服务端 UA 强绑定）。
 *
 * 为什么需要钥匙串：CodeBuddy 把会话加密存在 VS Code 的 SecretStorage 里
 * （macOS 上是 state.vscdb 的密文，`v10` 前缀），解密密钥只存在于系统钥匙串条目
 * （`Code Safe Storage` / `Code Key`）。任何非 VS Code 自身进程读取该条目
 * 都会触发一次系统授权 —— 这是 macOS 的安全模型，无法绕过。
 *
 * 因此这里把钥匙串访问压到最低频率：
 *  1. 先看「持久化缓存」（宿主注入的 TokenStore，通常是扩展自己的 SecretStorage，
 *     读写它不触发任何授权）：token 未过期且剩余有效期充足 → 直接用，完全不碰钥匙串；
 *  2. 缓存不可用或临近过期 → 读钥匙串解密一次，成功后写回持久化缓存（约 60 天一次）；
 *  3. 钥匙串读取失败（授权被拒 / 环境缺失）→ 本次会话不再重试，避免反复弹窗，
 *     交由「手动输入的 accessToken」兜底；都没有则提示用户输入。
 *
 * 注意：绝不主动调用 refreshToken —— 那会与 CodeBuddy 自身的刷新互相轮换，
 * 反而把 IDE 的登录态挤掉。token 由 CodeBuddy 负责刷新，我们只在需要时重读。
 */
/** CodeBuddy 会话在 SecretStorage 中的键名 */
const SECRET_KEY = "Tencent-Cloud.coding-copilot.new.accessToken";
/** Electron safeStorage 密文前缀 */
const ENC_PREFIX = "v10";
/** 内存缓存时长，避免同一轮刷新内重复读取 */
const CACHE_TTL_MS = 5 * 60 * 1000;
/** 持久化缓存的 token 剩余有效期低于该值时，才重新去读钥匙串（CodeBuddy 可能已刷新） */
const REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000;
/**
 * 目前仅 macOS 支持自动读取：Windows（DPAPI）与 Linux（libsecret/gnome-keyring）
 * 的 safeStorage 机制不同，待后续适配；这些平台直接走「手动 accessToken」。
 */
function hostCandidates() {
    if (process.platform !== "darwin")
        return [];
    const base = path.join(os.homedir(), "Library/Application Support");
    const rows = [
        ["Code", "Code Safe Storage", "Code Key"],
        ["Code - Insiders", "Code - Insiders Safe Storage", "Code - Insiders Key"],
        ["CodeBuddy", "CodeBuddy CN Safe Storage", "CodeBuddy CN Key"],
        ["CodeBuddy CN", "CodeBuddy CN Safe Storage", "CodeBuddy CN Key"],
        ["Trae", "Trae Safe Storage", "Trae Key"],
        ["Trae CN", "Trae CN Safe Storage", "Trae CN Key"],
        ["Cursor", "Cursor Safe Storage", "Cursor Key"],
        ["Kiro", "Kiro Safe Storage", "Kiro Key"],
        ["Qoder", "Qoder Safe Storage", "Qoder Key"],
    ];
    return rows.map(([app, svc, acct]) => ({
        label: app,
        dbPath: path.join(base, app, "User/globalStorage/state.vscdb"),
        keychainService: svc,
        keychainAccount: acct,
    }));
}
/**
 * 查询 sqlite 中的单个值。
 * 优先用 Node 内置 `node:sqlite`（Node 22.5+ / Electron 37+ 自带，无需外部命令，
 * 对 Windows 尤其重要），不可用时回退系统 `sqlite3` 命令（macOS / 多数 Linux 自带）。
 */
async function querySqliteValue(dbPath, sql) {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require("node:sqlite");
        const db = new mod.DatabaseSync(dbPath, { readOnly: true });
        try {
            const row = db.prepare(sql).get();
            return row?.value != null ? String(row.value) : "";
        }
        finally {
            db.close?.();
        }
    }
    catch {
        // 继续走外部命令回退
    }
    const { stdout } = await execFileAsync("sqlite3", [dbPath, sql], {
        maxBuffer: 64 * 1024 * 1024,
        timeout: 30000,
    });
    return String(stdout);
}
/** 从 state.vscdb 读取加密后的 secret（Buffer） */
async function readEncryptedSecret(dbPath) {
    if (!fs.existsSync(dbPath))
        return undefined;
    const sql = `select value from ItemTable where key like '%${SECRET_KEY}"}%'`;
    const raw = (await querySqliteValue(dbPath, sql)).trim();
    if (!raw)
        return undefined;
    try {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.data))
            return Buffer.from(parsed.data);
    }
    catch {
        /* 非常规数据，忽略 */
    }
    return undefined;
}
/** 从钥匙串取 safeStorage 密钥并派生 AES key；不可用/被拒时返回 undefined */
async function readSafeStorageKey(service, account) {
    try {
        const { stdout } = await execFileAsync("security", ["find-generic-password", "-s", service, "-a", account, "-w"], 
        // 首次会弹出系统授权框（可能要求输入开机密码），给足等待时间但不无限挂起
        { timeout: 180000 });
        const password = String(stdout).trim();
        if (!password)
            return undefined;
        // 实测：safeStorage 的 AES key = PBKDF2(钥匙串密码, "saltysalt", 1003, SHA1, 16)
        return crypto.pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
    }
    catch {
        // security 不存在 / 用户拒绝授权 / 钥匙串锁定，统一按「钥匙串不可用」处理
        return undefined;
    }
}
/** 解密 safeStorage 密文（v10 = AES-128-CBC，IV 取密文前 16 字节） */
function decryptV10(enc, key) {
    if (enc.length <= 3 + 16)
        return undefined;
    if (enc.subarray(0, 3).toString() !== ENC_PREFIX)
        return undefined;
    try {
        const iv = enc.subarray(3, 19);
        const ciphertext = enc.subarray(19);
        const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    }
    catch {
        return undefined;
    }
}
/**
 * 从解密后的会话明文里取 auth.accessToken。
 * 明文头部可能因分片存储被截断（JSON 不完整），故用正则而非 JSON.parse。
 */
function extractAccessToken(plain) {
    const m = plain.match(/"accessToken":"([^"]+)"/);
    return m?.[1];
}
/** 解析 JWT 的 exp（毫秒时间戳）；非 JWT 或解析失败返回 undefined */
function jwtExpiry(token) {
    const segment = token.split(".")[1];
    if (!segment)
        return undefined;
    try {
        const json = JSON.parse(Buffer.from(segment.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
        return typeof json?.exp === "number" ? json.exp * 1000 : undefined;
    }
    catch {
        return undefined;
    }
}
/** 自动读取 CodeBuddy 登录态里的 accessToken */
async function readAutoToken() {
    const hosts = hostCandidates();
    if (hosts.length === 0) {
        return { note: "auto-read unsupported on this platform" };
    }
    let sawDb = false;
    let sawEncrypted = false;
    for (const host of hosts) {
        try {
            const enc = await readEncryptedSecret(host.dbPath);
            if (!enc)
                continue;
            sawDb = true;
            const key = await readSafeStorageKey(host.keychainService, host.keychainAccount);
            if (!key)
                return { note: "keychain access denied", denied: true };
            const plain = decryptV10(enc, key);
            if (!plain)
                continue;
            sawEncrypted = true;
            const token = extractAccessToken(plain);
            if (token)
                return { token };
        }
        catch (e) {
            const msg = String(e?.message ?? e);
            // security 命令被拒绝 / 超时：视为授权失败，不再重试其它宿主（避免连环弹窗）
            if (/denied|User interaction is not allowed|canceled|cancelled|-128/i.test(msg)) {
                return { note: "keychain access denied", denied: true };
            }
            // 其它错误（例如 Windows 无 sqlite3）继续尝试下一个宿主
        }
    }
    if (!sawDb)
        return { note: "no CodeBuddy session found" };
    if (!sawEncrypted)
        return { note: "failed to decrypt CodeBuddy session" };
    return { note: "failed to read CodeBuddy session" };
}
let cache;
let cacheAt = 0;
let storeRef;
/** 自动读取失败后置位：本次会话不再尝试钥匙串，避免反复弹授权窗 */
let autoReadBlocked = false;
let lastAutoNote;
/**
 * 清空鉴权缓存。
 * @param allowKeychainRetry 是否允许下次再尝试读取钥匙串（默认否：失败过就不再打扰用户）
 */
function invalidateAuth(allowKeychainRetry = false) {
    cache = undefined;
    cacheAt = 0;
    if (allowKeychainRetry)
        autoReadBlocked = false;
    // 丢弃持久化缓存，强制重新判断（401 时旧 token 已不可信）
    if (storeRef)
        void storeRef.set(undefined).catch(() => undefined);
}
/** 用户手动输入 token 后调用：解除钥匙串封锁，允许下次重新尝试自动读取 */
function resetAutoReadBlock() {
    autoReadBlocked = false;
    lastAutoNote = undefined;
}
/**
 * 获取当前生效的鉴权状态（带内存缓存）。
 * 优先级：持久化缓存（未临近过期）→ 钥匙串自动读取 → 手动输入 token。
 */
async function getAuth(cfg) {
    const now = Date.now();
    if (cache && now - cacheAt < CACHE_TTL_MS)
        return cache;
    const manualToken = (cfg.manualToken ?? "").trim();
    // 1. 持久化缓存：未临近过期就直接用，完全不需要访问钥匙串
    if (storeRef) {
        const cached = await storeRef.get().catch(() => undefined);
        if (cached?.token) {
            const expiresAt = cached.expiresAt ?? jwtExpiry(cached.token);
            if (expiresAt == null || expiresAt > now + REFRESH_MARGIN_MS) {
                cache = { mode: "token-auto", token: cached.token, expiresAt };
                cacheAt = now;
                return cache;
            }
        }
    }
    // 2. 钥匙串自动读取（失败过一次后本会话跳过）
    if (!autoReadBlocked) {
        const auto = await readAutoToken();
        if (auto.token) {
            const expiresAt = jwtExpiry(auto.token);
            if (expiresAt == null || expiresAt > now) {
                if (storeRef) {
                    await storeRef.set({ token: auto.token, expiresAt }).catch(() => undefined);
                }
                cache = { mode: "token-auto", token: auto.token, expiresAt };
                cacheAt = now;
                return cache;
            }
            lastAutoNote = "auto token expired";
        }
        else {
            lastAutoNote = auto.note;
        }
        if (!auto.token)
            autoReadBlocked = true;
    }
    // 3. 手动输入的 token
    if (manualToken) {
        const expiresAt = jwtExpiry(manualToken);
        if (expiresAt == null || expiresAt > now) {
            cache = { mode: "token-manual", token: manualToken, expiresAt, note: lastAutoNote };
            cacheAt = now;
            return cache;
        }
        lastAutoNote = "manual token expired";
    }
    cache = { mode: "none", note: lastAutoNote };
    cacheAt = now;
    return cache;
}
/** 注册持久化缓存实现（在 activate 时注入扩展的 SecretStorage） */
function useTokenStore(store) {
    storeRef = store;
}
/** 由鉴权状态生成请求头 */
function authHeaders(auth) {
    return auth.token ? { authorization: `Bearer ${auth.token}` } : {};
}
