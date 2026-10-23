/**
 * dsh-xxx — Host 半边。
 *
 * 只做 UI 的插件可以保持这个文件为空实现；Client 半边由 client.js 承担。
 *
 * 约束（均已按 DSH 0.2.x 的 bundle 契约核对）：
 *   - 导出 `export function apply(ctx, config)`，或默认导出一个 service class，二者不可混用。
 *   - 所有注册都放进 apply，用 ctx.effect / ctx.on 并返回清理函数，保证卸载无残留。
 *   - 可选依赖写进 inject 或 ctx.inject([...], ...)，让插件在缺少该 service 的 profile 里
 *     保持不激活，而不是抛错。
 *   - 需要配置时 export const Config，并在 cordis.patch.yml 的 config 里给默认值。
 *   - 日志只记事件与错误，不记消息内容、文件内容或凭据。
 */

/** 硬依赖的 service key；没有依赖就留空数组。 */
export const inject = []

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Record<string, unknown>} config
 */
export function apply(ctx, config) {
  // 示例：注册一个随插件卸载而释放的效果。
  // ctx.effect(() => {
  //   const dispose = ctx.someService?.register?.({ /* ... */ })
  //   return () => dispose?.()
  // }, 'dsh-xxx: something')
}
