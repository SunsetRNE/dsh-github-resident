/**
 * github-resident 的客户端半边：设置 → GitHub 账号管理页。
 *
 * 数据来自插件在本机回环上开的小接口（127.0.0.1:31790）：
 *   GET  /state       账号 / gh 版本 / 凭据助手 / 最近一次的一次性码
 *   POST /auth/start  生成新的一次性码并拉起浏览器
 * 样式只用主题 token（--dsw-alias-*），局部 <style> 随组件挂载/卸载。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-github-resident-v2',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // L12：默认回环端口 31790；宿主若用 DSH_GH_API_PORT 改了端口，可以把实际值注入
    // window.__DSH_GITHUB_RESIDENT_API__（插件半边是同名端口，只有浏览器能看到注入值）。
    const API = (typeof window !== 'undefined' && window.__DSH_GITHUB_RESIDENT_API__)
      || 'http://127.0.0.1:31790';
    const DEVICE_URL = 'https://github.com/login/device';
    const STEPS = [
      ['1', '生成码', '点下面的「生成一次性码」——插件在后台起 gh 的设备码流程并拉起浏览器'],
      ['2', '填码', '把页面上出现的那 8 位码填进 GitHub 授权页，确认授权'],
      ['3', '核验', '授权后本页状态会变成「已授权」并显示账号名；再回会话跑一次 gh_cli_setup_git'],
    ];
    const COMMANDS = [
      ['gh_cli_install', '复用系统 gh；缺则自带落地（抽官方 tar.gz 单文件，退回 .deb）'],
      ['gh_cli_auth_web', '取一次性码 + 拉起浏览器（等价于本页按钮）'],
      ['gh_cli_status', '核验账号、凭据助手、hosts.yml'],
      ['gh_cli_setup_git', '让 git push 走 gh 的 credential helper'],
      ['gh_repos / gh_sync', '枚举仓库 / 多仓库一次性提交推送'],
      ['gh_pr', '走 REST API 开 PR'],
    ];

    // 仓库登记文件库：面板读写的是插件协议里的落盘契约（一仓一文件）。
    // 授权按钮是「人自己点的」那条路径 —— 点下去才带 consent=1 打 POST /registry/build。
    const REG_COMMANDS = [
      ['gh_repo_registry {action:"plan"}', '只读计划'],
      ['gh_repo_registry {action:"build", consent:true}', '同意后建库'],
      ['gh_repo_registry {action:"rescan"}', '刷新快照'],
      ['gh_repo_registry {action:"verify"}', '与磁盘对账'],
      ['gh_repo_registry_list', '只读文件库'],
    ];

        // R5：两页共用一份样式表表（原来两套只差前缀），共享规则写模板，独有规则各自追加。
    const CSS_SHARED = [
      '.{p}-root{max-width:680px;color:var(--dsw-alias-label-primary)}',
      '.{p}-root *{box-sizing:border-box}',
      '.{p}-h1{font-size:15px;font-weight:600;margin:0 0 6px}',
      '.{p}-lead{font-size:12.5px;line-height:1.7;color:var(--dsw-alias-label-secondary);margin:0 0 18px}',
      '.{p}-sec{margin:0 0 18px}',
      '.{p}-sec>h3{font-size:11.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);margin:0 0 8px}',
      '.{p}-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:14px 16px}',
      '.{p}-row{display:flex;align-items:baseline;gap:14px;padding:7px 0;font-size:12.5px}',
      '.{p}-row+.{p}-row{border-top:1px solid var(--dsw-alias-border-l1)}',
      '.{p}-k{color:var(--dsw-alias-label-secondary);flex:0 0 118px}',
      '.{p}-v{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all;font-size:12px}',
      '.{p}-btn{font:inherit;font-size:12.5px;line-height:1;padding:8px 14px;border-radius:7px;cursor:pointer;color:var(--dsw-alias-brand-primary);background:transparent;border:1px solid var(--dsw-alias-brand-primary);transition:background .12s}',
      '.{p}-btn:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.{p}-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.{p}-btn.{p}-ghost{color:var(--dsw-alias-label-secondary);border-color:var(--dsw-alias-border-l2)}',
      '.{p}-btn[disabled]{opacity:.45;cursor:default}',
      '.{p}-badge{display:inline-flex;align-items:center;gap:7px;font-size:12px;padding:3px 10px;border-radius:999px;border:1px solid currentColor}',
      '.{p}-dot{width:6px;height:6px;border-radius:999px;background:currentColor;display:inline-block}',
      '.{p}-cmd{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;font-size:12px}',
      '.{p}-cmd+.{p}-cmd{border-top:1px solid var(--dsw-alias-border-l1)}',
      '.{p}-cmd code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-primary)}',
      '.{p}-cmd em{font-style:normal;color:var(--dsw-alias-label-secondary);margin-left:9px}',
      '.{p}-actions{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:13px}',
    ];
    const cssFor = (p, extra) => CSS_SHARED.concat(extra).join('').replaceAll('{p}-', p + '-');
    const CSS = cssFor('ghr', [
      '.{p}-steps{display:flex;flex-direction:column;gap:10px}',
      '.{p}-step{display:flex;gap:11px;align-items:flex-start;font-size:12.5px;line-height:1.55}',
      '.{p}-num{flex:0 0 20px;height:20px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;font-style:normal;color:var(--dsw-alias-brand-primary);border:1px solid var(--dsw-alias-brand-primary)}',
      '.{p}-step b{font-weight:600}',
      '.{p}-step span{color:var(--dsw-alias-label-secondary)}',
      '.{p}-codebox{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:12px;padding:12px 14px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:1px dashed var(--dsw-alias-border-l2)}',
      '.{p}-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:22px;font-weight:600;letter-spacing:.16em;color:var(--dsw-alias-label-primary)}',
      '.{p}-when{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:4px}',
    ]);
    const REG_CSS = cssFor('ghreg', [
      '.{p}-ask{margin-top:12px;padding:12px 14px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:1px dashed var(--dsw-alias-border-l2);font-size:12.5px;line-height:1.65}',
      '.{p}-ask b{font-weight:600}',
      '.{p}-answer{margin-top:10px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.{p}-repo{padding:9px 0;font-size:12.5px}',
      '.{p}-repo+.{p}-repo{border-top:1px solid var(--dsw-alias-border-l1)}',
      '.{p}-repo-hd{display:flex;align-items:center;gap:9px;flex-wrap:wrap}',
      '.{p}-repo-hd b{font-weight:600}',
      '.{p}-repo-path{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;color:var(--dsw-alias-label-secondary);word-break:break-all;margin-top:3px}',
      '.{p}-repo-meta{display:flex;gap:12px;flex-wrap:wrap;font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:4px}',
    ]);

    // R5：三个展示组件也只有前缀不同，用一个工厂生成两套名字。
    function uiParts(prefix) {
      const Badge = ({ text, tone }) => h('span', { className: prefix + '-badge', style: { color: tone } }, h('i', { className: prefix + '-dot' }), text);
      const Btn = ({ children, onClick, ghost, disabled }) => h('button', {
        type: 'button', onClick, disabled: Boolean(disabled),
        className: ghost ? prefix + '-btn ' + prefix + '-ghost' : prefix + '-btn',
      }, children);
      const Section = ({ title, children }) => h('section', { className: prefix + '-sec' }, h('h3', null, title), h('div', { className: prefix + '-card' }, children));
      return { Badge, Btn, Section };
    }
    const { Badge, Btn, Section } = uiParts('ghr');
    const { Badge: RegBadge, Btn: RegBtn, Section: RegSection } = uiParts('ghreg');

    /** 一个条目 → 一行人类可读的绑定描述（无远端时明说）。 */
    function remoteText(e) {
      if (!e || !e.hasRemote) return '无远端';
      const r = e.remote || {};
      const slug = [r.host, r.owner, r.repo].filter(Boolean).join('/');
      return '绑定 ' + (slug || r.url || '远端');
    }

    function RegistryPanel() {
      const [reg, setReg] = React.useState({ phase: 'idle' });
      const [lib, setLib] = React.useState(null);
      const [acct, setAcct] = React.useState(null);
      const acctRef = React.useRef(acct);
      acctRef.current = acct;
      const [last, setLast] = React.useState(null);
      const [busy, setBusy] = React.useState('');
      const [onlyMissing, setOnlyMissing] = React.useState(false);
      const [armPurge, setArmPurge] = React.useState(false);

      // 三个只读入口：登记库状态（许可 + 计数）、清单（条目）、以及**账号状态**。
      // 账号那一份和「GitHub」页读的是同一个 /state 快照 —— 两页共用一份事实，谁都不另存一份登录态。
      // 404 说明宿主还停在旧版本那一刻。
      const load = React.useCallback(() => Promise.all([
        fetch(API + '/registry').then((r) => (r.status === 404 ? { unsupported: true } : r.json())),
        fetch(API + '/registry/list').then((r) => (r.status === 404 ? { unsupported: true } : r.json())),
        fetch(API + '/state?cached=1').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]).then((pair) => {
        setAcct(pair[2] || null);
        if (pair[0].unsupported) { setReg({ phase: 'unsupported' }); setLib({ unsupported: true }); return; }
        setReg({ phase: 'ok', data: pair[0] });
        setLib(pair[1]);
      }).catch((e) => setReg({ phase: 'down', message: String((e && e.message) || e) })), []);

      // N1：原来只在挂载时读一次缓存 —— 后台检查落地后页面不会自愈，一直显示「检查中」。
      React.useEffect(() => {
        load();
        let tries = 0;
        const timer = window.setInterval(() => {
          const a = acctRef.current;
          const ready = Boolean(a) && a.authenticated !== null && (!a.probe || a.probe.state !== 'running');
          if (ready || tries >= 20) { window.clearInterval(timer); return; }
          tries += 1;
          load();
        }, 1500);
        return () => window.clearInterval(timer);
      }, [load]);

      const post = (url, tag) => {
        setBusy(tag);
        return fetch(url, { method: 'POST' })
          .then((r) => (r.status === 404 ? { ok: false, error: '宿主未重启：这条路由还没上线（HTTP 404）' } : r.json()))
          .then((j) => { setLast(j); setBusy(''); return load(); })
          .catch((e) => { setLast({ ok: false, error: String((e && e.message) || e) }); setBusy(''); });
      };

      const flash = (text) => { setLast({ ok: true, flash: text }); };

      const d = reg.data || null;
      const consent = (d && d.consent) || null;
      const granted = Boolean(consent && consent.recorded);
      const hasLib = Boolean(d && d.libraryExists);
      const rows = (lib && lib.entries) || [];
      const shown = onlyMissing ? rows.filter((e) => !e.hasRemote) : rows;

      const tone = reg.phase !== 'ok' ? 'var(--dsw-alias-state-error-primary)'
        : granted && hasLib ? 'var(--dsw-alias-state-success-primary)'
          : granted ? 'var(--dsw-alias-state-idle-primary)'
            : 'var(--dsw-alias-state-warn-primary)';
      // 用词纪律：这一页只说「登记库」，绝不说「未授权 / 已授权」——
      // 那两个字在「GitHub」页里指账号凭据，混用会让人以为账号掉了。
      const label = reg.phase === 'idle' ? '读取中…'
        : reg.phase === 'down' ? '插件接口未就绪'
          : reg.phase === 'unsupported' ? '宿主未重启（/registry 404）'
            : hasLib ? ('登记库已建立 · ' + rows.length + ' 个仓库')
              : granted ? '已有建库许可 · 库还没建'
                : '登记库未建立 · 等你同意';

      const lastText = !last ? null
        : last.flash ? last.flash
          : last.consentRequired ? '闸门拦下：未落盘（问题见上）'
            : last.error ? ('失败：' + last.error)
              : last.action === 'verify' ? ('对账：' + (last.inSync ? '一致' : '有漂移'))
                : typeof last.registered === 'number' ? ('已登记 ' + last.registered + '（远端 ' + last.remoteBound + ' / 无远端 ' + last.withoutRemote + '）')
                  : last.action === 'revoke' ? '许可已撤销（库保留可读）'
                    : last.action === 'purge' ? '库已清空'
                      : last.action === 'plan' ? ('计划：待登记 ' + (last.unregistered ? last.unregistered.length : 0) + ' / 库内 ' + (last.registered || 0))
                        : '已执行 ' + (last.action || '');

      return h('div', { className: 'ghreg-root' },
        h('style', null, REG_CSS),
        h('h2', { className: 'ghreg-h1' }, '仓库登记文件库'),
        h('p', { className: 'ghreg-lead' },
          '一仓一文件：registry/repos/*.json ＋ index.json。'
          + '目录即契约：别的插件/脚本只读它，就知道有哪些仓库、哪些绑了远端。'
          + '建库要经你同意；本页许可只管建库落盘，和账号登录是两件事。'),

        h(RegSection, { title: '状态' },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 6 } },
            h(RegBadge, { text: label, tone }),
            d && d.dir ? h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, d.dir) : null),
          h('div', { className: 'ghreg-row' }, h('span', { className: 'ghreg-k' }, 'GitHub 账号'),
            h('span', { className: 'ghreg-v' },
              acct === null ? '读取中…'
                : acct.authenticated === true ? ('已登录 · ' + (acct.account || '?'))
                  : acct.authenticated === null ? '检查中…'
                    : '未登录 · 去「GitHub」页取码')),
          h('div', { className: 'ghreg-row' }, h('span', { className: 'ghreg-k' }, '登记库许可'),
            h('span', { className: 'ghreg-v' },
              granted
                ? (consent.grants || []).map((g) => g.root + '（深度 ' + (Number.isInteger(g.depth) ? g.depth : '未知→需重新确认') + '）· ' + (g.via || '?')).join('  |  ')
                : '未许可 · 建库时会先问')),
          h('div', { className: 'ghreg-row' }, h('span', { className: 'ghreg-k' }, '条目'),
            h('span', { className: 'ghreg-v' },
              hasLib ? (rows.length + ' 个 · 远端 ' + (lib.remoteBound || 0) + ' / 无远端 ' + (lib.withoutRemote || 0)) : '未建')),
          h('div', { className: 'ghreg-row' }, h('span', { className: 'ghreg-k' }, '快照'),
            h('span', { className: 'ghreg-v' },
              lib && lib.libraryExists && lib.entries && lib.entries.length
                ? String((lib.entries.slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0] || {}).updatedAt || '—').replace('T', ' ').slice(0, 19)
                : '—')),
          reg.phase === 'unsupported'
            ? h('p', { className: 'ghreg-answer' }, '宿主未重启：/registry 返回 404，重启后刷新本页。')
            : null,

          !granted && d && d.ask
            ? h('div', { className: 'ghreg-ask' },
              h('div', null, h('b', null, '问题：'), ' ', d.ask.question),
              h('div', { className: 'ghreg-answer' }, '同意 → 点「建立登记库」；不同意 → 不落盘。'))
            : null,

          h('div', { className: 'ghreg-actions' },
            h(RegBtn, { onClick: () => post(API + '/registry/build?consent=1', 'build'), disabled: busy === 'build' },
              busy === 'build' ? '建立中…' : (granted ? '重建登记库' : '建立登记库')),
            h(RegBtn, { ghost: true, onClick: () => post(API + '/registry/plan', 'plan'), disabled: busy === 'plan' }, '看计划'),
            h(RegBtn, { ghost: true, onClick: () => post(API + '/registry/build?rescan=1&consent=1', 'rescan'), disabled: busy === 'rescan' || !granted }, '刷新'),
            h(RegBtn, { ghost: true, onClick: () => post(API + '/registry/verify', 'verify'), disabled: busy === 'verify' || !hasLib }, '对账'),
            h(RegBtn, { ghost: true, onClick: () => { setArmPurge(false); post(API + '/registry/revoke', 'revoke'); }, disabled: busy === 'revoke' || !granted }, '撤销许可'),
            armPurge
              ? h(RegBtn, { onClick: () => { setArmPurge(false); post(API + '/registry/purge?confirm=1', 'purge'); }, disabled: busy === 'purge' }, '确认清空')
              : h(RegBtn, { ghost: true, onClick: () => setArmPurge(true), disabled: !hasLib }, '清空…')),
          lastText ? h('p', { className: 'ghreg-answer' }, lastText) : null,
          last && last.ask && last.consentRequired
            ? h('p', { className: 'ghreg-answer' }, '闸门原话：' + last.ask.question)
            : null),

        h(RegSection, { title: '仓库（' + shown.length + (onlyMissing ? ' / ' + rows.length : '') + '）' },
          rows.length
            ? h('div', { className: 'ghreg-actions', style: { marginTop: 0, marginBottom: 6 } },
              h(RegBtn, { ghost: !onlyMissing, onClick: () => setOnlyMissing(false) }, '全部'),
              h(RegBtn, { ghost: onlyMissing, onClick: () => setOnlyMissing(true) }, '只看无远端'))
            : null,
          shown.length
            ? shown.map((e) => h('div', { className: 'ghreg-repo', key: e.slug },
              h('div', { className: 'ghreg-repo-hd' },
                h('b', null, e.name),
                h(RegBadge, {
                  text: remoteText(e),
                  tone: e.hasRemote ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-warn-primary)',
                }),
                e.dirty ? h('span', { style: { fontSize: 11.5, color: 'var(--dsw-alias-state-warn-primary)' } }, e.dirty + ' 处未提交') : null),
              h('div', { className: 'ghreg-repo-path' }, e.path),
              h('div', { className: 'ghreg-repo-meta' },
                h('span', null, (e.branch || '—') + ' · ' + (e.head || '—')),
                e.upstream ? h('span', null, e.upstream + ' ↑' + (e.ahead || 0) + '↓' + (e.behind || 0)) : h('span', null, '无 upstream'),
                h('span', null, String(e.updatedAt || '—').replace('T', ' ').slice(5, 16)))))
            : h('p', { className: 'ghreg-answer', style: { marginTop: 0 } },
              !hasLib ? '库里还没条目：点「建立登记库」。' : '没有匹配的仓库。')),

        h(RegSection, { title: '会话里用' },
          REG_COMMANDS.map((row) => h('div', { className: 'ghreg-cmd', key: row[0] },
            h('div', null, h('code', null, row[0]), h('em', null, row[1])),
            h(RegBtn, { ghost: true, onClick: () => flash('丢进会话：' + row[0]) }, '用法')))),
      );
    }

    

    const wait = (ms) => new Promise((r) => window.setTimeout(r, ms));

    function Panel() {
      const [svc, setSvc] = React.useState({ phase: 'idle' });
      const svcRef = React.useRef(svc);
      svcRef.current = svc;
      const [flow, setFlow] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [copied, setCopied] = React.useState(null);

      // 默认只读缓存（?cached=1）：不进任何子进程、不触发账号检查。
      const load = React.useCallback((opts) => {
        const q = opts && opts.refresh ? '?refresh=1' : '?cached=1';
        return fetch(API + '/state' + q)
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
          .then((j) => { setSvc({ phase: 'ok', data: j }); if (j.lastFlow) setFlow(j.lastFlow); })
          .catch((e) => setSvc({ phase: 'down', message: String((e && e.message) || e) }));
      }, []);

      React.useEffect(() => {
        load();
        let tries = 0;
        const timer = window.setInterval(() => {
          const d0 = svcRef.current.data;
          const ready = Boolean(d0) && !d0.probing
            && (!d0.probe || d0.probe.state === 'ready' || d0.probe.state === 'failed' || d0.probe.state === 'disabled');
          if (ready || tries >= 20) { window.clearInterval(timer); return; }
          tries += 1;
          load();
        }, 1500);
        const onVisible = () => { if (document.visibilityState === 'visible') load(); };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', onVisible);
        return () => {
          window.clearInterval(timer);
          document.removeEventListener('visibilitychange', onVisible);
          window.removeEventListener('focus', onVisible);
        };
      }, [load]);

      const startAuth = () => {
        setBusy(true);
        fetch(API + '/auth/start', { method: 'POST' })
          .then((r) => r.json())
          .then((j) => { setFlow(j); setBusy(false); load({ refresh: true }); })
          .catch((e) => { setFlow({ ok: false, error: String((e && e.message) || e) }); setBusy(false); });
      };

      const flash = (tag, text) => {
        const done = () => { setCopied(tag); window.setTimeout(() => setCopied(null), 1500); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done);
        else done();
      };

      const d = svc.data || null;
      const probing = Boolean(d && (d.probing || d.authenticated === null));
      const authed = Boolean(d && d.authenticated === true);
      const tone = svc.phase !== 'ok' ? 'var(--dsw-alias-state-error-primary)'
        : probing ? 'var(--dsw-alias-label-secondary)'
          : authed ? 'var(--dsw-alias-state-success-primary)'
            : 'var(--dsw-alias-state-warn-primary)';
      const probe = (d && d.probe) || null;
      const label = svc.phase === 'idle' ? '读取中…'
        : svc.phase === 'down' ? '插件接口未就绪'
          : probing
            ? (probe && probe.state === 'disabled' ? '后台检查未启动（DSH_GH_NO_STATE_CHECK=1）'
              : probe && probe.state === 'failed' ? '后台检查失败（点「立即刷新」看错）'
                : '后台检查中…（页面会自动刷新）')
            : authed ? ('已授权 · ' + (d.account || '?')) : '未授权';

      return h('div', { className: 'ghr-root' },
        h('style', null, CSS),
        h('h2', { className: 'ghr-h1' }, 'GitHub 常驻身份'),
        h('p', { className: 'ghr-lead' },
          '一个账号在这个环境里长期有效，供多个项目提交、推送与开 PR 使用。凭据落在 gh 的凭据存储与 git 凭据助手，任何接口都不回显 token。'),

        h(Section, { title: '授权' },
          h('div', { className: 'ghr-steps' },
            STEPS.map((row) => h('div', { className: 'ghr-step', key: row[0] },
              h('i', { className: 'ghr-num' }, row[0]),
              h('div', null, h('b', null, row[1]), h('span', null, '　' + row[2]))))),

          flow && flow.user_code
            ? h('div', { className: 'ghr-codebox' },
              h('div', null,
                h('div', { className: 'ghr-code' }, flow.user_code),
                h('div', { className: 'ghr-when' },
                  '生成于 ' + (flow.at || '刚刚') + (flow.opened && flow.opened.via === 'device-bridge' ? ' · 浏览器已拉起' : ''))),
              h(Btn, { ghost: true, onClick: () => flash('code', flow.user_code) },
                copied === 'code' ? '已复制' : '复制码'))
            : h('div', { className: 'ghr-when', style: { marginTop: 12 } },
              svc.phase === 'down'
                ? '插件接口不可达：确认插件已启用，然后刷新页面。'
                : '点下面的按钮生成一次性码。'),

          h('div', { className: 'ghr-actions' },
            h(Btn, { onClick: startAuth, disabled: busy || svc.phase !== 'ok' },
              busy ? '正在生成…' : (flow && flow.user_code ? '重新生成一次性码' : '生成一次性码')),
            h(Btn, { ghost: true, onClick: () => window.open(DEVICE_URL, '_blank', 'noopener') }, '打开授权页'),
            h(Btn, { ghost: true, onClick: () => load({ refresh: true }) }, '立即刷新'))),

        h(Section, { title: '状态' },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 6 } },
            h(Badge, { text: label, tone }),
            d && d.gh ? h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, d.gh.version || '') : null,
            d && d.snapshotAt ? h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
              '· 快照 ' + String(d.snapshotAt).replace('T', ' ').slice(11, 19)
              + (typeof d.snapshotAgeMs === 'number' && d.snapshotAgeMs > (d.snapshotTtlMs || 90000)
                ? '（' + Math.round(d.snapshotAgeMs / 60000) + ' 分钟前，已过期）' : '')
              + (d.cached === true ? ' · 缓存' : '')) : null),
          h('div', { className: 'ghr-row' }, h('span', { className: 'ghr-k' }, '凭据助手'),
            h('span', { className: 'ghr-v' }, (d && d.credHelper) || '未设置（跑 gh_cli_setup_git）')),
          h('div', { className: 'ghr-row' }, h('span', { className: 'ghr-k' }, 'gh 凭据'),
            h('span', { className: 'ghr-v' }, (d && d.hostsPath) || '~/.config/gh/hosts.yml')),
          h('div', { className: 'ghr-row' }, h('span', { className: 'ghr-k' }, 'gh 来源'),
            h('span', { className: 'ghr-v' }, (d && d.gh && d.gh.layer) || '—')),
          h('div', { className: 'ghr-row' }, h('span', { className: 'ghr-k' }, '版本更新'),
            h('span', { className: 'ghr-v' },
              !d || !d.updates ? '检查中…'
                : d.updates.updateAvailable
                  ? ('可更新：' + (d.updates.current || '?') + ' → ' + (d.updates.latest || '?'))
                  : ('已是最新 ' + (d.updates.current || '?') + (d.updates.error ? '（版本探测失败：' + d.updates.error.slice(0, 40) + '）' : '')))),
          h('p', { className: 'ghr-when', style: { marginTop: 8 } },
            d && d.cached === false
              ? '还没有快照：账号检查在后台跑，跑完这里会自动刷新（也可以点「立即刷新」当场查一次）。'
              : '面板只读缓存快照，打开它不会触发阻塞式检查；快照过期后由插件在后台补查，页面会自动跟上。')),

        h(Section, { title: '在会话里驱动' },
          COMMANDS.map((row) => h('div', { className: 'ghr-cmd', key: row[0] },
            h('div', null, h('code', null, row[0]), h('em', null, row[1])),
            h(Btn, { ghost: true, onClick: () => flash(row[0], row[0]) }, copied === row[0] ? '已复制' : '复制')))),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'github-resident',
          order: 60,
          label: 'GitHub',
        }, Panel));
        // 仓库登记库单独一页：它的「建库许可」与账号凭据是两件互不相干的事。
        // 用词纪律：这一页只说登记库许可，不说「未授权/已授权」，免得看起来像账号掉了。
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'github-repo-registry',
          order: 61,
          label: '仓库登记库',
        }, RegistryPanel));
      },
    };
  },
});
