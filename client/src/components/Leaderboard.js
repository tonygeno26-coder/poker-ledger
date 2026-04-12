import React, { useState, useEffect } from 'react';
import { getStats } from '../api';

const fmt = (n) => (parseFloat(n)||0).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:2});

export default function Leaderboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getStats().then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div style={{textAlign:'center',padding:40,color:'#8b949e'}}>Loading leaderboard...</div>;
  if (!data?.leaderboard?.length) return (
    <div style={{textAlign:'center',padding:60,color:'#8b949e'}}>
      <div style={{fontSize:48,marginBottom:12}}>🏆</div>
      <div>No game data yet — play some poker!</div>
    </div>
  );

  const medals = ['🥇','🥈','🥉'];

  return (
    <div>
      {/* Totals */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:12,marginBottom:24}}>
        {[
          ['Total Games', data.totals?.total_games||0, '#d4a017'],
          ['Total $ Played', `$${fmt(data.totals?.total_money||0)}`, '#d4a017'],
          ['Players Tracked', data.leaderboard?.length||0, '#d4a017'],
        ].map(([lbl,val,color])=>(
          <div key={lbl} style={{background:'#161b22',border:'1px solid #30363d',borderRadius:10,padding:20,textAlign:'center'}}>
            <div style={{fontSize:12,color:'#8b949e',textTransform:'uppercase',letterSpacing:.5,marginBottom:8}}>{lbl}</div>
            <div style={{fontSize:26,fontWeight:700,color}}>{val}</div>
          </div>
        ))}
      </div>

      {/* Leaderboard */}
      <div style={{background:'#161b22',border:'1px solid #30363d',borderRadius:10,overflow:'hidden'}}>
        <div style={{padding:'14px 20px',background:'linear-gradient(135deg,#0f1923,#1a2f1a,#0f1923)',borderBottom:'1px solid #d4a017'}}>
          <h2 style={{fontSize:16,fontWeight:700,color:'#d4a017',letterSpacing:1}}>🏆 All-Time Leaderboard</h2>
        </div>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:14}}>
          <thead>
            <tr style={{background:'#1c2333'}}>
              {['Rank','Player','Games','Total','Best','Worst','Avg/Game'].map(h=>(
                <th key={h} style={{padding:'10px 16px',textAlign:h==='Player'||h==='Rank'?'left':'right',fontSize:11,fontWeight:600,color:'#8b949e',textTransform:'uppercase',letterSpacing:.5,borderBottom:'1px solid #30363d'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.leaderboard.map((p, i) => {
              const total = parseFloat(p.total_result)||0;
              const best = parseFloat(p.best)||0;
              const worst = parseFloat(p.worst)||0;
              const avg = parseFloat(p.games) ? total/parseFloat(p.games) : 0;
              return (
                <tr key={p.id} style={{borderBottom:'1px solid rgba(48,54,61,0.5)',background:i===0?'rgba(212,160,23,0.04)':'transparent'}}>
                  <td style={{padding:'12px 16px',fontWeight:700,fontSize:18}}>{medals[i]||`#${i+1}`}</td>
                  <td style={{padding:'12px 16px',fontWeight:600}}>{p.name}</td>
                  <td style={{padding:'12px 16px',textAlign:'right',color:'#8b949e'}}>{p.games}</td>
                  <td style={{padding:'12px 16px',textAlign:'right',fontWeight:700,fontSize:16,color:total>0?'#3fb950':total<0?'#f85149':'#8b949e'}}>
                    {total>0?'+':''}${fmt(Math.abs(total))}
                  </td>
                  <td style={{padding:'12px 16px',textAlign:'right',color:'#3fb950'}}>+${fmt(best)}</td>
                  <td style={{padding:'12px 16px',textAlign:'right',color:'#f85149'}}>-${fmt(Math.abs(worst))}</td>
                  <td style={{padding:'12px 16px',textAlign:'right',color:avg>0?'#3fb950':avg<0?'#f85149':'#8b949e'}}>
                    {avg>0?'+':''}${fmt(Math.abs(avg))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
