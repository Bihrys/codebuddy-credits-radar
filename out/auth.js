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
exports.getAuth = getAuth;
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
 * 背景：
 *  - 原来用 Cookie 鉴权，服务端把 session 与 User-Agent 强绑定，cookie 寿命短、极易失效；
 *  - CodeBuddy 扩展把登录会话加密存在 VS Code 的 SecretStorage 中
 *    （macOS：state.vscdb 的 ItemTable，值为 Electron safeStorage 加密后的 Buffer）；
 *  - 实测 `auth.accessToken`（JWT）可直接以 `Authorization: Bearer` 调用
 *    workbuddy.cn 的全部接口（用量 / 签到 / 喵喵），不再需要 Cookie 与 UA。
 *
 * 本模块只负责「拿到可用的凭据」，优先级：
 *  1. 自动读取 CodeBuddy 登录态（它自己会刷新 accessToken，我们每次读到的都是最新值）；
 *  2. 用户手动配置的 accessToken；
 *  3. Cookie 兜底（兼容老配置）。
 *
 * 注意：绝不主动调用 refreshToken —— 那会与 CodeBuddy 自身的刷新互相轮换，
 * 反而把 IDE 的登录态挤掉。登录过期由 CodeBuddy 负责，我们只管重读。
 */
/** CodeBuddy 会话在 SecretStorage 中的键名 */
const SECRET_KEY = "Tencent-Cloud.coding-copilot.new.accessToken";
/** 读取结果的缓存时长：期间不重复访问钥匙串 / 数据库 */
const CACHE_TTL_MS = 5 * 60 * 1000;
/** Electron safeStorage 的密文前缀 */
const ENC_PREFIX = "v10";
/**
 * 各宿主（VS Code 及其衍生 IDE）的 state.vscdb 路径与钥匙串条目。
 * 目前仅 macOS 支持自动读取；Windows / Linux 的 safeStorage 机制不同（DPAPI / libsecret），
 * 暂回落到手动 accessToken。
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
/** 从 state.vscdb 读取加密后的 secret（Buffer） */
async function readEncryptedSecret(dbPath) {
    if (!fs.existsSync(dbPath))
        return undefined;
    const sql = `select value from ItemTable where key like '%${SECRET_KEY}"}%'`;
    const { stdout } = await execFileAsync("sqlite3", [dbPath, sql], {
        maxBuffer: 64 * 1024 * 1024,
    });
    const raw = String(stdout).trim();
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
/** 从钥匙串取 safeStorage 密钥并派生 AES key */
async function readSafeStorageKey(service, account) {
    const { stdout } = await execFileAsync("security", [
        "find-generic-password",
        "-s",
        service,
        "-a",
        account,
        "-w",
    ]);
    const password = String(stdout).trim();
    if (!password)
        return undefined;
    // 实测：safeStorage 的 AES key = PBKDF2(钥匙串密码, "saltysalt", 1003, SHA1, 16)
    return crypto.pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
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
    let sawKey = false;
    for (const host of hosts) {
        try {
            const enc = await readEncryptedSecret(host.dbPath);
            if (!enc)
                continue;
            sawDb = true;
            const key = await readSafeStorageKey(host.keychainService, host.keychainAccount);
            if (!key)
                continue;
            sawKey = true;
            const plain = decryptV10(enc, key);
            if (!plain)
                continue;
            const token = extractAccessToken(plain);
            if (token)
                return { token };
        }
        catch {
            // 单个宿主失败不影响其它候选（例如该 IDE 未安装 / 钥匙串未授权）
        }
    }
    if (!sawDb)
        return { note: "no CodeBuddy session found" };
    if (!sawKey)
        return { note: "keychain access denied" };
    return { note: "failed to decrypt CodeBuddy session" };
}
let cache;
let cacheAt = 0;
/** 清空缓存：401 后调用，强制重读（CodeBuddy 可能刚好刷新了 token） */
function invalidateAuth() {
    cache = undefined;
    cacheAt = 0;
}
/**
 * 获取当前生效的鉴权状态（带缓存）。
 * 优先级：自动读取（未过期）→ 手动 accessToken（未过期）→ Cookie。
 */
async function getAuth(cfg) {
    const now = Date.now();
    if (cache && now - cacheAt < CACHE_TTL_MS)
        return cache;
    const manualToken = (cfg.manualToken ?? "").trim();
    const cookie = (cfg.cookie ?? "").trim();
    const userAgent = cfg.userAgent ?? "";
    const auto = await readAutoToken();
    if (auto.token) {
        const expiresAt = jwtExpiry(auto.token);
        if (expiresAt == null || expiresAt > now) {
            cache = { mode: "token-auto", token: auto.token, expiresAt, cookie, userAgent };
            cacheAt = now;
            return cache;
        }
        // 读到的 token 已过期（CodeBuddy 可能未登录 / 长期未打开），继续往下兜底
        auto.note = "auto token expired";
    }
    if (manualToken) {
        const expiresAt = jwtExpiry(manualToken);
        if (expiresAt == null || expiresAt > now) {
            cache = {
                mode: "token-manual",
                token: manualToken,
                expiresAt,
                cookie,
                userAgent,
                note: auto.note,
            };
            cacheAt = now;
            return cache;
        }
    }
    if (cookie) {
        cache = { mode: "cookie", cookie, userAgent, note: auto.note };
        cacheAt = now;
        return cache;
    }
    cache = { mode: "none", cookie, userAgent, note: auto.note };
    cacheAt = now;
    return cache;
}
/** 由鉴权状态生成请求头（token 模式给 Bearer，cookie 模式给 cookie） */
function authHeaders(auth) {
    if (auth.token)
        return { authorization: `Bearer ${auth.token}` };
    if (auth.mode === "cookie")
        return { cookie: auth.cookie ?? "" };
    return {};
}
