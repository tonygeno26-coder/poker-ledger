import React, { useState, useEffect, useCallback } from 'react';
import { getPlayers, saveGame, settleGame } from '../api';

const S = {
  card: { background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: 20, marginBottom: 20 },
  cardTitle: { fontSize: 13, fontWeight: 600, color: '#d4a017', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid #30363d' },
  input: { background: '#1c2333', border: '1px solid #30363d', color: '#e6edf3', padding: '8px 12px', borderRadius: 6, fontSize: 14, width: '100%', fontFamily: 'inherit' },
  inputSm: { background: '#1c2333', border: '1px solid #30363d', color: '#e6edf3', padding: '5px 7px', borderRadius: 4, fontSize: 13, textAlign: 'right', width: '100%', fontFamily: 'inherit' },
  label: { fontSize: 12, fontWeight: 500, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  btn: { padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6 },
  th: { background: '#1c2333', color: '#8b949e', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, padding: '8px 8px', textAlign: 'right', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' },
  td: { padding: '4px 4px', borderBottom: '1px solid rgba(48,54,61,0.5)', verticalAlign: 'middle' },
};

const fmt = (n) => (parseFloat(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function calcTotalIn(p) {
  return (parseFloat(p.buyinCash)||0) + (parseFloat(p.buyinMarker)||0) +
    (p.addons||[]).reduce((s,a) => s+(parseFloat(a)||0), 0);
}
function calcTotalOut(p) { return (parseFloat(p.cashOut)||0) + (parseFloat(p.markerOut)||0); }
function calcResult(p) { return calcTotalOut(p) - calcTotalIn(p); }

function minTransactions(players) {
  let debtors = players.filter(p => calcResult(p) < 0).map(p => ({ name: p.name, amount: Math.abs(calcResult(p)), player_id: p.player_id }));
  let creditors = players.filter(p => calcResult(p) > 0).map(p => ({ name: p.name, amount: calcResult(p), player_id: p.player_id }));
  const tx = []; let i=0, j=0;
  while (i<debtors.length && j<creditors.length) {
    const pay = Math.min(debtors[i].amount, creditors[j].amount);
    if (pay > 0.005) tx.push({ from: debtors[i].name, fromId: debtors[i].player_id, to: creditors[j].name, toId: creditors[j].player_id, amount: Math.round(pay*100)/100 });
    debtors[i].amount -= pay; creditors[j].amount -= pay;
    if (debtors[i].amount < 0.005) i++;
    if (creditors[j].amount < 0.005) j++;
  }
  return tx;
}

function newPlayer() {
  return { name: '', player_id: null, buyinCash: '', buyinMarker: '', addons: [''], cashOut: '', markerOut: '', payIn: '', payOut: '', paidIn: '', paidOut: '' };
}

export default function GameEditor({ initialGame }) {
  const [gameId, setGameId] = useState(null);
  const [location, setLocation] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [gameType, setGameType] = useState('');
  const [stakes, setStakes] = useState('');
  const [addonCount, setAddonCount] = useState(1);
  const [players, setPlayers] = useState(Array.from({length:10}, newPlayer));
  const [partners, setPartners] = useState([]);
  const [expenses, setExpenses] = useState({ base:'', tips:'', misc:'', commPct:0, paid:'' });
  const [bankStart, setBankStart] = useState('');
  const [bankIn, setBankIn] = useState('');
  const [bankOut, setBankOut] = useState('');
  const [reconCredits, setReconCredits] = useState('');
  const [reconOverages, setReconOverages] = useState('');
  const [reconUnclaimed, setReconUnclaimed] = useState('');
  const [tab, setTab] = useState('setup');
  const [allPlayers, setAllPlayers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [settling, setSettling] = useState(false);
  const [toast, setToast] = useState('');
  const [settlements, setSettlements] = useState([]);

  useEffect(() => {
    getPlayers().then(setAllPlayers).catch(() => {});
    const saved = localStorage.getItem('pocketbooks-current');
    if (saved && !initialGame) {
      try { const d = JSON.parse(saved); restoreState(d); } catch(e){}
    }
  }, []);

  useEffect(() => {
    if (initialGame) restoreState(initialGame);
  }, [initialGame]);

  function restoreState(d) {
    if (d.id) setGameId(d.id);
    if (d.location) setLocation(d.location);
    if (d.date) setDate(d.date);
    if (d.game_type) setGameType(d.game_type);
    if (d.stakes) setStakes(d.stakes);
    if (d.players?.length) setPlayers(d.players.map(p => ({ ...newPlayer(), ...p })));
    if (d.partners?.length) setPartners(d.partners);
    if (d.expenses) setExpenses(d.expenses);
    if (d.addonCount) setAddonCount(d.addonCount);
  }

  const autoSave = useCallback(() => {
    const data = { id: gameId, location, date, game_type: gameType, stakes, players, partners, expenses, addonCount };
    localStorage.setItem('pocketbooks-current', JSON.stringify(data));
  }, [gameId, location, date, gameType, stakes, players, partners, expenses, addonCount]);

  useEffect(() => { autoSave(); }, [players, expenses, partners, location, date]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const updatePlayer = (i, key, val) => {
    setPlayers(prev => { const p = [...prev]; p[i] = { ...p[i], [key]: val }; return p; });
  };
  const updateAddon = (i, ai, val) => {
    setPlayers(prev => {
      const p = [...prev];
      const addons = [...(p[i].addons || [])];
      addons[ai] = val;
      p[i] = { ...p[i], addons };
      return p;
    });
  };

  const active = players.filter(p => p.name || p.buyinCash || p.buyinMarker);
  const totIn = active.reduce((s,p) => s+calcTotalIn(p), 0);
  const totOut = active.reduce((s,p) => s+calcTotalOut(p), 0);

  // Expenses calc
  const expBase = parseFloat(expenses.base)||0;
  const expTips = parseFloat(expenses.tips)||0;
  const expMisc = parseFloat(expenses.misc)||0;
  const expGross = expBase + expTips + expMisc;
  const expComm = expGross * ((parseFloat(expenses.commPct)||0)/100);
  const expNet = expGross - expComm;
  const expOwed = expNet - (parseFloat(expenses.paid)||0);

  // Bank
  const bankNet = (parseFloat(bankStart)||0) + (parseFloat(bankIn)||0) - (parseFloat(bankOut)||0);

  // Recon
  const reconDiff = totIn - (totOut - (parseFloat(reconCredits)||0) + (parseFloat(reconOverages)||0) - (parseFloat(reconUnclaimed)||0));

  // Settlement
  const txs = minTransactions(active);

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await saveGame({
        id: gameId, location, date, game_type: gameType, stakes,
        players: active.map(p => ({ ...p, addons: p.addons?.slice(0, addonCount) || [] })),
        expenses: { base: expBase, tips: expTips, misc: expMisc, gross: expGross, commPct: expenses.commPct, commission: expComm, net: expNet, paid: parseFloat(expenses.paid)||0, owed: expOwed },
        partners: partners.map(p => ({ ...p, share: expNet*(p.pct/100), owed: expNet*(p.pct/100)-(p.paid||0) }))
      });
      setGameId(result.game.id);
      showToast('Game saved! ✅');
    } catch(e) { showToast('Error saving: ' + e.message); }
    setSaving(false);
  };

  const handleSettle = async () => {
    if (!gameId) { showToast('Save the game first!'); return; }
    if (!window.confirm('Calculate settlement and notify all players via Telegram?')) return;
    setSettling(true);
    try {
      const result = await settleGame(gameId);
      setSettlements(result.settlements);
      setTab('settlement');
      showToast(`✅ Settled! ${result.notifications?.length || 0} players notified via Telegram`);
    } catch(e) { showToast('Error: ' + e.message); }
    setSettling(false);
  };

  const SubTab = ({id, label}) => (
    <div onClick={() => setTab(id)} style={{
      padding: '10px 18px', cursor: 'pointer', fontSize: 13, fontWeight: 500,
      color: tab === id ? '#d4a017' : '#8b949e',
      borderBottom: tab === id ? '2px solid #d4a017' : '2px solid transparent',
      whiteSpace: 'nowrap'
    }}>{label}</div>
  );

  return (
    <div>
      {/* Sub-tabs */}
      <div style={{ display:'flex', borderBottom:'1px solid #30363d', marginBottom:20, overflowX:'auto' }}>
        <SubTab id="setup" label="⚙️ Setup" />
        <SubTab id="players" label="👥 Players" />
        <SubTab id="expenses" label="💰 Expenses" />
        <SubTab id="settlement" label="🤝 Settlement" />
        <div style={{ marginLeft:'auto', display:'flex', gap:8, padding:'4px 0' }}>
          <button style={{...S.btn, background:'#1c2333', border:'1px solid #30363d', color:'#8b949e'}} onClick={handleSave} disabled={saving}>
            {saving ? '...' : '💾 Save'}
          </button>
          <button style={{...S.btn, background:'#d4a017', color:'#000'}} onClick={handleSettle} disabled={settling}>
            {settling ? '...' : '🤝 Settle & Notify'}
          </button>
        </div>
      </div>

      {/* SETUP */}
      {tab === 'setup' && (
        <div>
          <div style={S.card}>
            <div style={S.cardTitle}>Game Info</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:16 }}>
              {[['Location','text',location,setLocation,'e.g. Mike\'s Place'],
                ['Date','date',date,setDate,''],
                ['Game Type','text',gameType,setGameType,'e.g. No Limit Hold\'em'],
                ['Stakes','text',stakes,setStakes,'e.g. 1/2']
              ].map(([lbl,type,val,setter,ph]) => (
                <div key={lbl}>
                  <div style={S.label}>{lbl}</div>
                  <input type={type} value={val} placeholder={ph} onChange={e=>setter(e.target.value)} style={S.input} />
                </div>
              ))}
            </div>
          </div>

          <div style={S.card}>
            <div style={S.cardTitle}>Partners <span style={{fontSize:11,color:'#8b949e',textTransform:'none',fontWeight:400}}>(optional — leave empty to run solo)</span></div>
            {partners.map((p, i) => (
              <div key={i} style={{ display:'flex', gap:10, alignItems:'center', marginBottom:8, background:'#1c2333', padding:10, borderRadius:8, border:'1px solid #30363d' }}>
                <input value={p.name||''} placeholder="Partner name" onChange={e => setPartners(prev => { const a=[...prev]; a[i]={...a[i],name:e.target.value}; return a; })} style={{...S.input,flex:1}} />
                <input type="number" value={p.pct||''} placeholder="%" onChange={e => setPartners(prev => { const a=[...prev]; a[i]={...a[i],pct:parseFloat(e.target.value)||0}; return a; })} style={{...S.input,maxWidth:70,textAlign:'right'}} />
                <span style={{color:'#8b949e',fontSize:12}}>%</span>
                <button onClick={() => setPartners(prev=>prev.filter((_,j)=>j!==i))} style={{...S.btn,background:'transparent',border:'1px solid #f85149',color:'#f85149',padding:'4px 10px'}}>✕</button>
              </div>
            ))}
            <button onClick={() => setPartners(prev => [...prev, {name:'',pct:Math.round(100/(prev.length+1)*10)/10,paid:0}])}
              style={{...S.btn,background:'transparent',border:'1px solid #30363d',color:'#8b949e'}}>＋ Add Partner</button>
          </div>

          <div style={S.card}>
            <div style={S.cardTitle}>House Bank</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:16 }}>
              {[['Beginning Balance',bankStart,setBankStart],['Cash In',bankIn,setBankIn],['Cash Out',bankOut,setBankOut]].map(([lbl,val,setter])=>(
                <div key={lbl}>
                  <div style={S.label}>{lbl}</div>
                  <input type="number" value={val} placeholder="0" onChange={e=>setter(e.target.value)} style={S.input} />
                </div>
              ))}
              <div>
                <div style={S.label}>Bank Net</div>
                <input readOnly value={bankNet.toFixed(2)} style={{...S.input,background:'#0d1117',color:'#8b949e'}} />
              </div>
            </div>
          </div>

          <div style={S.card}>
            <div style={S.cardTitle}>Chip Reconciliation</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))', gap:16 }}>
              <div><div style={S.label}>Total In</div><input readOnly value={fmt(totIn)} style={{...S.input,background:'#0d1117',color:'#8b949e'}} /></div>
              <div><div style={S.label}>Total Out</div><input readOnly value={fmt(totOut)} style={{...S.input,background:'#0d1117',color:'#8b949e'}} /></div>
              <div><div style={S.label}>Credits</div><input type="number" value={reconCredits} placeholder="0" onChange={e=>setReconCredits(e.target.value)} style={S.input}/></div>
              <div><div style={S.label}>Overages</div><input type="number" value={reconOverages} placeholder="0" onChange={e=>setReconOverages(e.target.value)} style={S.input}/></div>
              <div><div style={S.label}>Unclaimed</div><input type="number" value={reconUnclaimed} placeholder="0" onChange={e=>setReconUnclaimed(e.target.value)} style={S.input}/></div>
              <div><div style={S.label}>Difference</div>
                <input readOnly value={reconDiff.toFixed(2)} style={{...S.input,background:'#0d1117',color:reconDiff===0?'#3fb950':'#f85149',fontWeight:700}} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PLAYERS */}
      {tab === 'players' && (
        <div style={S.card}>
          <div style={{...S.cardTitle,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>
              Player Table
              <span style={{marginLeft:12,fontSize:11,color:'#8b949e'}}>
                {active.filter(p=>p.name).length} players · ${fmt(totIn)} in · ${fmt(totOut)} out
              </span>
            </div>
            <div style={{display:'flex',gap:8}}>
              {addonCount < 7 && (
                <button onClick={() => setAddonCount(n=>n+1)} style={{...S.btn,background:'transparent',border:'1px solid #30363d',color:'#8b949e',fontSize:12}}>＋ Add-on</button>
              )}
              <button onClick={() => setPlayers(prev=>[...prev, newPlayer()])} style={{...S.btn,background:'transparent',border:'1px solid #30363d',color:'#8b949e',fontSize:12}}>＋ Player</button>
            </div>
          </div>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13,minWidth:900}}>
              <thead>
                <tr>
                  <th style={{...S.th,textAlign:'left'}}>#</th>
                  <th style={{...S.th,textAlign:'left'}}>Player</th>
                  <th style={S.th}>Buy In (C$)</th>
                  <th style={S.th}>Buy In (M)</th>
                  {Array.from({length:addonCount},(_,i)=><th key={i} style={S.th}>Add {i+1}</th>)}
                  <th style={S.th}>Total In</th>
                  <th style={S.th}>Cash Out</th>
                  <th style={S.th}>Marker Out</th>
                  <th style={S.th}>Total Out</th>
                  <th style={S.th}>Result</th>
                  <th style={S.th}>Pay In</th>
                  <th style={S.th}>Pay Out</th>
                  <th style={S.th}>Paid In</th>
                  <th style={S.th}>Paid Out</th>
                  <th style={S.th}>Owes</th>
                  <th style={S.th}>Owed</th>
                  <th style={S.th}></th>
                </tr>
              </thead>
              <tbody>
                {players.map((p, i) => {
                  const tIn = calcTotalIn(p);
                  const tOut = calcTotalOut(p);
                  const res = tOut - tIn;
                  const owes = res < 0 ? Math.abs(res) : 0;
                  const owed = res > 0 ? res : 0;
                  return (
                    <tr key={i}>
                      <td style={{...S.td,color:'#8b949e',padding:'4px 8px'}}>{i+1}</td>
                      <td style={S.td}>
                        <select
                          value={p.player_id||''}
                          onChange={e => {
                            const sel = allPlayers.find(pl=>pl.id===e.target.value);
                            updatePlayer(i,'player_id',e.target.value);
                            if (sel) updatePlayer(i,'name',sel.name);
                          }}
                          style={{...S.inputSm,textAlign:'left',minWidth:100,marginBottom:2}}
                        >
                          <option value="">-- Link Profile --</option>
                          {allPlayers.map(pl=><option key={pl.id} value={pl.id}>{pl.name}</option>)}
                        </select>
                        <input value={p.name||''} placeholder="Name" onChange={e=>updatePlayer(i,'name',e.target.value)} style={{...S.inputSm,textAlign:'left',minWidth:100}} />
                      </td>
                      {['buyinCash','buyinMarker'].map(k=>(
                        <td key={k} style={S.td}><input type="number" value={p[k]||''} min="0" onChange={e=>updatePlayer(i,k,e.target.value)} style={{...S.inputSm,minWidth:65}} /></td>
                      ))}
                      {Array.from({length:addonCount},(_,ai)=>(
                        <td key={ai} style={S.td}><input type="number" value={(p.addons||[])[ai]||''} min="0" onChange={e=>updateAddon(i,ai,e.target.value)} style={{...S.inputSm,minWidth:55}} /></td>
                      ))}
                      <td style={{...S.td,textAlign:'right',padding:'4px 8px',fontWeight:600,color:'#d4a017'}}>{tIn ? `$${fmt(tIn)}` : '-'}</td>
                      {['cashOut','markerOut'].map(k=>(
                        <td key={k} style={S.td}><input type="number" value={p[k]||''} min="0" onChange={e=>updatePlayer(i,k,e.target.value)} style={{...S.inputSm,minWidth:65}} /></td>
                      ))}
                      <td style={{...S.td,textAlign:'right',padding:'4px 8px',fontWeight:600}}>{tOut ? `$${fmt(tOut)}` : '-'}</td>
                      <td style={{...S.td,textAlign:'right',padding:'4px 8px',fontWeight:700,color:res>0?'#3fb950':res<0?'#f85149':'#8b949e'}}>
                        {res !== 0 ? `${res>0?'+':''}$${fmt(Math.abs(res))}` : '-'}
                      </td>
                      {['payIn','payOut','paidIn','paidOut'].map(k=>(
                        <td key={k} style={S.td}><input type="number" value={p[k]||''} min="0" onChange={e=>updatePlayer(i,k,e.target.value)} style={{...S.inputSm,minWidth:60}} /></td>
                      ))}
                      <td style={{...S.td,textAlign:'right',padding:'4px 8px',color:owes>0?'#f85149':'#8b949e'}}>{owes>0?`$${fmt(owes)}`:'-'}</td>
                      <td style={{...S.td,textAlign:'right',padding:'4px 8px',color:owed>0?'#3fb950':'#8b949e'}}>{owed>0?`$${fmt(owed)}`:'-'}</td>
                      <td style={S.td}>
                        <button onClick={()=>setPlayers(prev=>prev.filter((_,j)=>j!==i))}
                          style={{...S.btn,background:'transparent',border:'1px solid #f85149',color:'#f85149',padding:'3px 8px',fontSize:11}}>✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{background:'#1c2333',borderTop:'2px solid #d4a017'}}>
                  <td colSpan={2} style={{padding:'8px 10px',fontWeight:700,color:'#d4a017'}}>TOTALS</td>
                  <td style={{textAlign:'right',padding:'8px',fontWeight:700,color:'#d4a017'}}>${fmt(active.reduce((s,p)=>s+(parseFloat(p.buyinCash)||0),0))}</td>
                  <td style={{textAlign:'right',padding:'8px',fontWeight:700,color:'#d4a017'}}>${fmt(active.reduce((s,p)=>s+(parseFloat(p.buyinMarker)||0),0))}</td>
                  {Array.from({length:addonCount},(_,ai)=>(
                    <td key={ai} style={{textAlign:'right',padding:'8px',fontWeight:700,color:'#d4a017'}}>${fmt(active.reduce((s,p)=>s+(parseFloat((p.addons||[])[ai])||0),0))}</td>
                  ))}
                  <td style={{textAlign:'right',padding:'8px',fontWeight:700,color:'#d4a017'}}>${fmt(totIn)}</td>
                  <td style={{textAlign:'right',padding:'8px',fontWeight:700,color:'#d4a017'}}>${fmt(active.reduce((s,p)=>s+(parseFloat(p.cashOut)||0),0))}</td>
                  <td style={{textAlign:'right',padding:'8px',fontWeight:700,color:'#d4a017'}}>${fmt(active.reduce((s,p)=>s+(parseFloat(p.markerOut)||0),0))}</td>
                  <td style={{textAlign:'right',padding:'8px',fontWeight:700,color:'#d4a017'}}>${fmt(totOut)}</td>
                  <td colSpan={10}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* EXPENSES */}
      {tab === 'expenses' && (
        <div>
          <div style={S.card}>
            <div style={S.cardTitle}>Expenses</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:16,marginBottom:16}}>
              {[['Base',expenses.base,v=>setExpenses(e=>({...e,base:v}))],
                ['Tips',expenses.tips,v=>setExpenses(e=>({...e,tips:v}))],
                ['Misc',expenses.misc,v=>setExpenses(e=>({...e,misc:v}))]
              ].map(([lbl,val,setter])=>(
                <div key={lbl}>
                  <div style={S.label}>{lbl} ($)</div>
                  <input type="number" value={val} placeholder="0" onChange={e=>setter(e.target.value)} style={S.input}/>
                </div>
              ))}
              <div><div style={S.label}>Gross ($)</div><input readOnly value={expGross.toFixed(2)} style={{...S.input,background:'#0d1117',color:'#8b949e'}}/></div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:16,marginBottom:16}}>
              <div>
                <div style={S.label}>Commission %</div>
                <input type="number" value={expenses.commPct} placeholder="0" onChange={e=>setExpenses(ex=>({...ex,commPct:e.target.value}))} style={S.input}/>
              </div>
              <div><div style={S.label}>Commission ($)</div><input readOnly value={expComm.toFixed(2)} style={{...S.input,background:'#0d1117',color:'#8b949e'}}/></div>
              <div><div style={S.label}>Net ($)</div><input readOnly value={expNet.toFixed(2)} style={{...S.input,background:'#0d1117',color:'#d4a017',fontWeight:700}}/></div>
              <div>
                <div style={S.label}>Paid ($)</div>
                <input type="number" value={expenses.paid} placeholder="0" onChange={e=>setExpenses(ex=>({...ex,paid:e.target.value}))} style={S.input}/>
              </div>
              <div><div style={S.label}>Owed ($)</div><input readOnly value={expOwed.toFixed(2)} style={{...S.input,background:'#0d1117',color:expOwed>0?'#3fb950':expOwed<0?'#f85149':'#8b949e',fontWeight:700}}/></div>
            </div>
          </div>

          {partners.length > 0 && (
            <div style={S.card}>
              <div style={S.cardTitle}>Partner Split</div>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead><tr>
                  {['Partner','Split %','Share ($)','Paid ($)','Owed ($)'].map(h=>(
                    <th key={h} style={{...S.th,textAlign:h==='Partner'?'left':'right'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {partners.map((p,i) => {
                    const share = expNet*(p.pct/100);
                    const owed = share-(parseFloat(p.paid)||0);
                    return (
                      <tr key={i} style={{borderBottom:'1px solid #30363d'}}>
                        <td style={{padding:'8px',fontWeight:600}}>{p.name||`Partner ${i+1}`}</td>
                        <td style={{textAlign:'right',padding:'8px'}}>{p.pct}%</td>
                        <td style={{textAlign:'right',padding:'8px',color:'#d4a017',fontWeight:700}}>${fmt(share)}</td>
                        <td style={{textAlign:'right',padding:'8px'}}>
                          <input type="number" value={p.paid||''} placeholder="0" onChange={e=>setPartners(prev=>{const a=[...prev];a[i]={...a[i],paid:parseFloat(e.target.value)||0};return a;})} style={{...S.inputSm,maxWidth:90}}/>
                        </td>
                        <td style={{textAlign:'right',padding:'8px',color:owed>0?'#3fb950':owed<0?'#f85149':'#8b949e',fontWeight:700}}>${fmt(owed)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* SETTLEMENT */}
      {tab === 'settlement' && (
        <div>
          <div style={S.card}>
            <div style={{...S.cardTitle,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span>Who Owes Who</span>
              <button onClick={()=>window.print()} style={{...S.btn,background:'transparent',border:'1px solid #30363d',color:'#8b949e',fontSize:12}}>🖨️ Print</button>
            </div>
            {txs.length === 0 ? (
              <div style={{textAlign:'center',padding:40,color:'#3fb950',fontSize:16}}>✅ All square! No payments needed.</div>
            ) : (
              <div>
                {txs.map((t,i) => (
                  <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',background:'#1c2333',border:'1px solid #30363d',borderRadius:8,marginBottom:8}}>
                    <span style={{fontWeight:600}}>💸 {t.from}</span>
                    <span style={{color:'#d4a017',margin:'0 8px'}}>→</span>
                    <span style={{fontWeight:600}}>🏆 {t.to}</span>
                    <span style={{fontWeight:700,color:'#3fb950',fontSize:18}}>${fmt(t.amount)}</span>
                  </div>
                ))}
                <div style={{marginTop:16,padding:12,background:'#1c2333',borderRadius:8,fontSize:13,color:'#8b949e'}}>
                  💡 Click <strong style={{color:'#d4a017'}}>"Settle & Notify"</strong> above to send these to all players via Telegram.
                </div>
              </div>
            )}
          </div>

          <div style={S.card}>
            <div style={S.cardTitle}>Player Results</div>
            {[...active].sort((a,b)=>calcResult(b)-calcResult(a)).map((p,i) => {
              const r = calcResult(p);
              return (
                <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'10px 0',borderBottom:'1px solid #30363d',alignItems:'center'}}>
                  <span style={{fontWeight:500}}>{p.name}</span>
                  <span style={{fontWeight:700,fontSize:16,color:r>0?'#3fb950':r<0?'#f85149':'#8b949e'}}>{r>0?'+':''}${fmt(Math.abs(r))}</span>
                </div>
              );
            })}
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginTop:16}}>
              {[['Total Pot',`$${fmt(totIn)}`,'#d4a017'],['Total Out',`$${fmt(totOut)}`,'#d4a017'],['House Net',`$${fmt(expNet)}`,expNet>0?'#3fb950':expNet<0?'#f85149':'#8b949e']].map(([lbl,val,color])=>(
                <div key={lbl} style={{background:'#1c2333',border:'1px solid #30363d',borderRadius:8,padding:14,textAlign:'center'}}>
                  <div style={{fontSize:11,color:'#8b949e',textTransform:'uppercase',letterSpacing:.5,marginBottom:6}}>{lbl}</div>
                  <div style={{fontSize:22,fontWeight:700,color}}>{val}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{position:'fixed',bottom:24,right:24,background:'#1c2333',border:'1px solid #d4a017',color:'#e6edf3',padding:'12px 18px',borderRadius:8,fontSize:14,fontWeight:500,zIndex:9999}}>
          {toast}
        </div>
      )}
    </div>
  );
}
