# Change Log

[简体中文](./CHANGELOG.md) | English

All notable changes are documented in this file.

## [0.8.1]

### Fixed

- Fixed the buddy-depart notification wrongly reporting "travel time 0 hours": the successful
  `depart` response does not always carry a `duration_hours` / `duration` field, and the old code
  fell back to `0`, disagreeing with the real travel time shown on the website (e.g. 2 hours).
  When the duration cannot be read from the `depart` response, the extension now re-queries the
  `status` endpoint and uses the server-registered `duration_hours`, or falls back to deriving it
  from the difference between `arrive_at` and `depart_at`, matching what the website displays.

## [0.8.0]

### Added

- **Bilingual UI (English / Simplified Chinese)**: the extension now follows the VS Code display language.
  Manifest strings use `package.nls.json` / `package.nls.zh-cn.json`; runtime strings use `vscode.l10n.t()`
  with `l10n/bundle.l10n.zh-cn.json`. English is the built-in default and requires no extra file.
- English documentation: `README.en.md` and this file.

### Changed

- Shortened the English tooltip strings (status tags, table headers, summary line, …) so the tooltip stays as compact as the Chinese one and no longer wraps inside columns.

### Fixed

- The "total" link in the hover tooltip was hard-coded to the `.cn` site; it now follows the `apiBase` setting.

## [0.7.0]

### Added

- Buddy travel notifications: when the automatic flow actually **claims credits** or **successfully dispatches the buddy**,
  an information notification pops up, consistent with the check-in one (merged into a single summary per refresh).
- Manually clicking "Claim" / "Depart" in the tooltip now always gives feedback:
  success / nothing to claim / failure are all reported (previously the `0 credits` and failure branches were completely silent).

### Fixed

- Buddy claim and depart failures were only written into the tooltip tag with no notification at all, so they were easy to miss.

### Docs

- Fixed a self-contradictory statement in the README's "automatic check-in" section: only an already-completed check-in is silent; the first successful claim does notify.

## [0.5.0]

### Added

- **Configurable User-Agent**: new `codebuddyUsage.userAgent` setting.
  The server binds the full UA when issuing a session and returns 401 on any mismatch,
  and neighbouring Chrome versions are not interchangeable. Leave it empty to use the built-in default `Chrome/153`.
- Setting credentials now shows two input boxes in a row (Cookie → User-Agent) with `(1/2)` `(2/2)` in the titles;
  pressing `Esc` at any step cancels the whole flow, so a half-mismatched pair is never written.
- The actually effective UA version is echoed back after saving, so you can confirm it was written.

### Changed

- The command `Set login Cookie` was renamed to `Set login credentials (Cookie + User-Agent)`.
- README gained an "About User-Agent" section describing the observed session-binding behaviour.

### Fixed

- Fixed "the pasted User-Agent reverts to the default": the previous Webview form used
  `retainContextWhenHidden: false`, so hiding the panel (switching to the browser to copy)
  destroyed the JS context and rebuilding it reset the input. Replaced with native input boxes,
  which have no such lifecycle issue.

## [0.4.0]

### Added

- Buddy travel: claims credits and dispatches the buddy automatically; the tooltip shows the countdown and manual action links.
- The tooltip footer shows today's check-in status tag.

## [0.3.0]

### Added

- Automatic daily check-in to claim credits.
