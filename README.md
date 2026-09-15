# CodeBuddy Usage（VS Code 扩展）

[English](./README.en.md) | 简体中文

在 VS Code 状态栏显示你的 CodeBuddy 积分余量，顺手把每天能领的积分自动领了。

---

## 三步开始用

### 1. 安装扩展

在扩展市场搜 `CodeBuddy Usage` 安装，或安装 `.vsix` 文件。

### 2. 从官网复制两串东西

> **关于域名**：腾讯的「CodeBuddy」和「WorkBuddy」是同一套账号和后台，
> 登录其中任意一个官网就能用这个扩展，不需要单独注册。
> 本扩展默认拉取的是 WorkBuddy 官网的接口数据（因为它的页面有积分可以领取），
> 所以**第一步打开 WorkBuddy 官网**登录即可。

1. 浏览器打开 [https://www.workbuddy.cn/profile/plans-usage](https://www.workbuddy.cn/profile/plans-usage) 并登录
2. 按 `F12` 打开开发者工具 → 切到 `Network`（网络）面板 → 刷新一下页面
3. 在请求列表里筛选 `Fetch/XHR` 类型，然后选择一个，比如 `get-user-resource`
4. 右侧 `Headers` → `Request Headers`，在 `cookie` 这一行右键 **Copy value**：

   ![复制 Cookie](https://raw.githubusercontent.com/wwenc6621/CodeBuddy-Usage/main/resources/docs/copy-cookie.png)
5. 在同一个请求里继续往下翻，找到 `user-agent` 行，同样右键 **Copy value**：

   ![复制 User-Agent](https://raw.githubusercontent.com/wwenc6621/CodeBuddy-Usage/main/resources/docs/copy-useragent.png)

> 它们是一对的，分开复制、或者留了旧的那个，都可能提示「Cookie 已失效」。

### 3. 粘贴到 VS Code

`Cmd/Ctrl + Shift + P` → 运行 **`CodeBuddy Usage: 设置登录凭证（Cookie + User-Agent）`** →
先粘 Cookie 回车，再粘 User-Agent 回车。

右下角状态栏会显示余量，例如 `⚡ 2431.68`。鼠标悬停上去就能看明细：

![状态栏与悬浮框](https://raw.githubusercontent.com/wwenc6621/CodeBuddy-Usage/main/resources/docs/tooltip-preview.png)

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

| 现象                        | 怎么办                                                |
| --------------------------- | ----------------------------------------------------- |
| 状态栏显示「未设置 Cookie」 | 点它，走一遍上面的第 2、3 步                          |
| 显示「Cookie 已失效」       | Cookie 过期了，或者和 UA 不是一对，重新复制一次       |
| 显示「拉取失败」            | 点状态栏重试一次                                      |
| 数字一直不变                | 点一下状态栏手动刷新                                  |
| 用的是国际站                | 设置里把`apiBase` 改成 `https://www.workbuddy.ai` |

---

## 设置项

在 VS Code 设置里搜 `codebuddyUsage`：

| 设置                       | 默认                         | 说明                                                 |
| -------------------------- | ---------------------------- | ---------------------------------------------------- |
| `cookie`                 | 空                           | 登录后复制的那串                                     |
| `userAgent`              | 空                           | 留空用内置默认值，**必须和 Cookie 同一次复制** |
| `refreshIntervalMinutes` | 30                           | 自动刷新间隔（分钟），填 0 关闭                      |
| `autoCheckin`            | 开                           | 自动每日签到                                         |
| `buddyTravel`            | 开                           | 自动喵喵旅行                                         |
| `apiBase`                | `https://www.workbuddy.cn` | 国内站；国际站填`https://www.workbuddy.ai`         |

## 安全

- Cookie 和 User-Agent **只存在你本机的 VS Code 配置里**，不会上传到任何地方，也不会经过第三方。
- 别把这两串发给别人。不用了就在官网退出登录，它们立刻失效。

## 自己编译

```bash
npm install
npm run compile   # 或按 F5 在扩展开发宿主窗口中调试
```

打包：`npm install -g @vscode/vsce && vsce package`
