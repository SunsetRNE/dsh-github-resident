# dsh-github-resident

[中文](README.md) ｜ **English**

A resident GitHub identity bundle for [DeepSeek Harness](https://github.com/deepseek-ai): install it once and every session in the current profile gets a ready set of `gh_*` tools — commit, push, open PRs, manage the gh CLI and its credentials — **without a preinstalled gh on the host and without a manual gh install step**.

> Package `@local/dsh-github-resident-v2` ｜ Plugin name `github-resident` ｜ Profile row id `include:github-resident-v2`

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

### Option A: from the release (recommended)

```bash
# 1) fetch the runtime package and the full source archive
gh release download v1.4.0 --repo SunsetRNE/dsh-github-resident -D /tmp/ghr
ls /tmp/ghr     # local-dsh-github-resident-v2-1.4.0.tgz + dsh-github-resident-1.4.0-src.tar.gz + SHA256SUMS

# 2) verify checksums (the src line must match SHA256SUMS)
cd /tmp/ghr && sha256sum -c SHA256SUMS

# 3) unpack the source archive, then install_bundle with its absolute path
tar xzf dsh-github-resident-1.4.0-src.tar.gz
#   → install_bundle /tmp/ghr/dsh-github-resident-1.4.0

# 4) gate the install
cd /tmp/ghr/dsh-github-resident-1.4.0 && npm run verify   # expect all failed=0

What the two archives are for: `*.tgz` is the npm pack output (the 10 runtime files); `*-src.tar.gz` is the full source (5 gates + LESSONS.md included).

### Option B: install from a source checkout

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
