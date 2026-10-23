/**
 * dsh-xxx — Web 半边（可选）。
 *
 * 契约（按当前 DSH 的 Client 模块加载方式）：
 *   - 本文件是经典脚本，浏览器恰好调用一次 window.__ModuleLoader__.load。
 *   - `id` 必须等于 package.json 的 name，否则装配不上。
 *   - React 由浏览器模块表提供，不要额外打包第二份。
 *   - 不要在 document.body 追加第二个应用，不要替换 app root，不要读别的插件的 DOM。
 *   - 颜色只用 --dsw-alias-* / --dsw-specific-* 主题 token，明暗自动适配。
 *   - 所有注册都放进 apply 并用 ctx.effect 包裹，返回清理函数。
 */

window.__ModuleLoader__.load({
  id: 'dsh-xxx',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** 组件：示例占位，替换成真实界面。 */
    function Placeholder(props) {
      return h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 8px',
            fontSize: 12,
            color: 'var(--dsw-alias-label-secondary)',
          },
        },
        'dsh-xxx',
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // 示例：在输入框下方注册一个常驻条目。
        // slot 名与注册参数请先用 cordis_inspect_query(Slots.listSubTree) 复核。
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            { name: 'conversation.composer.dock', id: 'dsh-xxx', order: 50 },
            Placeholder,
          ),
        )
      },
    }
  },
})
