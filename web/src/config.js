// 默认 WebSocket 服务器地址
// 开发环境使用本地地址，部署时修改为实际服务器地址
export const DEFAULT_WS_URL =
  import.meta.env.VITE_WS_URL || `ws://${location.hostname}:3001`;
