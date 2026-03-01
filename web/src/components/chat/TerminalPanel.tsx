import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { EyeOff, Trash2 } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import { wsManager } from '../../api/ws';
import { useI18n } from '../../i18n';

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected';

interface TerminalPanelProps {
  groupJid: string;
  visible: boolean;
  onHide?: () => void;
  onDelete?: () => void;
}

export function TerminalPanel({
  groupJid,
  visible,
  onHide,
  onDelete,
}: TerminalPanelProps) {
  const { t } = useI18n();
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const visibleRef = useRef<boolean>(visible);
  const [connState, setConnState] = useState<ConnectionState>('idle');
  const connStateRef = useRef<ConnectionState>('idle');
  const syncConnState = (state: ConnectionState) => {
    connStateRef.current = state;
    setConnState(state);
  };
  const legacyWorkspaceNotRunning = '\u5de5\u4f5c\u533a\u672a\u8fd0\u884c';
  const legacyWorkspaceStarting = '\u5de5\u4f5c\u533a\u542f\u52a8\u4e2d';

  useEffect(() => {
    visibleRef.current = visible;
    if (!visible) return;
    // Delay fit until after the CSS height transition (200ms) completes,
    // otherwise FitAddon computes 0x0 dimensions during the animation.
    const timer = setTimeout(() => {
      if (!fitAddonRef.current || !xtermRef.current) return;
      fitAddonRef.current.fit();
      xtermRef.current.focus();
      if (connStateRef.current === 'connected') {
        const { cols, rows } = xtermRef.current;
        wsManager.send({ type: 'terminal_resize', chatJid: groupJid, cols, rows });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [visible, groupJid]);

  useEffect(() => {
    if (!termRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      lineHeight: 1.15,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      scrollback: 5000,
      convertEol: true,
      theme: {
        background: '#1a1b26',
        foreground: '#a9b1d6',
        cursor: '#c0caf5',
        selectionBackground: '#33467c',
        black: '#32344a',
        red: '#f7768e',
        green: '#9ece6a',
        yellow: '#e0af68',
        blue: '#7aa2f7',
        magenta: '#ad8ee6',
        cyan: '#449dab',
        white: '#787c99',
        brightBlack: '#444b6a',
        brightRed: '#ff7a93',
        brightGreen: '#b9f27c',
        brightYellow: '#ff9e64',
        brightBlue: '#7da6ff',
        brightMagenta: '#bb9af7',
        brightCyan: '#0db9d7',
        brightWhite: '#acb0d0',
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.open(termRef.current);

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Fit terminal to container — delay to ensure DOM layout is stable
    setTimeout(() => {
      fitAddon.fit();
    }, 100);

    const sendStartTerminal = () => {
      const cols = terminal.cols;
      const rows = terminal.rows;
      wsManager.send({ type: 'terminal_start', chatJid: groupJid, cols, rows });
    };

    const requestStartTerminal = () => {
      syncConnState('connecting');
      if (wsManager.isConnected()) {
        sendStartTerminal();
      } else {
        wsManager.connect();
      }
    };

    // Listen for WebSocket messages.
    const unsubOutput = wsManager.on('terminal_output', (data: any) => {
      if (data.chatJid === groupJid) {
        terminal.write(data.data);
      }
    });

    const unsubStarted = wsManager.on('terminal_started', (data: any) => {
      if (data.chatJid === groupJid) {
        syncConnState('connected');
      }
    });

    const unsubStopped = wsManager.on('terminal_stopped', (data: any) => {
      if (data.chatJid === groupJid) {
        syncConnState('disconnected');
        terminal.write(`\r\n\x1b[33m[${data.reason || t('chat.terminalPanel.messages.terminalDisconnected')}]\x1b[0m\r\n`);
      }
    });

    const unsubError = wsManager.on('terminal_error', (data: any) => {
      if (data.chatJid === groupJid) {
        syncConnState('disconnected');
        // Show a more friendly hint for workspace start-up related errors.
        const rawError = String(data.error || '');
        const workspaceNotRunning = rawError.includes(legacyWorkspaceNotRunning)
          || /workspace.+not running/i.test(rawError);
        const workspaceStarting = rawError.includes(legacyWorkspaceStarting)
          || /workspace.+starting/i.test(rawError);
        if (workspaceNotRunning) {
          terminal.write(`\r\n\x1b[33m[${t('chat.terminalPanel.messages.workspaceStarting')}]\x1b[0m\r\n`);
          terminal.write(`\r\n${t('chat.terminalPanel.messages.workspaceAutoStartHint')}\r\n`);
        } else if (workspaceStarting) {
          terminal.write(`\r\n\x1b[33m[${t('chat.terminalPanel.messages.workspaceStarting')}]\x1b[0m\r\n`);
          terminal.write(`\r\n${t('chat.terminalPanel.messages.workspaceStillStartingHint')}\r\n`);
        } else {
          terminal.write(`\r\n\x1b[31m[${t('chat.terminalPanel.messages.errorPrefix', { error: data.error })}]\x1b[0m\r\n`);
        }
      }
    });

    const unsubWsConnected = wsManager.on('connected', () => {
      if (connStateRef.current !== 'connected') {
        syncConnState('connecting');
        sendStartTerminal();
      }
    });

    const unsubWsDisconnected = wsManager.on('disconnected', () => {
      syncConnState('disconnected');
      terminal.write(`\r\n\x1b[33m[${t('chat.terminalPanel.messages.wsDisconnected')}]\x1b[0m\r\n`);
    });

    // User input -> WebSocket (send only after connected).
    const onDataDisposable = terminal.onData((data) => {
      if (connStateRef.current === 'connected') {
        wsManager.send({ type: 'terminal_input', chatJid: groupJid, data });
      }
    });

    // Resize observer tracks container size changes.
    const resizeObserver = new ResizeObserver(() => {
      if (!visibleRef.current) return;
      requestAnimationFrame(() => {
        if (fitAddonRef.current && xtermRef.current) {
          fitAddonRef.current.fit();
          if (connStateRef.current === 'connected') {
            const { cols, rows } = xtermRef.current;
            wsManager.send({ type: 'terminal_resize', chatJid: groupJid, cols, rows });
          }
        }
      });
    });
    resizeObserver.observe(termRef.current);

    // Initial connect attempt. If WS is not ready, connected event triggers terminal_start.
    requestStartTerminal();

    // Cleanup
    return () => {
      resizeObserver.disconnect();
      onDataDisposable.dispose();
      unsubOutput();
      unsubStarted();
      unsubStopped();
      unsubError();
      unsubWsConnected();
      unsubWsDisconnected();
      if (wsManager.isConnected()) {
        wsManager.send({ type: 'terminal_stop', chatJid: groupJid });
      }
      terminal.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [groupJid]);

  return (
    <div className="h-full flex flex-col terminal-panel">
      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#1a1b26] border-b border-[#30364f] text-xs">
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${
            connState === 'connected' ? 'bg-green-400' :
            connState === 'connecting' ? 'bg-yellow-400 animate-pulse' :
            'bg-[#4a5170]'
          }`} />
          <span className="text-[#8b94b8]">
            {connState === 'connected'
              ? t('chat.terminalPanel.status.connected')
              : connState === 'connecting'
                ? t('chat.terminalPanel.status.connecting')
                : connState === 'disconnected'
                  ? t('chat.terminalPanel.status.disconnected')
                  : t('chat.terminalPanel.status.idle')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {connState === 'disconnected' && (
            <button
              onClick={() => {
                syncConnState('connecting');
                if (wsManager.isConnected()) {
                  const cols = xtermRef.current?.cols || 80;
                  const rows = xtermRef.current?.rows || 24;
                  wsManager.send({
                    type: 'terminal_start',
                    chatJid: groupJid,
                    cols,
                    rows,
                  });
                } else {
                  wsManager.connect();
                }
              }}
              className="text-brand-400 hover:text-brand-300 transition-colors cursor-pointer"
            >
              {t('chat.terminalPanel.reconnect')}
            </button>
          )}
          {onHide && (
            <button
              onClick={onHide}
              className="p-1 rounded hover:bg-white/10 text-[#8b94b8] hover:text-[#d4dbf2] transition-colors cursor-pointer"
              aria-label={t('chat.terminalPanel.hide')}
              title={t('chat.terminalPanel.hide')}
            >
              <EyeOff className="w-3.5 h-3.5" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={onDelete}
              className="p-1 rounded hover:bg-red-900/30 text-[#8b94b8] hover:text-red-300 transition-colors cursor-pointer"
              aria-label={t('chat.terminalPanel.delete')}
              title={t('chat.terminalPanel.delete')}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      {/* Terminal container */}
      <div ref={termRef} className="flex-1 min-h-0 overflow-hidden bg-[#1a1b26]" />
    </div>
  );
}
