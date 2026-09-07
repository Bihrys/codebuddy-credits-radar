# CodeBuddy Usage (VS Code Extension)

[简体中文](./README.md) | English

Shows your CodeBuddy credit balance in the VS Code status bar, and claims the daily credits for you along the way.

---

## Getting started in three steps

### 1. Install the extension

Search for `CodeBuddy Usage` in the Extensions marketplace, or install the `.vsix` file.

### 2. Copy two values from the website

> **About the domains**: Tencent's "CodeBuddy" and "WorkBuddy" share the same account system and backend,
> so signing in to either website works with this extension — no separate registration needed.
> By default this extension reads data from the WorkBuddy website (its pages offer claimable credits),
> so **start by opening the WorkBuddy website** and signing in.

1. Open [https://www.workbuddy.cn/profile/plans-usage](https://www.workbuddy.cn/profile/plans-usage) in your browser and sign in
2. Press `F12` to open DevTools → switch to the `Network` tab → reload the page
3. Filter the request list by `Fetch/XHR`, then pick any request, e.g. `get-user-resource`
4. In `Headers` → `Request Headers`, right-click the `cookie` row and choose **Copy value**:

   ![Copy Cookie](https://raw.githubusercontent.com/wwenc6621/CodeBuddy-Usage/main/resources/docs/copy-cookie.png)
5. Scroll further down in the same request, find the `user-agent` row, and **Copy value** as well:

   ![Copy User-Agent](https://raw.githubusercontent.com/wwenc6621/CodeBuddy-Usage/main/resources/docs/copy-useragent.png)

> The two belong together. Copying them from different requests, or keeping a stale one, may result in "Cookie expired".

### 3. Paste them into VS Code

`Cmd/Ctrl + Shift + P` → run **`CodeBuddy Usage: Set login credentials (Cookie + User-Agent)`** →
paste the Cookie and press Enter, then paste the User-Agent and press Enter.

The status bar at the bottom right shows your remaining credits, e.g. `⚡ 2431.68`. Hover over it for the details:

![Status bar and tooltip](https://raw.githubusercontent.com/wwenc6621/CodeBuddy-Usage/main/resources/docs/tooltip-preview.png)

---

## Everyday use

| What you want                                         | How                                            |
| ----------------------------------------------------- | ---------------------------------------------- |
| Check the balance                                     | Just look at the number in the status bar      |
| See details (total, percentage, per-package expiry)   | Hover over the status bar item                 |
| Refresh manually                                      | Click the status bar item                      |
| Claim credits / send the buddy out manually           | Click "Claim" or "Depart" in the tooltip       |

Auto refresh runs every 30 minutes by default.

### Credits claimed for you every day

Once installed there is nothing to do — both of the following happen automatically:

- **Daily check-in** — checks in every day to claim credits
- **Buddy travel** — claims the credits your buddy earned, then sends it out on the next trip

On success a notification tells you how much you got. If there is nothing to claim, or you already claimed today, you will not be disturbed.

Hovering the status bar shows today's status at the bottom, e.g. `✓ Checked in`, `✿ Countdown 03:12:45`.

---

## Something wrong?

| Symptom                             | What to do                                                       |
| ----------------------------------- | ---------------------------------------------------------------- |
| Status bar shows "No Cookie set"    | Click it and go through steps 2 and 3 above                      |
| Shows "Cookie expired"              | The Cookie expired, or it does not match the UA — copy both again |
| Shows "Fetch failed"                | Click the status bar item to retry                               |
| The number never changes            | Click the status bar item to refresh manually                    |
| You use the international site      | Set `apiBase` to `https://www.workbuddy.ai`                      |

---

## Settings

Search for `codebuddyUsage` in VS Code settings:

| Setting                   | Default                      | Description                                                          |
| ------------------------- | ---------------------------- | -------------------------------------------------------------------- |
| `cookie`                  | empty                        | The string you copied after signing in                               |
| `userAgent`               | empty                        | Empty uses the built-in default; **must be copied from the same request as the Cookie** |
| `refreshIntervalMinutes`  | 30                           | Auto refresh interval (minutes); set 0 to disable                    |
| `autoCheckin`             | on                           | Automatic daily check-in                                             |
| `buddyTravel`             | on                           | Automatic buddy travel                                               |
| `apiBase`                 | `https://www.workbuddy.cn`   | Domestic site; use `https://www.workbuddy.ai` for the international site |

## Privacy

- The Cookie and User-Agent are **stored only in your local VS Code configuration**. They are never uploaded anywhere and never pass through a third party.
- Do not share these two values. When you are done, sign out on the website and they become invalid immediately.

## Build it yourself

```bash
npm install
npm run compile   # or press F5 to debug in an Extension Development Host window
```

Package it: `npm install -g @vscode/vsce && vsce package`

## Languages

The UI follows the VS Code display language. English is the built-in default; Simplified Chinese is provided
by `l10n/bundle.l10n.zh-cn.json` (runtime strings) and `package.nls.zh-cn.json` (manifest strings).
