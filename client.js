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

    const API = 'http://127.0.0.1:31790';
    const DEVICE_URL = 'https://github.com/login/device';
    const STEPS = [
      ['1', '生成码', '点下面的「生成一次性码」——插件在后台起 gh 的设备码流程并拉起浏览器'],
      ['2', '填码', '把页面上出现的那 8 位码填进 GitHub 授权页，确认授权'],
      ['3', '核验', '授权后本页状态会变成「已授权」并显示账号名；再回会话跑一次 gh_cli_setup_git'],
    ];
    const COMMANDS = [
      ['gh_cli_install', 'probe gh，缺则按官方 .deb 安装'],
      ['gh_cli_auth_web', '取一次性码 + 拉起浏览器（等价于本页按钮）'],
      ['gh_cli_status', '核验账号、凭据助手、hosts.yml'],
      ['gh_cli_setup_git', '让 git push 走 gh 的 credential helper'],
      ['gh_repos / gh_sync', '枚举仓库 / 多仓库一次性提交推送'],
      ['gh_pr', '走 REST API 开 PR'],
    ];

    const CSS = [
      '.ghr-root{max-width:680px;color:var(--dsw-alias-label-primary)}',
      '.ghr-root *{box-sizing:border-box}',
      '.ghr-h1{font-size:15px;font-weight:600;margin:0 0 6px}',
      '.ghr-lead{font-size:12.5px;line-height:1.7;color:var(--dsw-alias-label-secondary);margin:0 0 18px}',
      '.ghr-sec{margin:0 0 18px}',
      '.ghr-sec>h3{font-size:11.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);margin:0 0 8px}',
      '.ghr-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:14px 16px}',
      '.ghr-row{display:flex;align-items:baseline;gap:14px;padding:7px 0;font-size:12.5px}',
      '.ghr-row+.ghr-row{border-top:1px solid var(--dsw-alias-border-l1)}',
      '.ghr-k{color:var(--dsw-alias-label-secondary);flex:0 0 118px}',
      '.ghr-v{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all;font-size:12px}',
      '.ghr-btn{font:inherit;font-size:12.5px;line-height:1;padding:8px 14px;border-radius:7px;cursor:pointer;color:var(--dsw-alias-brand-primary);background:transparent;border:1px solid var(--dsw-alias-brand-primary);transition:background .12s}',
      '.ghr-btn:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.ghr-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.ghr-btn.ghr-ghost{color:var(--dsw-alias-label-secondary);border-color:var(--dsw-alias-border-l2)}',
      '.ghr-btn[disabled]{opacity:.45;cursor:default}',
      '.ghr-badge{display:inline-flex;align-items:center;gap:7px;font-size:12px;padding:3px 10px;border-radius:999px;border:1px solid currentColor}',
      '.ghr-dot{width:6px;height:6px;border-radius:999px;background:currentColor;display:inline-block}',
      '.ghr-steps{display:flex;flex-direction:column;gap:10px}',
      '.ghr-step{display:flex;gap:11px;align-items:flex-start;font-size:12.5px;line-height:1.55}',
      '.ghr-num{flex:0 0 20px;height:20px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;font-style:normal;color:var(--dsw-alias-brand-primary);border:1px solid var(--dsw-alias-brand-primary)}',
      '.ghr-step b{font-weight:600}',
      '.ghr-step span{color:var(--dsw-alias-label-secondary)}',
      '.ghr-codebox{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:12px;padding:12px 14px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:1px dashed var(--dsw-alias-border-l2)}',
      '.ghr-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:22px;font-weight:600;letter-spacing:.16em;color:var(--dsw-alias-label-primary)}',
      '.ghr-when{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:4px}',
      '.ghr-cmd{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;font-size:12px}',
      '.ghr-cmd+.ghr-cmd{border-top:1px solid var(--dsw-alias-border-l1)}',
      '.ghr-cmd code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-primary)}',
      '.ghr-cmd em{font-style:normal;color:var(--dsw-alias-label-secondary);margin-left:9px}',
      '.ghr-actions{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:13px}',
    ].join('');

    const wait = (ms) => new Promise((r) => window.setTimeout(r, ms));

    function Badge({ text, tone }) {
      return h('span', { className: 'ghr-badge', style: { color: tone } }, h('i', { className: 'ghr-dot' }), text);
    }

    function Btn({ children, onClick, ghost, disabled }) {
      return h('button', {
        type: 'button', onClick, disabled: Boolean(disabled),
        className: ghost ? 'ghr-btn ghr-ghost' : 'ghr-btn',
      }, children);
    }

    function Section({ title, children }) {
      return h('section', { className: 'ghr-sec' }, h('h3', null, title), h('div', { className: 'ghr-card' }, children));
    }

    function Panel() {
      const [svc, setSvc] = React.useState({ phase: 'idle' });
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

      React.useEffect(() => { load(); }, [load]);

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
      const label = svc.phase === 'idle' ? '读取中…'
        : svc.phase === 'down' ? '插件接口未就绪'
          : probing ? '后台检查中…（未触发）'
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
              ? '还没有快照：账号检查在后台跑，跑完这里会显示；也可以点「立即刷新」当场查一次。'
              : '面板只读缓存快照，打开它不会触发任何检查；需要重查时点下面的「立即刷新」。')),

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
      },
    };
  },
});
