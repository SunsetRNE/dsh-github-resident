// tests/lib/identity-env-stub.js —— 门禁夹具用的「身份 env 取值口」桩。
//
// 真件在 src/host/index.js：identityEnvFor(程序名, 参数, 底座 env) → 能直接交给 spawn 的那份 env。
// 它是宿主服务位（ctx.get('ghResolver').identityEnv）的取值口；服务位缺席时如实回底座，不凭空造环境。
// 三个执行出口（platformChannel / repoKeys / versionControl）都无条件 await 它，所以门禁直连
// createPlatformChannel / createRepoKeys 时必须补上这一格，否则装配期就抛「identityEnvFor is not a function」。
//
// 门禁没有宿主服务位，用这个桩顶上：不戴工牌，原样把底座交回去（与真件「服务位缺席 → 回底座」同一条规矩）。
// 于是「起了一条外部命令」这件事照旧发生，门禁量的是计数 / 耗时 / 日志顺序，不是身份。
export async function identityEnvForStub(program, args, base) {
  return (base && typeof base === 'object') ? base : undefined
}
