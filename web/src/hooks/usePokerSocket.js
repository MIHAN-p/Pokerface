import { useRef, useState, useCallback, useEffect } from 'react';
import { DEFAULT_WS_URL } from '../config.js';

export function usePokerSocket() {
  const wsRef = useRef(null);
  const reconnectCodeRef = useRef(null);
  const pingTimerRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const pendingMessageRef = useRef(null);

  const [snapshot, setSnapshot] = useState(null);
  const [connectionState, setConnectionState] = useState('idle');
  const [error, setError] = useState(null);
  const [roomCode, setRoomCode] = useState(null);

  const clearTimers = useCallback(() => {
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const startPing = useCallback(() => {
    if (pingTimerRef.current) clearInterval(pingTimerRef.current);
    pingTimerRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, 15000);
  }, []);

  const sendRaw = useCallback((ws, msg) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }, []);

  const handleMessage = useCallback((data) => {
    const msg = typeof data === 'string' ? JSON.parse(data) : data;

    switch (msg.type) {
      case 'welcome':
        // Connection established, send pending message if any
        if (pendingMessageRef.current) {
          sendRaw(wsRef.current, pendingMessageRef.current);
          pendingMessageRef.current = null;
        }
        break;

      case 'room_created':
        setRoomCode(msg.roomCode);
        if (msg.reconnectCode) reconnectCodeRef.current = msg.reconnectCode;
        break;

      case 'joined_room':
        setRoomCode(msg.roomCode);
        if (msg.reconnectCode) reconnectCodeRef.current = msg.reconnectCode;
        break;

      case 'room_snapshot':
        setSnapshot(msg);
        if (msg.you?.reconnectCode) {
          reconnectCodeRef.current = msg.you.reconnectCode;
        }
        break;

      case 'action_error':
        setError(msg.message);
        setTimeout(() => setError(null), 3000);
        break;

      case 'pong':
        break;

      default:
        break;
    }
  }, [sendRaw]);

  const connectInternal = useCallback((url, isReconnect = false) => {
    clearTimers();

    const ws = new WebSocket(url);
    wsRef.current = ws;
    setConnectionState(isReconnect ? 'reconnecting' : 'connecting');

    ws.onopen = () => {
      setConnectionState('connected');
      reconnectAttemptsRef.current = 0;
      startPing();

      if (isReconnect && reconnectCodeRef.current && roomCode) {
        // Reconnect to existing room
        sendRaw(ws, {
          type: 'join_room',
          roomCode,
          reconnectCode: reconnectCodeRef.current,
          displayName: '玩家',
        });
      }
    };

    ws.onmessage = (event) => {
      try {
        handleMessage(event.data);
      } catch (err) {
        console.error('Failed to parse message:', err);
      }
    };

    ws.onclose = () => {
      clearTimers();
      wsRef.current = null;

      // Only attempt reconnection if we were in a room
      if (roomCode) {
        setConnectionState('reconnecting');
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
        reconnectAttemptsRef.current += 1;
        reconnectTimerRef.current = setTimeout(() => {
          connectInternal(url, true);
        }, delay);
      } else {
        setConnectionState('disconnected');
      }
    };

    ws.onerror = () => {
      // Error is handled by onclose
    };
  }, [clearTimers, startPing, sendRaw, handleMessage, roomCode]);

  const connect = useCallback((message) => {
    pendingMessageRef.current = message;
    connectInternal(DEFAULT_WS_URL, false);
  }, [connectInternal]);

  const send = useCallback((msg) => {
    return sendRaw(wsRef.current, msg);
  }, [sendRaw]);

  const disconnect = useCallback(() => {
    clearTimers();
    reconnectCodeRef.current = null;
    pendingMessageRef.current = null;
    setSnapshot(null);
    setRoomCode(null);
    setError(null);
    setConnectionState('idle');
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }, [clearTimers]);

  useEffect(() => {
    return () => {
      clearTimers();
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [clearTimers]);

  return {
    snapshot,
    connectionState,
    error,
    roomCode,
    send,
    connect,
    disconnect,
  };
}
