import { useState } from 'react';

export default function Lobby({ poker }) {
  const [tab, setTab] = useState('create');
  const [formError, setFormError] = useState(null);

  // Create form state
  const [createName, setCreateName] = useState('');
  const [playerCount, setPlayerCount] = useState(6);
  const [initialStack, setInitialStack] = useState(1000);
  const [smallBlind, setSmallBlind] = useState(5);
  const [bigBlind, setBigBlind] = useState(10);
  const [underwater, setUnderwater] = useState(true);
  const [actionTimeout, setActionTimeout] = useState(120);
  const [difficulty, setDifficulty] = useState('普通');

  // Join form state
  const [joinCode, setJoinCode] = useState('');
  const [joinName, setJoinName] = useState('');

  const handleCreate = (e) => {
    e.preventDefault();
    setFormError(null);
    if (!createName.trim()) {
      setFormError('请输入昵称');
      return;
    }
    poker.connect({
      type: 'create_room',
      displayName: createName.trim(),
      config: {
        playerCount: Number(playerCount),
        initialStack: Number(initialStack),
        smallBlind: Number(smallBlind),
        bigBlind: Number(bigBlind),
        underwater,
        actionTimeoutSeconds: Number(actionTimeout),
        difficulty,
      },
    });
  };

  const handleJoin = (e) => {
    e.preventDefault();
    setFormError(null);
    if (!joinCode.trim()) {
      setFormError('请输入房间码');
      return;
    }
    if (!joinName.trim()) {
      setFormError('请输入昵称');
      return;
    }
    poker.connect({
      type: 'join_room',
      roomCode: joinCode.trim(),
      displayName: joinName.trim(),
    });
  };

  return (
    <main className="lobby">
      <section className="lobby-panel">
        <div className="lobby-kicker">Pokerface Online</div>
        <h1>联机对战</h1>
        <p className="lobby-copy">创建一个房间，发给好友 6 位房间码；或输入房间码加入。</p>

        <div className="tabs" role="tablist">
          <button
            className={`tab ${tab === 'create' ? 'active' : ''}`}
            type="button"
            onClick={() => setTab('create')}
          >
            创建房间
          </button>
          <button
            className={`tab ${tab === 'join' ? 'active' : ''}`}
            type="button"
            onClick={() => setTab('join')}
          >
            加入房间
          </button>
        </div>

        {formError && <div className="toast" style={{ position: 'static', transform: 'none', marginBottom: '12px' }}>{formError}</div>}

        {tab === 'create' ? (
          <form className="form" onSubmit={handleCreate}>
            <label>
              你的昵称
              <input value={createName} placeholder="输入昵称" onChange={(e) => setCreateName(e.target.value)} />
            </label>
            <div className="form-grid">
              <label>
                座位数
                <select value={playerCount} onChange={(e) => setPlayerCount(Number(e.target.value))}>
                  {[2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
              <label>
                初始筹码
                <input type="number" value={initialStack} min="100" onChange={(e) => setInitialStack(e.target.value)} />
              </label>
              <label>
                小盲注
                <input type="number" value={smallBlind} min="1" onChange={(e) => setSmallBlind(e.target.value)} />
              </label>
              <label>
                大盲注
                <input type="number" value={bigBlind} min="2" onChange={(e) => setBigBlind(e.target.value)} />
              </label>
              <label>
                AI 难度
                <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                  <option value="简单">简单</option>
                  <option value="普通">普通</option>
                  <option value="困难">困难</option>
                </select>
              </label>
              <label>
                行动超时
                <input type="number" value={actionTimeout} min="15" onChange={(e) => setActionTimeout(e.target.value)} />
              </label>
            </div>
            <label>
              水下模式
              <select value={underwater ? 'on' : 'off'} onChange={(e) => setUnderwater(e.target.value === 'on')}>
                <option value="on">开启</option>
                <option value="off">关闭</option>
              </select>
            </label>
            <button className="btn primary" type="submit" disabled={poker.connectionState === 'connecting'}>
              {poker.connectionState === 'connecting' ? '连接中…' : '创建房间'}
            </button>
          </form>
        ) : (
          <form className="form" onSubmit={handleJoin}>
            <label>
              房间码
              <input
                value={joinCode}
                inputMode="numeric"
                maxLength={6}
                placeholder="6 位数字"
                onChange={(e) => setJoinCode(e.target.value)}
              />
            </label>
            <label>
              你的昵称
              <input value={joinName} placeholder="输入昵称" onChange={(e) => setJoinName(e.target.value)} />
            </label>
            <button className="btn primary" type="submit" disabled={poker.connectionState === 'connecting'}>
              {poker.connectionState === 'connecting' ? '连接中…' : '加入房间'}
            </button>
            <div className="server-note">
              <span>断线后重新加入</span>
              <strong>输入相同昵称即可恢复</strong>
            </div>
          </form>
        )}
      </section>

      <section className="lobby-visual" aria-hidden="true">
        <div className="mini-table">
          <div className="mini-card-row">
            <div className="card red">
              <div>
                <span className="rank">A</span>
                <br />
                <span className="suit">♥</span>
              </div>
            </div>
            <div className="card">
              <div>
                <span className="rank">K</span>
                <br />
                <span className="suit">♠</span>
              </div>
            </div>
            <div className="card ghost" />
            <div className="card ghost" />
            <div className="card ghost" />
          </div>
        </div>
        <div className="lobby-status">
          <strong>两步进入牌桌</strong>
          <span>创建或加入后直接进入房间状态；等待中在牌桌上选座，对战中同一位置进入操作面板。</span>
        </div>
      </section>
    </main>
  );
}
