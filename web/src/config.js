// 默认 WebSocket 服务器地址
// 开发环境使用本地地址，部署时修改为实际服务器地址
// 通过 nginx /ws 端口转发 WebSocket，统一走 80 端口
// 部署时可通过环境变量 VITE_WS_URL 覆盖
const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
export const DEFAULT_WS_URL =
  import.meta.env.VITE_WS_URL || `${protocol}//${location.hostname}/ws`;
