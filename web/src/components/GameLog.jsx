import { useRef, useEffect } from 'react';

function classifyLog(text) {
  if (!text) return '';
  if (text.includes('赢') || text.includes('获胜') || text.includes('分得')) return 'win';
  if (text.includes('发公共牌') || text.includes('摊牌') || text.includes('发翻牌') || text.includes('发转牌') || text.includes('发河牌')) return 'key';
  return '';
}

export default function GameLog({ logs, title = '对局日志', sidebarOpen, onToggleSidebar }) {
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [logs]);

  const displayLogs = logs?.length ? logs : ['暂无日志'];

  return (
    <div className="log-section">
      <div className="log-header" onClick={onToggleSidebar}>
        <span>{title}</span>
        <span className="tag">{sidebarOpen ? '收起' : '点击展开'}</span>
      </div>
      <div className="log-list" ref={listRef}>
        {displayLogs.map((line, i) => (
          <div key={i} className={`log-item ${classifyLog(line)}`}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
