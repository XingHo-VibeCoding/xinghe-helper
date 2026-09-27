// 异步按钮:统一的四态(空闲/加载中/成功/失败回落空闲)
// - loading:文字换成 loading 文案 + 转圈图标,disabled + aria-busy,连点无效
// - success:短暂显示 success 文案(绿色),由调用方在 1.2s 左右后把 status 调回 idle
// - 失败不是按钮的独立外观:调用方把 status 调回 idle,并用红条(form-alert)给人话提示
// 纯展示组件,不持有业务逻辑;状态由页面持有,便于以后把 setTimeout 模拟换成真实请求
export default function AsyncButton({
  status = 'idle', // 'idle' | 'loading' | 'success'
  idle,
  loading = '处理中…',
  success = '完成 ✓',
  className = '',
  type = 'button',
  onClick,
  disabled = false,
  ...rest
}) {
  const text = status === 'loading' ? loading : status === 'success' ? success : idle
  const cls = [
    'async-btn',
    status === 'loading' ? 'async-loading' : '',
    status === 'success' ? 'async-success' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type={type}
      className={cls}
      onClick={onClick}
      disabled={disabled || status === 'loading' || status === 'success'}
      aria-busy={status === 'loading'}
      {...rest}
    >
      {status === 'loading' && <span className="btn-spinner" aria-hidden="true" />}
      {text}
    </button>
  )
}
