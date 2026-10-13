/**
 * tests/merge/host/_fixture-hang.mjs —— **故意挂死**的夹具（不是门禁：文件名不匹配 `*.test.mjs`，
 * 不会被 `run.mjs` 自动发现）。只给 `env-matrix.test.mjs` 用：证明矩阵的每格**有硬上界** ——
 * 子进程不退时会被 SIGKILL 掉并如实记成红灯，而不是让整条矩阵无限等下去。
 * （这个仓踩过「子进程不退 → 父进程无限等」的坑，所以这条判据要有。）
 */
console.log('__FIXTURE_HANG__ 开始挂死（矩阵应当在超时后杀掉我）')
setInterval(() => {}, 1 << 30)
