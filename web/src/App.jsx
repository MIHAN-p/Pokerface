import { usePokerSocket } from './hooks/usePokerSocket.js';
import Lobby from './components/Lobby.jsx';
import RoomView from './components/RoomView.jsx';

export default function App() {
  const poker = usePokerSocket();
  const { snapshot, connectionState, error } = poker;

  const showOverlay = connectionState === 'reconnecting' ||
    (connectionState === 'disconnected' && snapshot);

  return (
    <>
      {snapshot ? (
        <RoomView poker={poker} />
      ) : (
        <Lobby poker={poker} />
      )}

      {error && (
        <div className="toast">{error}</div>
      )}

      {showOverlay && (
        <div className="conn-overlay">
          <div>
            {connectionState === 'reconnecting' ? '连接已断开，正在重连…' : '连接已断开'}
            <div className="sub">
              {connectionState === 'reconnecting' ? '将自动恢复牌局状态' : '请检查网络后刷新页面'}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
