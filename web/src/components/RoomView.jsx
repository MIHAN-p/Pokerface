import { useState, useCallback } from 'react';
import PokerTable from './PokerTable.jsx';
import ActionPanel from './ActionPanel.jsx';
import GameLog from './GameLog.jsx';

export default function RoomView({ poker }) {
  const { snapshot, send, disconnect } = poker;
  const { room, you, game } = snapshot;

  const [sidebarOpen, setSidebarOpen] = useState(
    typeof window !== 'undefined' ? window.innerWidth > 980 : true
  );
  const [aiModalSeat, setAiModalSeat] = useState(null);
  const [showResetModal, setShowResetModal] = useState(false);
  const [toastMsg, setToastMsg] = useState(null);

  const isHost = you?.isHost;
  const isWaiting = room.status === 'waiting';
  const isSpectating = you?.seatIndex === null || you?.seatIndex === undefined;
  const handFinished = game?.handFinished;
  const config = room.config;

  const showToast = useCallback((msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 1600);
  }, []);

  // === Action handlers ===
  const handleSitDown = useCallback((seatIndex) => {
    send({ type: 'sit_down', seatIndex });
  }, [send]);

  const handleLeaveSeat = useCallback(() => {
    send({ type: 'leave_seat' });
  }, [send]);

  const handleAddBot = useCallback((seatIndex) => {
    setAiModalSeat(seatIndex);
  }, []);

  const handleConfirmAddBot = useCallback((difficulty) => {
    if (aiModalSeat !== null) {
      send({ type: 'add_bot', seatIndex: aiModalSeat, difficulty });
    }
    setAiModalSeat(null);
  }, [aiModalSeat, send]);

  const handleRemoveBot = useCallback((seatIndex) => {
    send({ type: 'remove_bot', seatIndex });
  }, [send]);

  const handleStartGame = useCallback(() => {
    send({ type: 'start_game' });
  }, [send]);

  const handleNextHand = useCallback(() => {
    send({ type: 'next_hand' });
  }, [send]);

  const handleResetGame = useCallback(() => {
    send({ type: 'reset_game' });
    setShowResetModal(false);
  }, [send]);

  const handleAction = useCallback((msg) => {
    send(msg);
  }, [send]);

  const handleCopyCode = useCallback(() => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(room.roomCode).then(() => showToast('房间码已复制'));
    } else {
      showToast('房间码：' + room.roomCode);
    }
  }, [room.roomCode, showToast]);

  const handleLeaveRoom = useCallback(() => {
    disconnect();
  }, [disconnect]);

  // === Computed values ===
  const occupiedSeats = (room.seats || []).filter((s) => s.type !== 'empty');
  const occupiedCount = occupiedSeats.length;
  const humanCount = occupiedSeats.filter((s) => s.type === 'human').length;
  const aiCount = occupiedSeats.filter((s) => s.type === 'bot').length;
  const emptyCount = (room.seats || []).length - occupiedCount;

  // === Top strip tags ===
  const renderTopStrip = () => {
    const tags = [];
    if (isSpectating) {
      tags.push(<span key="spec" className="tag blue">旁观中</span>);
    } else if (isWaiting) {
      tags.push(<span key="wait" className="tag green">等待中</span>);
    } else if (handFinished) {
      tags.push(<span key="fin" className="tag green">手牌结束</span>);
    }

    if (game && !isWaiting) {
      tags.push(<span key="hand" className="tag gold">第 {game.handNo} 手</span>);
      tags.push(<span key="stage" className="tag">{game.stage}</span>);
      if (!handFinished && game.currentBet > 0) {
        tags.push(<span key="bet" className="tag">当前注 {game.currentBet}</span>);
      }
      if (!handFinished && game.actionSeatIndex === you?.seatIndex && !isSpectating) {
        tags.push(<span key="turn" className="tag green">轮到你</span>);
      }
    }

    if (isWaiting) {
      tags.push(<span key="occ" className="tag">{occupiedCount}/{config.playerCount} 已入座</span>);
      if (isHost) tags.push(<span key="host" className="tag gold">房主视角</span>);
    }

    if (handFinished && game?.lastHandResult) {
      const isWinner = game.lastHandResult.winners?.includes(you?.seatIndex);
      if (isWinner) {
        tags.push(<span key="win" className="tag gold">你赢得 {game.lastHandResult.pot}</span>);
      }
    }

    return (
      <header className="top-strip">
        <div className="state-line">{tags}</div>
        <div className="room-code">
          <span>房间码</span>
          <span className="code">{room.roomCode}</span>
          <button className="copy" onClick={handleCopyCode}>复制</button>
        </div>
      </header>
    );
  };

  // === Bottom panel ===
  const renderBottomPanel = () => {
    if (isWaiting) {
      return (
        <footer className="action-dock">
          <div className="host-actions">
            <div className="hint">
              {isHost
                ? `点击开始将自动补齐 AI 至 ${config.playerCount} 人。当前 ${humanCount} 真人 + ${aiCount} AI。`
                : '等待房主开始游戏…'}
            </div>
            {isHost && (
              <div className="host-buttons">
                <button className="btn red" onClick={() => setShowResetModal(true)}>重置牌局</button>
                <button
                  className="btn primary"
                  disabled={humanCount < 1}
                  onClick={handleStartGame}
                >
                  开始游戏
                </button>
              </div>
            )}
          </div>
        </footer>
      );
    }

    return (
      <ActionPanel
        game={game}
        you={you}
        isHost={isHost}
        isSpectating={isSpectating}
        onAction={handleAction}
        onNextHand={handleNextHand}
        onResetGame={() => setShowResetModal(true)}
        actionDeadline={snapshot.actionDeadline}
        config={config}
      />
    );
  };

  // === Sidebar ===
  const renderSidebar = () => {
    return (
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <button className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="收起侧栏">✕</button>
        {/* Room info (waiting only) or connection info (playing) */}
        <div className="side-section">
          {isWaiting ? (
            <>
              <div className="side-title">
                <span>房间信息</span>
                <span className="tag green">等待中</span>
              </div>
              <div className="info-list">
                <div className="info-row"><span>盲注</span><strong>{config.smallBlind} / {config.bigBlind}</strong></div>
                <div className="info-row"><span>初始筹码</span><strong>{config.initialStack}</strong></div>
                <div className="info-row"><span>水下模式</span><strong>{config.underwater ? '开启' : '关闭'}</strong></div>
                <div className="info-row"><span>行动超时</span><strong>{config.actionTimeoutSeconds}s</strong></div>
              </div>
            </>
          ) : (
            <>
              <div className="side-title">
                <span>连接</span>
                <span className="tag green">{poker.connectionState === 'connected' ? '已连接' : poker.connectionState}</span>
              </div>
              <div className="info-list">
                <div className="info-row"><span>重连码</span><strong>{you?.reconnectCode || '—'}</strong></div>
                {!isSpectating && (
                  <div className="info-row"><span>你的座位</span><strong>#{you?.seatIndex}</strong></div>
                )}
                {isSpectating && (
                  <div className="info-row"><span>你的状态</span><strong>旁观</strong></div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Logs */}
        <GameLog
          logs={game?.logs}
          title={isWaiting ? '房间日志' : '对局日志'}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        />

        {/* Leave room button */}
        <div className="side-section" style={{ borderBottom: '0' }}>
          <button className="btn ghost small" style={{ width: '100%' }} onClick={handleLeaveRoom}>
            退出房间
          </button>
        </div>
      </aside>
    );
  };

  return (
    <section className={`room ${sidebarOpen ? '' : 'no-sidebar'}`}>
      <div className="room-main">
        {renderTopStrip()}
        <PokerTable
          mode={isWaiting ? 'waiting' : 'playing'}
          room={room}
          you={you}
          game={game}
          onSitDown={handleSitDown}
          onLeaveSeat={handleLeaveSeat}
          onAddBot={handleAddBot}
          onRemoveBot={handleRemoveBot}
        />
        {renderBottomPanel()}
      </div>
      {renderSidebar()}

      {/* AI difficulty modal */}
      {aiModalSeat !== null && (
        <div className="modal" onClick={() => setAiModalSeat(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h2>添加 AI</h2>
            <p>选择难度后会向服务端发送 add_bot，并携带目标座位号和难度。</p>
            <div className="difficulty">
              <button className="btn ghost" onClick={() => handleConfirmAddBot('简单')}>简单</button>
              <button className="btn primary" onClick={() => handleConfirmAddBot('普通')}>普通</button>
              <button className="btn gold" onClick={() => handleConfirmAddBot('困难')}>困难</button>
            </div>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setAiModalSeat(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* Reset confirmation modal */}
      {showResetModal && (
        <div className="modal" onClick={() => setShowResetModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h2>重置牌局</h2>
            <p>确定重置牌局？所有真人筹码会恢复初始值，水下状态清空，AI 座位移除，房间回到等待状态。</p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setShowResetModal(false)}>取消</button>
              <button className="btn red" onClick={handleResetGame}>确定重置</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toastMsg && <div className="toast">{toastMsg}</div>}
      {/* Floating button to re-open sidebar when collapsed (desktop) */}
      {!sidebarOpen && (
        <button className="sidebar-fab" onClick={() => setSidebarOpen(true)}>
          <span className="fab-icon">☰</span>
          <span className="fab-label">信息</span>
        </button>
      )}
    </section>
  );
}
