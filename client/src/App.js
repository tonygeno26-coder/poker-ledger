import React, { useState, useEffect } from 'react';
import GameEditor from './components/GameEditor';
import History from './components/History';
import Players from './components/Players';
import Leaderboard from './components/Leaderboard';

const tabs = ['🃏 Game', '📋 History', '👥 Players', '🏆 Leaderboard'];

export default function App() {
  const [tab, setTab] = useState(0);
  const [activeGame, setActiveGame] = useState(null);

  const loadGame = (game) => {
    setActiveGame(game);
    setTab(0);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #0f1923 0%, #1a2f1a 50%, #0f1923 100%)',
        borderBottom: '2px solid #d4a017',
        padding: '14px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}>
        <span style={{ fontSize: 28 }}>🃏</span>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#d4a017', letterSpacing: 1, textTransform: 'uppercase' }}>Pocketbooks</h1>
          <span style={{ fontSize: 11, color: '#8b949e' }}>Poker Ledger</span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        background: '#161b22',
        borderBottom: '1px solid #30363d',
        overflowX: 'auto',
        padding: '0 16px'
      }}>
        {tabs.map((t, i) => (
          <div key={i} onClick={() => setTab(i)} style={{
            padding: '12px 20px',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 500,
            color: tab === i ? '#d4a017' : '#8b949e',
            borderBottom: tab === i ? '2px solid #d4a017' : '2px solid transparent',
            whiteSpace: 'nowrap',
            transition: 'all 0.2s'
          }}>{t}</div>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: 24, maxWidth: 1400, margin: '0 auto', width: '100%' }}>
        {tab === 0 && <GameEditor initialGame={activeGame} />}
        {tab === 1 && <History onLoadGame={loadGame} />}
        {tab === 2 && <Players />}
        {tab === 3 && <Leaderboard />}
      </div>
    </div>
  );
}
