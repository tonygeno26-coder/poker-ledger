import React, { useState, useEffect } from 'react';
import { getPlayers, createPlayer, updatePlayer, deletePlayer, getPlayerStats } from '../api';

const fmt = (n) => (parseFloat(n)||0).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:2});
const S = {
  card: { background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: 20, marginBottom: 20 },
  cardTitle: { fontSize: 13, fontWeight: 600, color: '#d4a017', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid #30363d' },
  input: { background: '#1c2333', border: '1px solid #30363d', color: '#e6edf3', padding: '8px 12px', borderRadius: 6, fontSize: 14, width: '100%', fontFamily: 'inherit' },
  label: { fontSize: 12, fontWeight: 500, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
};

export default function Players() {
  const [players, setPlayers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [stats, setStats] = useState(null);
  const [form, setForm] = useState({ name: '', nickname: '', notes: '' });
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  const load = () => {
    getPlayers().then(p => { setPlayers(p); setLoading(false); }).catch(() => setLoading(false));
  };

  const viewPlayer = async (p) => {
    setSelected(p);
    setStats(null);
    const s = await getPlayerStats(p.id);
    setStats(s);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    if (editing) {
      await updatePlayer(editing, form);
    } else {
      await createPlayer(form);
    }
    setForm({ name: '', nickname: '', notes: '' });
    setEditing(null);
    load();
  };

  const handleEdit = (p) => {
    setEditing(p.id);
    setForm({ name: p.name, nickname: p.nickname||'', notes: p.notes||'' });
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this player? This won\'t delete their game history.')) return;
    await deletePlayer(id);
    setSelected(null);
    load();
  };

  return (
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
      <div>
        <div style={S.card}>
          <div style={S.cardTitle}>{editing ? 'Edit Player' : 'Add Player'}</div>
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            {[['Name (required)','name','text'],['Nickname','nickname','text'],['Notes','notes','text']].map(([lbl,key,type])=>(
              <div key={key}>
                <div style={S.label}>{lbl}</div>
                <input type={type} value={form[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))} style={S.input} placeholder={key==='notes'?'Venmo handle, phone, etc.':''} />
              </div>
            ))}
            <div style={{display:'flex',gap:8}}>
              <button onClick={handleSave} style={{padding:'8px 16px',borderRadius:6,border:'none',background:'#d4a017',color:'#000',cursor:'pointer',fontWeight:600,fontFamily:'inherit'}}>
                {editing ? '💾 Save' : '＋ Add Player'}
              </button>
              {editing && <button onClick={()=>{setEditing(null);setForm({name:'',nickname:'',notes:''});}} style={{padding:'8px 16px',borderRadius:6,border:'1px solid #30363d',background:'transparent',color:'#8b949e',cursor:'pointer',fontFamily:'inherit'}}>Cancel</button>}
            </div>
          </div>
        </div>

        <div style={S.card}>
          <div style={S.cardTitle}>Player Profiles ({players.length})</div>
          {loading && <div style={{color:'#8b949e',padding:16}}>Loading...</div>}
          {!loading && !players.length && (
            <div style={{textAlign:'center',padding:32,color:'#8b949e'}}>
              <div style={{fontSize:32,marginBottom:8}}>👥</div>
              No players yet — add your regulars above
            </div>
          )}
          {players.map(p => (
            <div key={p.id} onClick={() => viewPlayer(p)} style={{
              display:'flex',alignItems:'center',justifyContent:'space-between',
              padding:'12px 14px',background:'#1c2333',border:`1px solid ${selected?.id===p.id?'#d4a017':'#30363d'}`,
              borderRadius:8,marginBottom:8,cursor:'pointer',transition:'border-color 0.2s'
            }}>
              <div>
                <div style={{fontWeight:600}}>{p.name}</div>
                {p.nickname && <div style={{fontSize:12,color:'#8b949e'}}>{p.nickname}</div>}
              </div>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                {p.telegram_id && <span style={{fontSize:11,background:'rgba(212,160,23,0.1)',color:'#d4a017',padding:'2px 8px',borderRadius:99}}>📱 Linked</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        {selected ? (
          <div style={S.card}>
            <div style={{...S.cardTitle,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span>{selected.name}</span>
              <div style={{display:'flex',gap:8}}>
                <button onClick={()=>handleEdit(selected)} style={{padding:'4px 12px',borderRadius:6,border:'1px solid #30363d',background:'transparent',color:'#8b949e',cursor:'pointer',fontSize:12,fontFamily:'inherit'}}>✏️ Edit</button>
                <button onClick={()=>handleDelete(selected.id)} style={{padding:'4px 12px',borderRadius:6,border:'1px solid #f85149',background:'transparent',color:'#f85149',cursor:'pointer',fontSize:12,fontFamily:'inherit'}}>🗑️ Delete</button>
              </div>
            </div>

            {selected.telegram_id ? (
              <div style={{padding:'10px 14px',background:'rgba(212,160,23,0.05)',border:'1px solid rgba(212,160,23,0.2)',borderRadius:8,marginBottom:16,fontSize:13}}>
                📱 <strong style={{color:'#d4a017'}}>Telegram Linked</strong>
                {selected.telegram_username && <span style={{color:'#8b949e'}}> · @{selected.telegram_username}</span>}
              </div>
            ) : (
              <div style={{padding:'10px 14px',background:'rgba(248,81,73,0.05)',border:'1px solid rgba(248,81,73,0.2)',borderRadius:8,marginBottom:16,fontSize:13}}>
                📵 No Telegram linked — player won't receive notifications.
                <div style={{marginTop:6,color:'#8b949e',fontSize:12}}>
                  Tell them to message <strong style={{color:'#d4a017'}}>@PocketbooksBot</strong> on Telegram and type their name.
                </div>
              </div>
            )}

            {stats ? (
              <div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:10,marginBottom:16}}>
                  {[
                    ['Games Played', stats.stats.games_played||0, '#d4a017'],
                    ['Total Result', `${(parseFloat(stats.stats.total_result)||0)>=0?'+':''}$${fmt(Math.abs(parseFloat(stats.stats.total_result)||0))}`, (parseFloat(stats.stats.total_result)||0)>=0?'#3fb950':'#f85149'],
                    ['Best Session', `+$${fmt(Math.abs(parseFloat(stats.stats.best)||0))}`, '#3fb950'],
                    ['Worst Session', `$${fmt(Math.abs(parseFloat(stats.stats.worst)||0))}`, '#f85149'],
                  ].map(([lbl,val,color])=>(
                    <div key={lbl} style={{background:'#1c2333',border:'1px solid #30363d',borderRadius:8,padding:14,textAlign:'center'}}>
                      <div style={{fontSize:11,color:'#8b949e',marginBottom:4}}>{lbl}</div>
                      <div style={{fontSize:18,fontWeight:700,color}}>{val}</div>
                    </div>
                  ))}
                </div>
                {stats.recent?.length > 0 && (
                  <div>
                    <div style={{fontSize:12,color:'#8b949e',textTransform:'uppercase',letterSpacing:.5,marginBottom:10}}>Recent Sessions</div>
                    {stats.recent.map((g,i) => {
                      const r = parseFloat(g.result)||0;
                      const dt = g.date ? new Date(g.date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '?';
                      return (
                        <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid #30363d',fontSize:13}}>
                          <span>{g.location} <span style={{color:'#8b949e'}}>({dt})</span></span>
                          <span style={{fontWeight:700,color:r>0?'#3fb950':r<0?'#f85149':'#8b949e'}}>{r>0?'+':''}${fmt(Math.abs(r))}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : <div style={{color:'#8b949e',padding:16}}>Loading stats...</div>}
          </div>
        ) : (
          <div style={{...S.card,textAlign:'center',padding:48}}>
            <div style={{fontSize:40,marginBottom:12}}>👤</div>
            <div style={{color:'#8b949e'}}>Select a player to view their profile and stats</div>
          </div>
        )}

        <div style={{...S.card,background:'rgba(212,160,23,0.03)',border:'1px solid rgba(212,160,23,0.2)'}}>
          <div style={S.cardTitle}>📱 Telegram Registration</div>
          <p style={{fontSize:13,color:'#8b949e',lineHeight:1.6}}>
            For players to receive notifications, they need to link their Telegram account:
          </p>
          <ol style={{fontSize:13,color:'#e6edf3',lineHeight:2,paddingLeft:20,marginTop:10}}>
            <li>Open Telegram</li>
            <li>Search for <strong style={{color:'#d4a017'}}>@PocketbooksBot</strong></li>
            <li>Tap <strong>Start</strong></li>
            <li>Type their name (must match exactly)</li>
            <li>Done! They'll get notified automatically 🎰</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
