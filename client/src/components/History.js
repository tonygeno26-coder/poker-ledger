import React, { useState, useEffect } from 'react';
import { getGames, getGame, markPaid } from '../api';

const fmt = (n) => (parseFloat(n)||0).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:2});
const S = {
  card: { background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: 20, marginBottom: 20 },
  cardTitle: { fontSize: 13, fontWeight: 600, color: '#d4a017', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid #30363d' },
};

export default function History({ onLoadGame }) {
  const [games, setGames] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getGames().then(g => { setGames(g); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const viewGame = async (id) => {
    setSelected(id);
    const d = await getGame(id);
    setDetail(d);
  };

  const handleMarkPaid = async (sid) => {
    await markPaid(sid);
    viewGame(selected);
  };

  if (loading) return <div style={{textAlign:'center',padding:40,color:'#8b949e'}}>Loading...</div>;

  return (
    <div style={{display:'grid',gridTemplateColumns:selected?'1fr 1fr':'1fr',gap:20}}>
      <div>
        <div style={S.card}>
          <div style={S.cardTitle}>Past Games ({games.length})</div>
          {!games.length && <div style={{textAlign:'center',padding:32,color:'#8b949e'}}>📋 No saved games yet</div>}
          {games.map(g => {
            const dt = g.date ? new Date(g.date+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'}) : '?';
            return (
              <div key={g.id} onClick={() => viewGame(g.id)} style={{
                display:'flex',alignItems:'center',justifyContent:'space-between',
                padding:'14px 16px',background: selected===g.id ? '#1c2333' :'#1c2333',
                border:`1px solid ${selected===g.id?'#d4a017':'#30363d'}`,borderRadius:8,marginBottom:8,cursor:'pointer',transition:'border-color 0.2s'
              }}>
                <div>
                  <div style={{fontWeight:600,marginBottom:2}}>{g.location || 'Unknown'}</div>
                  <div style={{fontSize:12,color:'#8b949e'}}>{dt}{g.stakes?' · '+g.stakes:''}</div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:18,fontWeight:700,color:'#d4a017'}}>${fmt(g.total_pot||0)}</div>
                  <div style={{fontSize:12,color:'#8b949e'}}>{g.player_count||0} players</div>
                  <div style={{fontSize:11,padding:'2px 8px',borderRadius:99,display:'inline-block',marginTop:2,
                    background:g.status==='settled'?'rgba(63,185,80,0.15)':'rgba(212,160,23,0.15)',
                    color:g.status==='settled'?'#3fb950':'#d4a017'
                  }}>{g.status}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selected && detail && (
        <div>
          <div style={S.card}>
            <div style={{...S.cardTitle,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span>{detail.game?.location}</span>
              <div style={{display:'flex',gap:8}}>
                <button onClick={() => onLoadGame(detail.game)} style={{padding:'4px 12px',borderRadius:6,border:'1px solid #d4a017',background:'transparent',color:'#d4a017',cursor:'pointer',fontSize:12,fontFamily:'inherit'}}>📂 Load</button>
                <button onClick={() => setSelected(null)} style={{padding:'4px 12px',borderRadius:6,border:'1px solid #30363d',background:'transparent',color:'#8b949e',cursor:'pointer',fontSize:12,fontFamily:'inherit'}}>✕</button>
              </div>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:16}}>
              {[['Players',detail.players?.length||0,'#d4a017'],
                ['Total In',`$${fmt(detail.players?.reduce((s,p)=>s+(parseFloat(p.total_in)||0),0))}`, '#d4a017'],
                ['Status',detail.game?.status,'#3fb950']
              ].map(([lbl,val,color])=>(
                <div key={lbl} style={{background:'#1c2333',border:'1px solid #30363d',borderRadius:8,padding:12,textAlign:'center'}}>
                  <div style={{fontSize:11,color:'#8b949e',marginBottom:4}}>{lbl}</div>
                  <div style={{fontWeight:700,color}}>{val}</div>
                </div>
              ))}
            </div>

            <h3 style={{fontSize:13,color:'#8b949e',marginBottom:10,textTransform:'uppercase',letterSpacing:.5}}>Results</h3>
            {[...(detail.players||[])].sort((a,b)=>parseFloat(b.result)-parseFloat(a.result)).map((p,i) => {
              const r = parseFloat(p.result)||0;
              return (
                <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:'1px solid #30363d'}}>
                  <div>
                    <span style={{fontWeight:500}}>{p.player_name}</span>
                    {p.telegram_id && <span style={{marginLeft:8,fontSize:11,color:'#d4a017',background:'rgba(212,160,23,0.1)',padding:'1px 6px',borderRadius:99}}>📱 Telegram</span>}
                  </div>
                  <span style={{fontWeight:700,color:r>0?'#3fb950':r<0?'#f85149':'#8b949e'}}>{r>0?'+':''}${fmt(Math.abs(r))}</span>
                </div>
              );
            })}

            {detail.settlements?.length > 0 && (
              <div style={{marginTop:16}}>
                <h3 style={{fontSize:13,color:'#8b949e',marginBottom:10,textTransform:'uppercase',letterSpacing:.5}}>Settlement</h3>
                {detail.settlements.map((s,i) => (
                  <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 12px',background:'#1c2333',border:`1px solid ${s.paid?'#3fb950':'#30363d'}`,borderRadius:8,marginBottom:6}}>
                    <div style={{fontSize:13}}>
                      <span style={{fontWeight:600}}>💸 {s.from_name}</span>
                      <span style={{color:'#d4a017',margin:'0 6px'}}>→</span>
                      <span style={{fontWeight:600}}>🏆 {s.to_name}</span>
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <span style={{fontWeight:700,color:'#3fb950'}}>${fmt(s.amount)}</span>
                      {s.paid
                        ? <span style={{fontSize:11,color:'#3fb950',background:'rgba(63,185,80,0.1)',padding:'2px 8px',borderRadius:99}}>✅ Paid</span>
                        : <button onClick={()=>handleMarkPaid(s.id)} style={{padding:'3px 10px',borderRadius:6,border:'1px solid #3fb950',background:'transparent',color:'#3fb950',cursor:'pointer',fontSize:11,fontFamily:'inherit'}}>Mark Paid</button>
                      }
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
