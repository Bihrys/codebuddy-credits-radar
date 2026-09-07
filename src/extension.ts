import * as vscode from "vscode";

/**
 * 本地化入口：语言自动跟随 VS Code 显示语言（vscode.env.language）。
 * 代码内文案统一写英文（即默认语言），简体中文译文见 l10n/bundle.l10n.zh-cn.json；
 * 未命中译文时 l10n 会自动回落为传入的英文原文。
 */
function t(
  message: string,
  ...args: Array<string | number | boolean | undefined | null>
): string {
  return vscode.l10n.t(message, ...args.map((a) => a ?? ""));
}

interface Account {
  PackageName: string;
  CapacityRemainPrecise: string;
  CapacityUsedPrecise: string;
  CapacitySizePrecise: string;
  CycleCapacityRemainPrecise?: string;
  CycleCapacitySizePrecise?: string;
  CycleEndTime: string;
  Status: number;
}

interface UsageResult {
  remain: number;
  total: number;
  accounts: Account[];
}

/** 签到状态：今日是否已签到 */
type CheckinState = "claimed" | "unclaimed" | "unknown";

interface CheckinResult {
  state: CheckinState;
  /** 签到获得的积分数（state=claimed 且有数据时） */
  credit?: number;
  /** 本次刷新新签到成功（true）；早已签到（false/undefined 不弹提示） */
  freshlyClaimed?: boolean;
  /** 失败原因（state=unknown） */
  error?: string;
}

// ============================================================
// 喵喵（派喵喵赚积分）状态模型
// ============================================================
interface BuddyStatus {
  state?: string; // "traveling" | "idle" | ...
  departAt?: number; // 秒级时间戳
  arriveAt?: number; // 秒级时间戳
  serverNow?: number; // 秒级时间戳
  durationHours?: number;
  rewardCredit?: number;
  dailyLimitReached?: boolean;
  locationName?: string;
}

interface BuddyState {
  status?: BuddyStatus;
  claim?: { credit: number } | { error: string };
  depart?: { hours: number } | { error: string };
  /** 本次刷新刚领取到积分（true 才弹提示；无可领/早已领过则静默） */
  freshlyClaimed?: boolean;
  /** 本次刷新刚派出喵喵（true 才弹提示） */
  freshlyDeparted?: boolean;
}

let statusBarItem: vscode.StatusBarItem;
let timer: NodeJS.Timeout | undefined;
let lastResult: UsageResult | undefined;
let lastUpdatedAt: Date | undefined;
let lastCheckin: CheckinResult | undefined;
let lastBuddy: BuddyState | undefined;
let lastBuddyAutoDate = ""; // 本地日期字符串，用于「一日一次」自动触发守卫
let lastBuddyClaimDate = ""; // 本地日期字符串，用于「一日一次」自动领积分守卫（与出发守卫解耦）
/** 防止并发 update 互相覆盖导致状态栏反复闪动/丢失 */
let updating = false;

const DEFAULT_PACKAGE_CODES = [
  "TCACA_code_008_cfWoLwvjU4",
  "TCACA_code_009_0XmEQc2xOf",
  "TCACA_code_038_OhvqZtiPKr",
  "TCACA_code_007_nzdH5h4Nl0",
  "TCACA_code_028_NtpWi0jzXs",
  "TCACA_code_029_6wCGEWquYy",
  "TCACA_code_030_BjSt89qTvr",
];

/**
 * 会话与 UA 强绑定：服务端签发 session 时会记录完整的 User-Agent，
 * 后续请求 UA 与之不一致即返回 401（实测改动其中任意一个字符都会被拒，
 * 且不同 Chrome 版本之间不互通，并非版本高低问题）。
 * 因此 UA 必须可配置，且与 Cookie 取自同一个浏览器请求。
 */
const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

/** 取生效 UA：用户配置优先，留空则回落内置默认值 */
function getUA(): string {
  return getConfig().get<string>("userAgent", "").trim() || DEFAULT_UA;
}

function getConfig() {
  return vscode.workspace.getConfiguration("codebuddyUsage");
}

/**
 * 状态栏图标：统一使用 codicon（$(icon) 语法）。
 * 所有基于 VS Code 内核的宿主（VS Code / Trae / CodeBuddy IDE 等）
 * 的状态栏均按同一套逻辑渲染 `$(icon)`，因此不再按 appName 区分，
 * 保证各宿主显示一致。
 *
 * 注意：状态栏文本里 `$(icon)` 会渲染；hover Markdown 不识别该语法，
 * 需直接用 Unicode/emoji。
 */
function icon(codicon: string): string {
  return `$(${codicon})`;
}

// ============================================================
// 1. 用量拉取
// ============================================================
async function fetchUsage(): Promise<UsageResult> {
  const cfg = getConfig();
  const cookie = cfg.get<string>("cookie", "").trim();
  const apiBase = cfg.get<string>("apiBase", "https://www.workbuddy.cn").replace(/\/$/, "");

  if (!cookie) {
    throw new Error("NO_COOKIE");
  }

  const body = {
    PageNumber: 1,
    PageSize: 200,
    ProductCode: "p_tcaca",
    Status: [0, 3],
    OnlyValidPeriod: true,
    PackageCodes: DEFAULT_PACKAGE_CODES,
    NeedInUsage: true,
  };

  const resp = await fetch(`${apiBase}/billing/meter/get-user-resource`, {
    method: "POST",
    headers: {
      accept: "application/json, text/plain, */*",
      "content-type": "application/json",
      cookie: cookie,
      origin: apiBase,
      referer: `${apiBase}/profile/plans-usage`,
      "x-client-platform": "web",
      "user-agent": getUA(),
    },
    body: JSON.stringify(body),
  });

  if (resp.status === 401 || resp.status === 403) {
    throw new Error("COOKIE_EXPIRED");
  }
  if (!resp.ok) {
    throw new Error(`HTTP_${resp.status}`);
  }

  const json: any = await resp.json();
  const accounts: Account[] = json?.data?.Response?.Data?.Accounts ?? [];

  let remain = 0;
  let total = 0;
  for (const a of accounts) {
    // 优先用本周期 (CycleCapacity*) 字段：本周期内当下能用的积分。
    // - 一次性发放的包（裂变包）：Cycle 与 Capacity 相等，结果不变
    // - 周期制包（个人体验版每月赠送）：本周期用完即 0，下周期才补上
    //   避免把下月还没到期的"未来额度"算进"当前剩余"，导致体验版用完后仍显示余量
    const cycleRemain = a.CycleCapacityRemainPrecise;
    const cycleSize = a.CycleCapacitySizePrecise;
    let accRemain: number;
    let accSize: number;
    if (cycleRemain != null && cycleSize != null) {
      accRemain = parseFloat(cycleRemain) || 0;
      accSize = parseFloat(cycleSize) || 0;
    } else {
      accRemain = parseFloat(a.CapacityRemainPrecise ?? "0") || 0;
      accSize = parseFloat(a.CapacitySizePrecise ?? "0") || 0;
    }
    remain += accRemain;
    // 总量只统计"还有余量"的套餐：已耗尽的套餐不再计入分母，
    // 否则会把用光的包当成仍可用的额度，导致剩余百分比被拉低、显示偏乐观
    if (accRemain > 0) {
      total += accSize;
    }
  }

  return { remain, total, accounts };
}

// ============================================================
// 2. 签到（与用量查询共用 Cookie 鉴权，不再读取本地桌面端登录态）
// ============================================================

/** 拼装签到接口请求头（与 fetchUsage 共用同一 Cookie） */
function checkinRequestHeaders(): Record<string, string> {
  const cfg = getConfig();
  const cookie = cfg.get<string>("cookie", "").trim();
  const apiBase = cfg.get<string>("apiBase", "https://www.workbuddy.cn").replace(/\/$/, "");
  return {
    "content-type": "application/json",
    accept: "application/json",
    cookie,
    origin: apiBase,
    referer: `${apiBase}/profile/plans-usage`,
    "x-client-platform": "web",
    "user-agent": getUA(),
  };
}

/** 读取错误响应体，便于定位 400 等原因（截断避免过长） */
async function readErrorBody(resp: Response): Promise<string> {
  try {
    const t = await resp.text();
    return t.length > 300 ? t.slice(0, 300) + "…" : t;
  } catch {
    return "";
  }
}

/** 查询签到状态 */
async function fetchCheckinStatus(): Promise<CheckinResult> {
  const cfg = getConfig();
  const apiBase = cfg.get<string>("apiBase", "https://www.workbuddy.cn").replace(/\/$/, "");
  try {
    const resp = await fetch(`${apiBase}/billing/meter/checkin-status`, {
      method: "POST",
      headers: checkinRequestHeaders(),
      body: "{}",
    });
    // Cookie 失效：抛出让 update() 统一提示用户重新配置
    if (resp.status === 401 || resp.status === 403) {
      throw new Error("COOKIE_EXPIRED");
    }
    let json: any = null;
    try {
      json = await resp.json();
    } catch {
      // 响应体非 JSON（极少数情况），交给下方状态码分支处理
    }
    // 网关对「今日已签到」返回 HTTP 400 + code=10001（幂等），视为已签到
    if (json?.code === 10001) {
      return { state: "claimed" };
    }
    if (!resp.ok) {
      const body = json ? JSON.stringify(json) : await readErrorBody(resp);
      return { state: "unknown", error: `HTTP_${resp.status}${body ? " " + body : ""}` };
    }
    const checked = json?.data?.today_checked_in;
    if (checked === true) {
      return { state: "claimed" };
    }
    return { state: "unclaimed" };
  } catch (e: any) {
    if (e?.message === "COOKIE_EXPIRED") throw e;
    return { state: "unknown", error: e?.message ?? String(e) };
  }
}

/** 执行签到领取 */
async function doCheckin(): Promise<CheckinResult> {
  const cfg = getConfig();
  const apiBase = cfg.get<string>("apiBase", "https://www.workbuddy.cn").replace(/\/$/, "");
  try {
    const resp = await fetch(`${apiBase}/billing/meter/daily-checkin`, {
      method: "POST",
      headers: checkinRequestHeaders(),
      body: "{}",
    });
    // Cookie 失效：抛出让 update() 统一提示用户重新配置
    if (resp.status === 401 || resp.status === 403) {
      throw new Error("COOKIE_EXPIRED");
    }
    let json: any = null;
    try {
      json = await resp.json();
    } catch {
      // 响应体非 JSON，交给下方状态码分支处理
    }
    // 网关对「今日已签到」返回 HTTP 400 + code=10001（幂等），视为已签到
    if (json?.code === 10001) {
      return { state: "claimed" };
    }
    if (!resp.ok) {
      const body = json ? JSON.stringify(json) : await readErrorBody(resp);
      return { state: "unknown", error: `HTTP_${resp.status}${body ? " " + body : ""}` };
    }
    const code = json?.code;
    if (code === 0) {
      // 本次新签到成功：弹提示
      return { state: "claimed", credit: json?.data?.credit, freshlyClaimed: true };
    }
    if (code === 10001) {
      // 当日已签到：接口幂等拒绝，视为已签到（早已签到，不弹提示）
      return { state: "claimed" };
    }
    // 未知 code：再查一次状态兜底
    const st = await fetchCheckinStatus();
    if (st.state === "claimed") return st;
    return { state: "unknown", error: `code=${code} msg=${json?.msg ?? ""}` };
  } catch (e: any) {
    if (e?.message === "COOKIE_EXPIRED") throw e;
    return { state: "unknown", error: e?.message ?? String(e) };
  }
}

/**
 * 获取今日签到状态；若尚未签到则自动领取。
 * 与用量查询共用 Cookie 鉴权；Cookie 缺失/失效时返回 unknown（不影响主流程）。
 */
async function ensureCheckin(): Promise<CheckinResult> {
  const cookie = getConfig().get<string>("cookie", "").trim();
  if (!cookie) {
    return { state: "unknown", error: t("No Cookie set") };
  }
  const status = await fetchCheckinStatus();
  if (status.state === "claimed") {
    return status;
  }
  if (status.state === "unclaimed") {
    return await doCheckin();
  }
  return status;
}

// ============================================================
// 3. 喵喵旅行（派喵喵出任务赚积分）
// ============================================================
const BUDDY_PATH = "/activity/growth/buddy/travel";

/** 拼装喵喵接口请求头（与 fetchUsage 共用同一 Cookie） */
function buddyRequestHeaders(): Record<string, string> {
  const cfg = getConfig();
  const cookie = cfg.get<string>("cookie", "").trim();
  const apiBase = cfg.get<string>("apiBase", "https://www.workbuddy.cn").replace(/\/$/, "");
  return {
    "content-type": "application/json",
    accept: "application/json, text/plain, */*",
    cookie,
    origin: apiBase,
    referer: `${apiBase}/profile/growth-center`,
    "x-client-platform": "web",
    "user-agent": getUA(),
  };
}

/** 调用喵喵接口，统一抛出 Cookie 失效错误 */
async function callBuddyApi(sub: string, method: string, body?: string): Promise<any> {
  const cfg = getConfig();
  const cookie = cfg.get<string>("cookie", "").trim();
  if (!cookie) throw new Error("NO_COOKIE");
  const apiBase = cfg.get<string>("apiBase", "https://www.workbuddy.cn").replace(/\/$/, "");
  const init: RequestInit = { method, headers: buddyRequestHeaders() };
  if (body !== undefined) init.body = body;
  const resp = await fetch(`${apiBase}${BUDDY_PATH}/${sub}`, init);
  if (resp.status === 401 || resp.status === 403) throw new Error("COOKIE_EXPIRED");
  const json: any = await resp.json().catch(() => ({}));
  return json;
}

/** 查询喵喵状态 */
async function fetchBuddyStatus(): Promise<BuddyStatus | null> {
  try {
    const json = await callBuddyApi("status", "GET");
    if (json?.code !== 0) return null;
    const d = json?.data ?? {};
    return {
      state: d.state,
      departAt: d.depart_at,
      arriveAt: d.arrive_at,
      serverNow: d.server_now,
      durationHours: d.duration_hours,
      rewardCredit: d.reward_credit,
      dailyLimitReached: d.daily_limit_reached,
      locationName: d.location?.name,
    };
  } catch (e: any) {
    if (e?.message === "COOKIE_EXPIRED" || e?.message === "NO_COOKIE") return null;
    return null;
  }
}

/** 领取喵喵挣的积分 */
async function claimBuddy(): Promise<{ credit?: number; error?: string }> {
  try {
    const json = await callBuddyApi("claim", "POST", "{}");
    if (json?.code === 0) return { credit: json?.data?.credit ?? 0 };
    const msg = json?.msg ?? `HTTP_${json?.code ?? ""}`;
    // 服务端返回 no unclaimed travel 表示「当前没有可领取的旅行积分」，
    // 属于正常状态（如积分已被之前的流程领取过），不算失败
    if (/no unclaimed/i.test(msg)) return { credit: 0 };
    return { error: msg };
  } catch (e: any) {
    if (e?.message === "COOKIE_EXPIRED" || e?.message === "NO_COOKIE") throw e;
    return { error: e?.message ?? String(e) };
  }
}

/** 派出喵喵出任务；location_id 默认 1 */
async function departBuddy(locationId = 1): Promise<{ hours?: number; error?: string }> {
  try {
    const json = await callBuddyApi("depart", "POST", JSON.stringify({ location_id: locationId }));
    if (json?.code === 0) return { hours: json?.data?.duration_hours ?? json?.data?.duration ?? 0 };
    return { error: json?.msg ?? `HTTP_${json?.code ?? ""}` };
  } catch (e: any) {
    if (e?.message === "COOKIE_EXPIRED" || e?.message === "NO_COOKIE") throw e;
    return { error: e?.message ?? String(e) };
  }
}

/** 本地日期字符串（用于一日一次守卫） */
function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 自动喵喵：当喵喵处于「可出发」状态且今日尚未自动触发过时，
 * 先领取积分再派出喵喵；一日仅自动触发一次（state 变为 traveling 后自然不再触发，
 * 并辅以本地日期守卫防止同日往返后重复出发）。
 */
async function ensureBuddy(): Promise<BuddyState | undefined> {
  const buddyTravel = getConfig().get<boolean>("buddyTravel", false);
  if (!buddyTravel) return undefined;
  const status = await fetchBuddyStatus();
  if (!status) return undefined;
  const buddy: BuddyState = { status };
  const backFromTravel = status.state != null && status.state !== "traveling";
  // 修复：领积分与「出发」解耦。旅行结束后喵喵处于「已到达」状态，
  // 此时即使当日已达上限（dailyLimitReached=true，无法再出发），
  // 也必须尝试领取本次旅行挣到的积分，否则积分会一直滞留在服务端。
  if (backFromTravel && lastBuddyClaimDate !== todayStr()) {
    const c = await claimBuddy().catch((e) => ({ error: e?.message ?? String(e) }));
    if ((c as any).credit != null) {
      buddy.claim = { credit: (c as any).credit };
      // 只有真正到账才标记提示；credit=0（当前无可领取的旅行）保持静默
      if ((c as any).credit > 0) buddy.freshlyClaimed = true;
    } else if ((c as any).error) {
      buddy.claim = { error: (c as any).error };
    }
    lastBuddyClaimDate = todayStr();
  }
  const canDepart = backFromTravel && !status.dailyLimitReached;
  if (canDepart && lastBuddyAutoDate !== todayStr()) {
    const d = await departBuddy().catch((e) => ({ error: e?.message ?? String(e) }));
    if ((d as any).hours != null) {
      buddy.depart = { hours: (d as any).hours };
      buddy.freshlyDeparted = true;
    } else if ((d as any).error) {
      buddy.depart = { error: (d as any).error };
    }
    const st2 = await fetchBuddyStatus();
    if (st2) buddy.status = st2;
    lastBuddyAutoDate = todayStr();
  }
  return buddy;
}

// ============================================================
// 工具函数
// ============================================================
function formatNumber(n: number): string {
  return parseFloat(n.toFixed(2)).toString();
}

function formatDateTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/** 解析到期时间字符串为时间戳；缺失或无法解析返回 Infinity（排序时置于最后） */
function parseExpiry(s?: string): number {
  if (!s) return Number.POSITIVE_INFINITY;
  const normalized = s.includes("T") ? s : s.replace(" ", "T");
  const t = Date.parse(normalized);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

// ============================================================
// 状态栏渲染（纯数字样式）
// ============================================================
function renderResult(res: UsageResult, updatedAt?: Date) {
  statusBarItem.text = `${icon("zap")} ${formatNumber(res.remain)}`;
  statusBarItem.tooltip = buildTooltip(res, updatedAt);
  statusBarItem.backgroundColor = undefined;
  statusBarItem.show();
}

/**
 * 喵喵旅行结果提示，与签到保持同一策略：
 * 本次真正操作成功（领到积分 / 派出成功）才弹信息提示；
 * 无可领取、今日已完成、已在旅行中均静默，避免每 30 分钟自动刷新反复打扰。
 * 仅操作失败时弹警告（受「一日一次」守卫限制，一天最多一次）。
 */
function notifyBuddyResult(buddy?: BuddyState) {
  if (!buddy) return;
  const claim: any = buddy.claim;
  const depart: any = buddy.depart;
  const parts: string[] = [];

  if (buddy.freshlyClaimed && claim?.credit != null) {
    parts.push(t("Claimed {0} credits", claim.credit));
  } else if (claim?.error) {
    vscode.window.showWarningMessage(
      t("CodeBuddy Usage: Failed to claim buddy credits ({0})", claim.error)
    );
  }

  if (buddy.freshlyDeparted && depart?.hours != null) {
    parts.push(t("Buddy departed, travel time {0} hours", depart.hours));
  } else if (depart?.error) {
    vscode.window.showWarningMessage(
      t("CodeBuddy Usage: Buddy failed to depart ({0})", depart.error)
    );
  }

  if (parts.length > 0) {
    vscode.window.showInformationMessage(
      t("CodeBuddy Usage: Buddy travel — {0}", parts.join(", "))
    );
  }
}

async function update() {
  if (!statusBarItem) return;

  // 已有刷新在途时直接复用结果，避免并发请求互相覆盖状态栏
  if (updating) return;

  updating = true;
  // 立即给出刷新反馈，避免点击后“无变化”的错觉
  statusBarItem.text = `${icon("sync~spin")} ${t("Refreshing…")}`;
  statusBarItem.tooltip = t("Fetching CodeBuddy usage…");
  statusBarItem.backgroundColor = undefined;
  statusBarItem.show();

  try {
    const autoCheckin = getConfig().get<boolean>("autoCheckin", true);
    // 先签到 + 派喵喵领取积分，再拉取用量。
    // 否则用量接口会在积分到账前就返回，导致余量/总量不含本次领取的积分。
    // 签到与喵喵相互独立，可并行；用量查询必须等两者完成后再执行。
    const [checkin, buddy] = await Promise.all([
      autoCheckin ? ensureCheckin() : Promise.resolve(undefined),
      ensureBuddy(),
    ]);
    lastCheckin = checkin;
    // 喵喵旅行：仅当开启时拉取/触发，关闭时返回 undefined（悬浮框不展示喵喵状态）
    lastBuddy = buddy;
    // 用量查询放在签到 + 喵喵领取之后，确保总量/余量已包含本次到账积分
    const res = await fetchUsage();
    lastResult = res;
    lastUpdatedAt = new Date();
    renderResult(res, lastUpdatedAt);
    // 恢复正常后点击行为重置为刷新
    statusBarItem.command = "codebuddyUsage.refresh";

    // 仅首次领取成功 / 领取失败才提示；早已签到则静默（避免每次点击都弹）
    if (autoCheckin && checkin?.freshlyClaimed) {
      vscode.window.showInformationMessage(
        checkin.credit
          ? t("CodeBuddy Usage: Daily check-in done (+{0})", checkin.credit)
          : t("CodeBuddy Usage: Daily check-in done")
      );
    } else if (autoCheckin && checkin?.state === "unclaimed") {
      vscode.window.showWarningMessage(
        t("CodeBuddy Usage: Daily check-in failed, will retry later")
      );
    }

    // 喵喵旅行：与签到一致，仅在本次真正领到积分/派出成功时提示
    notifyBuddyResult(buddy);
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (msg === "NO_COOKIE") {
      statusBarItem.text = `${icon("key")} ${t("No Cookie set")}`;
      statusBarItem.tooltip = t("Click to set login Cookie");
      statusBarItem.command = "codebuddyUsage.setCookie";
      statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
      statusBarItem.show();
    } else if (msg === "COOKIE_EXPIRED") {
      statusBarItem.text = `${icon("error")} ${t("Cookie expired")}`;
      statusBarItem.tooltip = t("Click to re-set login Cookie");
      statusBarItem.command = "codebuddyUsage.setCookie";
      statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
      statusBarItem.show();
    } else {
      statusBarItem.text = `${icon("warning")} ${t("Fetch failed")}`;
      statusBarItem.tooltip = t("Error: {0}\nClick to retry", msg);
      statusBarItem.command = "codebuddyUsage.refresh";
      statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
      statusBarItem.show();
    }
  } finally {
    updating = false;
  }
}

function checkinTag(): string {
  // 配置关闭时不展示签到标签
  if (!getConfig().get<boolean>("autoCheckin", true)) return "";
  // Hover Markdown 不支持 $(icon) 语法，直接用 Unicode 符号表达签到状态
  if (!lastCheckin) return t("`❔ Unknown`");
  if (lastCheckin.state === "claimed") return t("`✓ Checked in`");
  if (lastCheckin.state === "unclaimed") return t("`○ Not checked in`");
  return lastCheckin.error
    ? t("`⚠ Error ({0})`", lastCheckin.error)
    : t("`⚠ Error`");
}

/** 悬浮框中「喵喵」状态标签：旅行倒计时 / 领积分 / 去旅行（可点击） */
function buddyTag(): string {
  if (!getConfig().get<boolean>("buddyTravel", false)) return "";
  const b = lastBuddy;
  if (!b || !b.status) return t("✿ `Unknown`");

  if (b.status.state === "traveling") {
    // 静态倒计时：基于接口返回的 serverNow 与 arriveAt 计算，悬浮框展示时显示一次即可，不自动刷新
    const nowSec = b.status.serverNow ?? Math.floor(Date.now() / 1000);
    const remain = Math.max(0, (b.status.arriveAt ?? 0) - nowSec);
    const hh = Math.floor(remain / 3600);
    const mm = Math.floor((remain % 3600) / 60);
    const ss = remain % 60;
    const pad = (n: number) => String(n).padStart(2, "0");
    return t("✿ Travel countdown {0}:{1}:{2}", pad(hh), pad(mm), pad(ss));
  }

  // 今日喵喵任务已完成（达到每日领取/出发上限）：
  // 若本次刷新有领取结果则一并展示，避免「已到达但积分未领取」被误导为已完成
  if (b.status.dailyLimitReached) {
    const c: any = b.claim;
    if (c && c.credit != null) {
      return c.credit > 0
        ? t("✿ Done for today · {0} credits claimed", c.credit)
        : t("✿ Done for today · no credits to claim");
    }
    if (c && c.error) {
      return t("✿ Done for today · claim failed ({0})", c.error);
    }
    return t("✿ Done for today, come back tomorrow");
  }

  // 空闲/已到达：展示可点击的「领积分」「去旅行」，或操作结果
  const parts: string[] = [];
  if (b.claim && (b.claim as any).credit != null) {
    parts.push(
      (b.claim as any).credit > 0
        ? t("{0} credits claimed", (b.claim as any).credit)
        : t("No credits to claim")
    );
  } else {
    parts.push(
      t('[Claim](command:codebuddyUsage.buddyClaim "Claim credits earned by your buddy")')
    );
  }
  if (b.depart && (b.depart as any).hours != null) {
    parts.push(t("Travel time {0} hours", (b.depart as any).hours));
  } else {
    parts.push(
      t('[Depart](command:codebuddyUsage.buddyDepart "Send your buddy on a task to earn credits")')
    );
  }
  return `✿ ${parts.join(" · ")}`;
}

/** 仅用既有数据重建悬浮框（用于手动操作后的即时刷新，不重新拉取用量） */
function refreshTooltip() {
  if (lastResult) {
    statusBarItem.tooltip = buildTooltip(lastResult, lastUpdatedAt);
  }
}

function buildTooltip(res: UsageResult, updatedAt?: Date): vscode.MarkdownString {
  const totalRemain = formatNumber(res.remain);
  const totalSize = formatNumber(res.total);
  const pct = res.total > 0 ? (res.remain / res.total) * 100 : 0;

  // 过滤掉本周期余量为 0 的套餐（周期制体验版用完即隐藏），再按到期时间升序
  const visible = res.accounts
    .filter((a) => {
      const r = a.CycleCapacityRemainPrecise ?? a.CapacityRemainPrecise ?? "0";
      return (parseFloat(r) || 0) > 0;
    })
    .sort((a, b) => parseExpiry(a.CycleEndTime) - parseExpiry(b.CycleEndTime));

  const plansUrl = `${getConfig()
    .get<string>("apiBase", "https://www.workbuddy.cn")
    .replace(/\/$/, "")}/profile/plans-usage`;

  const lines: string[] = [];
  lines.push(t("### CodeBuddy Credits"));
  lines.push(``);
  lines.push(
    t(
      "Total: `{0}` remaining / [total {1}]({2}) ({3}%)",
      totalRemain,
      totalSize,
      plansUrl,
      pct.toFixed(1)
    )
  );
  if (visible.length > 5) {
    lines.push(``);
    lines.push(
      t("_{0} packages with remaining credits, showing the first 5_", visible.length)
    );
  }
  lines.push(``);
  lines.push(t("| Package | Remaining | Total | Expires |"));
  // 末列右对齐，使底部“最近更新”贴住表格右缘
  lines.push(`| --- | ---: | ---: | ---: |`);

  if (visible.length === 0) {
    lines.push(t("| _No packages with remaining credits_ |  |  |  |"));
  } else {
    for (const a of visible.slice(0, 5)) {
      const remain = formatNumber(
        parseFloat(a.CycleCapacityRemainPrecise ?? a.CapacityRemainPrecise ?? "0")
      );
      const size = formatNumber(
        parseFloat(a.CycleCapacitySizePrecise ?? a.CapacitySizePrecise ?? "0")
      );
      const name = (a.PackageName ?? "-").replace(/\|/g, "\\|");
      const exp = a.CycleEndTime ?? "-";
      lines.push(`| ${name} | ${remain} | ${size} | ${exp} |`);
    }
  }
  // 底部行并入同一张表：左列=签到标签 + 喵喵状态，末列=最近更新（右对齐贴右缘）
  const tag = checkinTag();
  const buddy = buddyTag();
  const left = [tag, buddy].filter(Boolean).join("  ");
  if (updatedAt) {
    lines.push(t("| {0} |  | Last updated | {1} |", left, formatDateTime(updatedAt)));
  } else if (left) {
    lines.push(`| ${left} |  |  |  |`);
  }

  const md = new vscode.MarkdownString(lines.join("\n"));
  md.isTrusted = true;
  md.supportHtml = false;
  return md;
}

function scheduleTimer() {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
  const cfg = getConfig();
  const mins = cfg.get<number>("refreshIntervalMinutes", 30);
  if (mins > 0) {
    timer = setInterval(() => update(), mins * 60 * 1000);
  }
}

/**
 * 凭证录入：顺序弹出两个输入框（Cookie → User-Agent）。
 *
 * 为什么是两个框而不是一个表单：
 *  VS Code 的 showInputBox 一次只收一个值，无法容纳两个字段；
 *  这里改为连续弹出两次，并在标题上标注 (1/2)(2/2) 提示当前进度。
 *
 * 取消语义：任一步按 Esc 都整体放弃，不写入任何值。
 *  因为 Cookie 与 UA 必须配对，只更新其中一个反而会立刻 401，
 *  半途写入比完全不写更糟。
 */
async function setCookie() {
  const cfg = getConfig();

  // (1/2) Cookie
  const cookie = await vscode.window.showInputBox({
    title: t("(1/2) Login credentials — Cookie"),
    prompt: t("Paste the Cookie copied from www.workbuddy.cn/profile/plans-usage"),
    placeHolder: "qcloud_from=...; session=...; session_2=...; i18next=zh-CN",
    value: cfg.get<string>("cookie", ""),
    ignoreFocusOut: true,
  });
  // Esc：整体放弃
  if (cookie === undefined) return;

  // (2/2) User-Agent
  const uaVer = DEFAULT_UA.match(/Chrome\/[\d.]+/)?.[0] ?? DEFAULT_UA;
  const userAgent = await vscode.window.showInputBox({
    title: t("(2/2) Login credentials — User-Agent"),
    prompt: t(
      "Must come from the same request as the Cookie, otherwise the server returns 401. Leave empty to use the built-in default ({0})",
      uaVer
    ),
    placeHolder: DEFAULT_UA,
    value: cfg.get<string>("userAgent", ""),
    ignoreFocusOut: true,
  });
  // Esc：整体放弃，避免 Cookie 已更新而 UA 仍是旧的，两者不匹配
  if (userAgent === undefined) {
    vscode.window.showInformationMessage(
      t("CodeBuddy Usage: Cancelled, neither Cookie nor User-Agent was saved")
    );
    return;
  }

  try {
    await cfg.update("cookie", cookie.trim(), vscode.ConfigurationTarget.Global);
    await cfg.update("userAgent", userAgent.trim(), vscode.ConfigurationTarget.Global);
  } catch (e: any) {
    vscode.window.showErrorMessage(
      t("CodeBuddy Usage: Failed to save credentials ({0})", e?.message ?? String(e))
    );
    return;
  }

  // 回显实际生效的 UA，便于确认是否真的存进去了
  const ver = getUA().match(/Chrome\/[\d.]+/)?.[0] ?? t("unknown version");
  const isDefault = !userAgent.trim();
  vscode.window.showInformationMessage(
    isDefault
      ? t(
          "CodeBuddy Usage: Credentials saved (local only), active UA: {0} (built-in default)",
          ver
        )
      : t("CodeBuddy Usage: Credentials saved (local only), active UA: {0}", ver)
  );

  // 配置变更会触发 onDidChangeConfiguration 中的 update()；
  // 此处再调一次覆盖「只改了 UA、cookie 未变」的情况，
  // update() 内部的 updating 守卫保证并发只生效一次。
  update();
}

/** 手动「领积分」：领取喵喵挣的积分（独立于自动流程，由悬浮框链接触发） */
async function buddyClaimCmd() {
  if (!getConfig().get<boolean>("buddyTravel", false)) return;
  if (!lastBuddy) lastBuddy = {};
  try {
    const c = await claimBuddy();
    if (c.error) {
      lastBuddy.claim = { error: c.error };
      vscode.window.showWarningMessage(
        t("CodeBuddy Usage: Failed to claim buddy credits ({0})", c.error)
      );
    } else {
      lastBuddy.claim = { credit: c.credit ?? 0 };
      if ((c.credit ?? 0) > 0) {
        vscode.window.showInformationMessage(
          t("CodeBuddy Usage: Buddy claimed {0} credits", c.credit)
        );
      } else {
        // 手动点击也要有反馈，否则点了「领积分」没有任何回应
        vscode.window.showInformationMessage(
          t("CodeBuddy Usage: Your buddy has no travel credits to claim right now")
        );
      }
    }
  } catch (e: any) {
    if (e?.message === "COOKIE_EXPIRED") {
      statusBarItem.text = `${icon("error")} ${t("Cookie expired")}`;
      statusBarItem.tooltip = t("Click to re-set login Cookie");
      statusBarItem.command = "codebuddyUsage.setCookie";
      statusBarItem.show();
      return;
    }
    lastBuddy.claim = { error: e?.message ?? String(e) };
    vscode.window.showWarningMessage(
      t("CodeBuddy Usage: Failed to claim buddy credits ({0})", e?.message ?? String(e))
    );
  }
  const st = await fetchBuddyStatus();
  if (st) lastBuddy.status = st;
  refreshTooltip();
}

/** 手动「去旅行」：派出喵喵出任务（独立于自动流程，由悬浮框链接触发） */
async function buddyDepartCmd() {
  if (!getConfig().get<boolean>("buddyTravel", false)) return;
  if (!lastBuddy) lastBuddy = {};
  try {
    const d = await departBuddy();
    if (d.error) {
      lastBuddy.depart = { error: d.error };
      vscode.window.showWarningMessage(
        t("CodeBuddy Usage: Buddy failed to depart ({0})", d.error)
      );
    } else {
      lastBuddy.depart = { hours: d.hours ?? 0 };
      vscode.window.showInformationMessage(
        t("CodeBuddy Usage: Buddy departed, travel time {0} hours", d.hours ?? 0)
      );
    }
  } catch (e: any) {
    if (e?.message === "COOKIE_EXPIRED") {
      statusBarItem.text = `${icon("error")} ${t("Cookie expired")}`;
      statusBarItem.tooltip = t("Click to re-set login Cookie");
      statusBarItem.command = "codebuddyUsage.setCookie";
      statusBarItem.show();
      return;
    }
    lastBuddy.depart = { error: e?.message ?? String(e) };
    vscode.window.showWarningMessage(
      t("CodeBuddy Usage: Buddy failed to depart ({0})", e?.message ?? String(e))
    );
  }
  const st = await fetchBuddyStatus();
  if (st) lastBuddy.status = st;
  refreshTooltip();
}

export function activate(context: vscode.ExtensionContext) {
  // 高优先级（>=100）保证在状态栏空间紧张时不被挤掉，从而稳定常驻显示
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = "codebuddyUsage.refresh";
  statusBarItem.text = `${icon("zap")} …`;
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand("codebuddyUsage.showDetail", () => update())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("codebuddyUsage.refresh", () => update())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("codebuddyUsage.setCookie", () => setCookie())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("codebuddyUsage.openUsagePage", () => {
      const apiBase = getConfig().get<string>("apiBase", "https://www.workbuddy.cn");
      vscode.env.openExternal(vscode.Uri.parse(`${apiBase}/profile/plans-usage`));
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("codebuddyUsage.buddyClaim", () => buddyClaimCmd())
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("codebuddyUsage.buddyDepart", () => buddyDepartCmd())
  );

  update();
  scheduleTimer();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("codebuddyUsage.refreshIntervalMinutes")) {
        scheduleTimer();
      }
      if (
        e.affectsConfiguration("codebuddyUsage.cookie") ||
        e.affectsConfiguration("codebuddyUsage.userAgent")
      ) {
        update();
      }
      if (e.affectsConfiguration("codebuddyUsage.buddyTravel")) {
        // 开关变化：重新拉取以清空/展示喵喵状态并重置倒计时
        update();
      }
    })
  );
}

export function deactivate() {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}
