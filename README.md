# CodeBuddy Usage（VS Code 扩展）

[English](./README.en.md) | 简体中文

在 VS Code 状态栏显示你的 CodeBuddy 积分余量，顺手把每天能领的积分自动领了。

---

## 开箱即用

1. 安装本扩展（扩展市场搜 `CodeBuddy Usage`，或安装 `.vsix` 文件）
2. 确保本机**已经安装并登录了 CodeBuddy 扩展**（腾讯云 CodeBuddy / coding-copilot）

就这样。本扩展会自动读取 CodeBuddy 的登录态（`accessToken`）来调用接口，
**不需要再手动复制 Cookie**。CodeBuddy 自己会刷新登录态，所以这里读到的始终是最新的。

> **关于域名**：腾讯的「CodeBuddy」和「WorkBuddy」是同一套账号和后台，
> 登录其中任意一个官网即可，不需要单独注册。
> 本扩展默认拉取 WorkBuddy 官网的接口数据（因为它的页面有积分可以领取）。

右下角状态栏会显示余量，例如 `⚡ 2431.68`。鼠标悬停上去就能看明细：

![状态栏与悬浮框](https://raw.githubusercontent.com/wwenc6621/CodeBuddy-Usage/main/resources/docs/tooltip-preview.png)

### 首次可能弹一次钥匙串授权

`accessToken` 在本地是加密存放的（VS Code 的 SecretStorage），解密需要读取钥匙串里的密钥，
所以首次读取时系统会弹窗询问，**点「始终允许」**即可，之后不再询问。

> 不想授权钥匙串？可以手动指定 `accessToken`（见下方「兜底方案」），或退回旧的 Cookie 模式。

### 兜底方案（自动读取失败时）

以下情况需要手动兜底：本机没装 CodeBuddy、非 macOS 系统（自动读取暂只支持 macOS）、
或钥匙串授权被拒。

**方式一（推荐）：手动 Access Token**

`Cmd/Ctrl + Shift + P` → **`CodeBuddy Usage: 设置 Access Token（可选兜底）`** → 粘贴 JWT。
有效期约 60 天；留空则回到自动读取。

**方式二（旧）：Cookie + User-Agent**

1. 浏览器打开 [https://www.workbuddy.cn/profile/plans-usage](https://www.workbuddy.cn/profile/plans-usage) 并登录
2. 按 `F12` 打开开发者工具 → 切到 `Network`（网络）面板 → 刷新一下页面
3. 在请求列表里筛选 `Fetch/XHR` 类型，然后选择一个，比如 `get-user-resource`
4. 右侧 `Headers` → `Request Headers`，在 `cookie` 这一行右键 **Copy value**：

   ![复制 Cookie](https://raw.githubusercontent.com/wwenc6621/CodeBuddy-Usage/main/resources/docs/copy-cookie.png)
5. 在同一个请求里继续往下翻，找到 `user-agent` 行，同样右键 **Copy value**：

   ![复制 User-Agent](https://raw.githubusercontent.com/wwenc6621/CodeBuddy-Usage/main/resources/docs/copy-useragent.png)

> 它们是一对的，分开复制、或者留了旧的那个，都可能提示「登录已过期」。

6. `Cmd/Ctrl + Shift + P` → 运行 **`CodeBuddy Usage: 设置登录凭证（Cookie + User-Agent）`** →
   先粘 Cookie 回车，再粘 User-Agent 回车。

---

## 日常使用

| 想做什么                             | 怎么做                           |
| ------------------------------------ | -------------------------------- |
| 看余量                               | 直接看状态栏数字                 |
| 看明细（总量、占比、各套餐到期时间） | 鼠标悬停在状态栏上               |
| 手动刷新                             | 点一下状态栏                     |
| 手动领积分 / 派喵喵                  | 点悬浮框里的「领积分」「去旅行」 |

默认每 30 分钟自动刷新一次。

### 每天自动帮你领的积分

装好就不用管了，下面两件事都会自动做：

- **每日签到** —— 每天自动签到领积分
- **喵喵旅行** —— 自动把喵喵挣的积分领了，再派它出去赚下一趟

成功了右下角会弹一条提示告诉你领到多少；没什么可领、或者今天已经领过了，就不会打扰你。

悬停状态栏时，底部会显示今天的状态，例如 `✓ 已签到`、`✿ 旅行倒计时 03:12:45`。

---

## 出问题了？

| 现象                         | 怎么办                                                                 |
| ---------------------------- | ---------------------------------------------------------------------- |
| 状态栏显示「未找到登录凭据」 | 确认 CodeBuddy 已登录；仍不行就手动设置 Access Token                    |
| 显示「登录已过期」           | CodeBuddy 登录态失效，重新登录一次；或手动设置 Access Token             |
| 显示「拉取失败」             | 点状态栏重试一次                                                       |
| 数字一直不变                 | 点一下状态栏手动刷新                                                   |
| 总弹钥匙串授权               | 弹窗里点「始终允许」；或改用手动 Access Token 兜底                      |
| 用的是国际站                 | 设置里把 `apiBase` 改成 `https://www.workbuddy.ai`                      |

---

## 设置项

在 VS Code 设置里搜 `codebuddyUsage`：

| 设置                       | 默认                         | 说明                                                                 |
| -------------------------- | ---------------------------- | -------------------------------------------------------------------- |
| `accessToken`              | 空                           | 手动兜底用的 JWT。**通常无需设置**，留空自动读取 CodeBuddy 登录态      |
| `cookie`                   | 空                           | 旧模式，仅在拿不到 Access Token 时使用                                 |
| `userAgent`                | 空                           | 仅 Cookie 模式需要，留空用内置默认值                                   |
| `refreshIntervalMinutes`   | 30                           | 自动刷新间隔（分钟），填 0 关闭                                        |
| `autoCheckin`              | 开                           | 自动每日签到                                                           |
| `buddyTravel`              | 开                           | 自动喵喵旅行                                                           |
| `apiBase`                  | `https://www.workbuddy.cn` | 国内站；国际站填 `https://www.workbuddy.ai`                            |

## 安全

- 扩展只在本机读取 CodeBuddy 登录态（`accessToken`），凭据**不会上传到任何地方**，也不经过第三方。
- 读取 `accessToken` 需要访问系统钥匙串（macOS），首次授权后不再询问。
- 手动填写的 `accessToken` / Cookie **只存在你本机的 VS Code 配置里**。
- 别把这些凭据发给别人。退出登录后它们立刻失效。

## 自己编译

```bash
npm install
npm run compile   # 或按 F5 在扩展开发宿主窗口中调试
```

打包：`npm install -g @vscode/vsce && vsce package`
