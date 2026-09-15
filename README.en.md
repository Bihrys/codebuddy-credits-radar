# CodeBuddy Usage (VS Code Extension)

[简体中文](./README.md) | English

Shows your CodeBuddy credit balance in the VS Code status bar, and claims the daily credits for you along the way.

---

## Zero-config start

1. Install this extension (search `CodeBuddy Usage` in the Extensions marketplace, or install the `.vsix` file)
2. Make sure the **CodeBuddy extension is installed and signed in** on this machine (Tencent Cloud CodeBuddy / coding-copilot)

That's it. This extension automatically reads CodeBuddy's sign-in state (`accessToken`) to call the APIs —
**no more copying Cookies by hand**. CodeBuddy keeps the token refreshed, so what we read is always current.

> **About the domains**: Tencent's "CodeBuddy" and "WorkBuddy" share the same account system and backend,
> so signing in to either website works — no separate registration needed.
> By default this extension reads data from the WorkBuddy website (its pages offer claimable credits).

The status bar at the bottom right shows your remaining credits, e.g. `⚡ 2431.68`. Hover over it for the details:

![Status bar and tooltip](https://raw.githubusercontent.com/wwenc6621/CodeBuddy-Usage/main/resources/docs/tooltip-preview.png)

### You may see one keychain prompt

The `accessToken` is stored encrypted locally (VS Code SecretStorage). Decrypting it requires the key from the
system keychain, so the first read triggers a system prompt — click **Always Allow** and it will not ask again.

> Prefer not to grant keychain access? Set an `accessToken` manually (see "Fallbacks"), or fall back to Cookie mode.

### Fallbacks (when auto-read is unavailable)

You need a fallback when: CodeBuddy is not installed, you are not on macOS (auto-read is macOS-only for now),
or keychain access was denied.

**Option 1 (recommended): manual Access Token**

`Cmd/Ctrl + Shift + P` → **`CodeBuddy Usage: Set Access Token (optional fallback)`** → paste the JWT.
It stays valid for about 60 days; leave it empty to go back to auto-read.

**Option 2 (legacy): Cookie + User-Agent**

1. Open [https://www.workbuddy.cn/profile/plans-usage](https://www.workbuddy.cn/profile/plans-usage) in your browser and sign in
2. Press `F12` to open DevTools → switch to the `Network` tab → reload the page
3. Filter the request list by `Fetch/XHR`, then pick any request, e.g. `get-user-resource`
4. In `Headers` → `Request Headers`, right-click the `cookie` row and choose **Copy value**:

   ![Copy Cookie](https://raw.githubusercontent.com/wwenc6621/CodeBuddy-Usage/main/resources/docs/copy-cookie.png)
5. Scroll further down in the same request, find the `user-agent` row, and **Copy value** as well:

   ![Copy User-Agent](https://raw.githubusercontent.com/wwenc6621/CodeBuddy-Usage/main/resources/docs/copy-useragent.png)

> The two belong together. Copying them from different requests, or keeping a stale one, may result in "Login expired".

6. `Cmd/Ctrl + Shift + P` → run **`CodeBuddy Usage: Set login credentials (Cookie + User-Agent)`** →
   paste the Cookie and press Enter, then paste the User-Agent and press Enter.

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

| Symptom                             | What to do                                                          |
| ----------------------------------- | ------------------------------------------------------------------- |
| Shows "No credentials found"        | Make sure CodeBuddy is signed in; otherwise set an Access Token     |
| Shows "Login expired"               | CodeBuddy's session expired — sign in again, or set an Access Token |
| Shows "Fetch failed"                | Click the status bar item to retry                                  |
| The number never changes            | Click the status bar item to refresh manually                       |
| The keychain prompt keeps appearing | Click "Always Allow" in the prompt, or use a manual Access Token    |
| You use the international site      | Set `apiBase` to `https://www.workbuddy.ai`                         |

---

## Settings

Search for `codebuddyUsage` in VS Code settings:

| Setting                   | Default                      | Description                                                          |
| ------------------------- | ---------------------------- | -------------------------------------------------------------------- |
| `accessToken`             | empty                        | Manual fallback JWT. **Normally not needed** — leave empty to auto-read the CodeBuddy sign-in state |
| `cookie`                  | empty                        | Legacy mode, used only when no Access Token is available              |
| `userAgent`               | empty                        | Needed by Cookie mode only; empty uses the built-in default           |
| `refreshIntervalMinutes`  | 30                           | Auto refresh interval (minutes); set 0 to disable                    |
| `autoCheckin`             | on                           | Automatic daily check-in                                             |
| `buddyTravel`             | on                           | Automatic buddy travel                                               |
| `apiBase`                 | `https://www.workbuddy.cn`   | Domestic site; use `https://www.workbuddy.ai` for the international site |

## Privacy

- The extension reads CodeBuddy's sign-in state (`accessToken`) locally only; credentials are **never uploaded anywhere** and never pass through a third party.
- Reading the `accessToken` requires the system keychain (macOS); after the first authorization it stops asking.
- A manually entered `accessToken` / Cookie is **stored only in your local VS Code configuration**.
- Do not share these credentials. Signing out invalidates them immediately.

## Build it yourself

```bash
npm install
npm run compile   # or press F5 to debug in an Extension Development Host window
```

Package it: `npm install -g @vscode/vsce && vsce package`

## Languages

The UI follows the VS Code display language. English is the built-in default; Simplified Chinese is provided
by `l10n/bundle.l10n.zh-cn.json` (runtime strings) and `package.nls.zh-cn.json` (manifest strings).
