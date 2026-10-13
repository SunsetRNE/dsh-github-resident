# dsh-github-resident

[中文](README.md) ｜ **English**

> **1.7.0 merged test package:** keeps `@sunsetrne/dsh-github-resident-v2` and includes 17 `gh_*` tools, 10 `deck_*` tools, 27 bundled skills, the composer toolbar and the right sidebar. The imported Deck snapshot is 1.8.0-rc.7, newer than the device's standalone 1.7.51 installation.
>
> Disable the standalone `dsh-mattpocock-skills-deck` bundle (including its tools component) before importing this package to upgrade Resident, then restart DSH. Verify tools, skills and panels before removing the disabled standalone Deck through Plugin Manager. Do not delete a linked plugin directory first or clear shared data. This is a local package, not an npm release; the installer resolves `yaml` and `dsh-plugin-update`. Offline installation and live-device visual acceptance are not claimed.

A resident GitHub identity bundle for [DeepSeek Harness](https://github.com/deepseek-ai): install it once and every session in the current profile gets a ready set of `gh_*` tools — commit, push, open PRs, manage the gh CLI and its credentials — **without a preinstalled gh on the host and without a manual gh install step**.

> Package `@sunsetrne/dsh-github-resident-v2` ｜ Plugin name `github-resident` ｜ Profile row id `include:github-resident-v2`

## What it does

### 1. Ships its own gh — usable right after install

| Layer | Source | Location | Root needed |
|---|---|---|---|
| 1 `system` | gh already on the host | the `gh` on `PATH` | no (it is already there) |
| 2 `plugin-cache` | shipped by this plugin | `~/.dsh/gh-cli/bin/gh` | no |
| 3 auto-land | official `tar.gz`, single file extracted; falls back to `dpkg --force-not-root --extract` on the `.deb` | same | no |

- Every `gh_*` tool call goes through `resolveGh()`: when all three layers are empty it lands a copy right there and the call continues.
- The plugin also **pre-provisions at load time**: a local-only probe first (milliseconds, no network), and only then a background landing that never blocks loading.
- The landed copy is user-level and **never touches the system package database**; a system gh is never modified.
- Downloads prefer `curl` and fall back to Node's built-in `fetch` (`attempts[].method` says which one ran).

### 2. Credentials: masked in every output, destroyed on demand

"One account stays valid for this environment" is the design goal, so credentials live in several places. Uninstalling the plugin does **not** remove them — destruction is explicit.

| Copy | Location | Written by |
|---|---|---|
| OAuth token (host level + user level) | `~/.config/gh/hosts.yml` (0600) | gh itself |
| `credential.helper` | `git config --global` (host scope + global) | `gh auth setup-git` |
| Plaintext token | `~/.git-credentials` (0600) | `gh_resident_login` |
| State | `~/.dsh/github-resident.json` (0600) | `gh_resident_login` |
| `gh` binary | `/usr/bin/gh` (dpkg package, system layer only) | `gh_cli_install` |

- No tool ever returns a token in the clear, only a mask (`gho_…9KLh (len=40)`).
- Teardown is `gh_cli_logout`: without `confirm` it only reports; `revoke:true` additionally revokes at GitHub (OAuth `gho_`/`ghu_` only — `ghp_`/`github_pat_` must be deleted in the web UI).

### 3. Version self-update + landing-cache GC

- `gh_cli_version`: compares the running gh against the latest official release; only `update:true` acts (and only on the plugin-owned copy — a system gh is reported, never touched). 24h cooldown per source, 30-minute probe cache.
- `gh_cache_gc`: removes leftover downloads, the `deb-extract` scratch dir and extra old versions under `~/.dsh/gh-cli` (keeps the newest 2 by default). It is mutually exclusive with landing, so it never deletes an in-flight download.

### 4. Settings panel: read-only by default, no hidden account checks

- `GET /state` is a **pure read**: it only returns the in-memory snapshot and never forks a subprocess or triggers a check; with no snapshot it returns a skeleton (`probing:true`, `authenticated:null`).
- Checks happen in exactly two places: **one background run at plugin load**, and an explicit `GET /state?refresh=1` (the panel's "Refresh now").
- The panel shows: status badge, credential helper, gh credential path, gh source layer, current/latest version, snapshot time (stale snapshots are labelled "已过期 · 缓存").

### 5. Background tools

`gh_resident_status` / `gh_repos` / `gh_commit` / `gh_sync` (commit+push every dirty repo in one pass) / `gh_pr` (REST) / `gh_cli_status` / `gh_cli_setup_git`. Every result carries a `{ protocol, ok }` envelope; failures keep the original fields.

## Tools

| Tool | Purpose | Read-only |
|---|---|---|
| `gh_resident_status` | identity / credentials / helper / network / repo overview | yes |
| `gh_resident_login` | persist a token (0600) + write `~/.git-credentials` + set `credential.helper` + set git identity | no |
| `gh_repos` | enumerate git repos under a root with branch / dirty count / ahead-behind | yes |
| `gh_commit` | one repo: `add -A` + `commit` + optional `push` | no |
| `gh_sync` | **every dirty repo** under a root: commit + push in one pass (`dry_run` supported) | no |
| `gh_pr` | open a PR through the REST API | no |
| `gh_cli_install` | make gh available (system layer first, else land a copy) | no |
| `gh_cli_resolve` | read-only report of the gh layer, path and arch string | yes |
| `gh_cli_version` | version check + self-update | no |
| `gh_cache_gc` | landing-cache GC | no |
| `gh_cli_auth_web` | gh device-code flow over a PTY, grabs the one-time code and opens the page | no |
| `gh_cli_status` | gh version / authenticated accounts / credential helper / masked `hosts.yml` | yes |
| `gh_cli_setup_git` | `gh auth setup-git`, optionally sets the git identity | no |
| `gh_cli_logout` | credential teardown (revoke + purge copies + optional gh removal) | no |
| `gh_protocol` | machine-readable protocol document | yes |

HTTP (loopback only, `127.0.0.1`): `GET /state`, `GET /state?cached=1`, `GET /state?refresh=1`, `GET /gh/version`, `POST /gh/update`, `GET /protocol`, `POST /auth/start`, `POST /logout`.

## Install

### Option A: install as a package (recommended)

```bash
VER=1.7.7   # the version you want
dsh plugin --profile web add \
  "https://github.com/SunsetRNE/dsh-github-resident/releases/download/v$VER/sunsetrne-dsh-github-resident-v2-$VER.tgz"

# self-check: where it landed, which version, does it load
P=~/.dsh/profiles/web/node_modules/@sunsetrne/dsh-github-resident-v2
readlink -f "$P"; grep -m1 '"version"' "$P/package.json"
node --input-type=module -e "import('$P/dist/host.js').then(m=>console.log('LOADED-OK',m.name))"
```

Restart the host afterwards — plugins are loaded at boot. The release `*.tgz` is the `npm pack` output: `dist/`, `plugin.js`, `deck/`, `bundled-skills/`, `locale/` are all inside.

### Updates: the panel only updates "registry-typed" installs

The panel is built on `dsh-plugin-update`. An install is updatable only when both hold (verified against `dist/reader.js` on a live machine):

1. the profile dependency spec is **registry-typed** — a version / range / dist-tag (`^1.7.7`, `latest`, …); `registrySpec()` accepts neither URLs nor `link:`;
2. the installed directory sits under `<profile>/node_modules/`.

Fail either one and the engine reports `source-install` (panel text: "源码安装实例，不支持版本更新") and offers no manual command. The three install forms:

| Install form | spec | Panel can update | How to upgrade |
|---|---|---|---|
| From a registry (npm / private) | `^1.7.7` | ✅ | the panel's install-update |
| From the release tarball (Option A) | `https://…tgz` | ❌ | re-run `dsh plugin … add <new tarball>` |
| From a source checkout (Option B) | `link:/…` | ❌ | same; or convert to a package install |

> This package is **not on npm yet** (`npm view @sunsetrne/dsh-github-resident-v2` → 404), so the panel's "reinstall by name@version" advice is not available today — reinstall from the release tarball URL instead. The release workflow ships an npm publish step (active only when the repository secret `NPM_TOKEN` exists); once configured, `dsh plugin --profile web add @sunsetrne/dsh-github-resident-v2@^x.y.z` becomes the updatable install form.

### Option B: install from a source checkout (for development; not updatable from the panel)

```bash
# 1) sanity
node --check index.js && node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"

# 2) install_bundle with this directory's absolute path via plugin_manager
#    (the profile records it as link:, so editing here edits the installed plugin)

# 3) gates
npm run verify          # expect: bundle pass=8 fail=0, all verifiers failed=0, real artifact runs=true
```

`npm run verify` expands to:

```bash
bash verify-bundle.sh          # identity / syntax / profile link / loopback endpoint
node verify-logout.mjs         # 19 checks: credential teardown inside a fake HOME
node verify-gh-bootstrap.mjs   # 31 checks: self-landing with no system gh (fetch fallback, load-time provision)
node verify-update-gc.mjs      # 34 checks: version self-update / cache GC / zero-check reads
node verify-real-artifact.mjs  # extractor against the real official release (auto-SKIP when offline)
```

## Environment switches

| Variable | Effect | Default |
|---|---|---|
| `DSH_GH_DATA_DIR` | where the shipped gh and its stamps live | `~/.dsh/gh-cli` |
| `DSH_GH_NO_BOOTSTRAP=1` | disable load-time self-landing | unset (on) |
| `DSH_GH_NO_STATE_CHECK=1` | disable the load-time account check | unset (on) |
| `DSH_GH_NO_UPDATE=1` | disable load-time self-update | unset (on) |
| `DSH_GH_FORCE_FETCH=1` | skip curl, force fetch | unset |
| `DSH_GH_UPDATE_TTL_MS` | auto-update cooldown window | `86400000` (24h) |
| `DSH_GH_VERSION_PROBE_TTL_MS` | version-probe cache window | `1800000` (30min) |
| `DSH_GH_SNAPSHOT_TTL_MS` | account snapshot lifetime | `90000` |
| `DSH_GH_SNAPSHOT_RETRY_MS` | retry gap after a failed snapshot rebuild | `20000` |
| `DSH_GH_RELEASE_API` / `DSH_GH_DOWNLOAD_BASE` | release metadata / download base (fixtures, mirrors) | official |
| `DSH_GH_OAUTH_CLIENT_ID` | OAuth client id used for token revocation | placeholder constant |

## Layout

```
index.js / plugin.js      host half (identical content; plugin.js is the entry)
client.js                 settings panel (settings.section)
cordis.patch.yml          plugin row definition
locale/*.json             UI strings
verify-*.mjs / .sh        gates
LESSONS.md                field notes (23 entries: symptom / root cause / acceptance check)
```

## Known limits

- With `DSH_GH_NO_STATE_CHECK=1`, only an explicit `?refresh=1` performs an account check, so the panel stays at "后台检查中…（未触发）".
- A system gh is owned by the host package manager; to move to the plugin-owned layer, run `gh_cli_logout {uninstall_gh:true}` first.
- Client-half changes need a page refresh; the host half is under `patchReload: startup`, so it follows a host restart.

## Docs

- [LESSONS.md](LESSONS.md) — 23 real-world pitfalls (tar mode bits, GC racing a landing, side effects in the read path, a fake ctx whose `effect` never ran, and more).

## License

[MIT](LICENSE) © 2026 SunsetRNE
