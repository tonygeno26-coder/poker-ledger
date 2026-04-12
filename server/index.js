require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { pool, initDB } = require('./db');
const { initBot, notifySettlement, notifyGameResult } = require('./bot');

const app = express();
app.use(cors());
app.use(express.json());

// ===== INIT =====
let bot;
(async () => {
  await initDB();
  bot = initBot(process.env.TELEGRAM_BOT_TOKEN);
})();

// ===== HEALTH =====
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

// ===== PLAYERS =====

// Get all players
app.get('/api/players', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM players ORDER BY name ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create player
app.post('/api/players', async (req, res) => {
  const { name, nickname, notes } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO players (name, nickname, notes) VALUES ($1, $2, $3) RETURNING *',
      [name, nickname, notes]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update player
app.put('/api/players/:id', async (req, res) => {
  const { name, nickname, notes } = req.body;
  try {
    const result = await pool.query(
      'UPDATE players SET name=$1, nickname=$2, notes=$3 WHERE id=$4 RETURNING *',
      [name, nickname, notes, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete player
app.delete('/api/players/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM players WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get player stats (lifetime)
app.get('/api/players/:id/stats', async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT
        COUNT(*) as games_played,
        SUM(result) as total_result,
        SUM(total_in) as total_in,
        SUM(total_out) as total_out,
        MAX(result) as best_session,
        MIN(result) as worst_session,
        AVG(result) as avg_result
      FROM game_players
      WHERE player_id = $1
    `, [req.params.id]);

    const recent = await pool.query(`
      SELECT g.location, g.date, g.stakes, gp.result, gp.total_in, gp.total_out
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      WHERE gp.player_id = $1
      ORDER BY g.date DESC
      LIMIT 10
    `, [req.params.id]);

    res.json({ stats: stats.rows[0], recent: recent.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== GAMES =====

// Get all games
app.get('/api/games', async (req, res) => {
  try {
    const games = await pool.query(`
      SELECT g.*,
        COUNT(gp.id) as player_count,
        SUM(gp.total_in) as total_pot
      FROM games g
      LEFT JOIN game_players gp ON gp.game_id = g.id
      GROUP BY g.id
      ORDER BY g.date DESC, g.created_at DESC
    `);
    res.json(games.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single game with all details
app.get('/api/games/:id', async (req, res) => {
  try {
    const game = await pool.query('SELECT * FROM games WHERE id=$1', [req.params.id]);
    if (!game.rows.length) return res.status(404).json({ error: 'Game not found' });

    const players = await pool.query(`
      SELECT gp.*, p.telegram_id, p.telegram_username
      FROM game_players gp
      LEFT JOIN players p ON p.id = gp.player_id
      WHERE gp.game_id = $1
      ORDER BY gp.result DESC
    `, [req.params.id]);

    const expenses = await pool.query('SELECT * FROM expenses WHERE game_id=$1', [req.params.id]);
    const partners = await pool.query('SELECT * FROM partners WHERE game_id=$1', [req.params.id]);
    const settlements = await pool.query('SELECT * FROM settlements WHERE game_id=$1', [req.params.id]);

    res.json({
      game: game.rows[0],
      players: players.rows,
      expenses: expenses.rows[0] || null,
      partners: partners.rows,
      settlements: settlements.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create or update game
app.post('/api/games', async (req, res) => {
  const { id, location, date, game_type, stakes, status, data, players, expenses, partners } = req.body;
  try {
    let game;
    if (id) {
      game = await pool.query(
        'UPDATE games SET location=$1, date=$2, game_type=$3, stakes=$4, status=$5, data=$6 WHERE id=$7 RETURNING *',
        [location, date, game_type, stakes, status || 'active', data, id]
      );
    } else {
      game = await pool.query(
        'INSERT INTO games (location, date, game_type, stakes, status, data) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [location, date, game_type, stakes, status || 'active', data]
      );
    }
    const gameId = game.rows[0].id;

    // Upsert players
    if (players && players.length) {
      await pool.query('DELETE FROM game_players WHERE game_id=$1', [gameId]);
      for (const p of players) {
        const totalIn = (parseFloat(p.buyinCash)||0) + (parseFloat(p.buyinMarker)||0) +
          (p.addons || []).reduce((s, a) => s + (parseFloat(a)||0), 0);
        const totalOut = (parseFloat(p.cashOut)||0) + (parseFloat(p.markerOut)||0);
        const result = totalOut - totalIn;
        const owes = result < 0 ? Math.abs(result) : 0;
        const owed = result > 0 ? result : 0;

        await pool.query(`
          INSERT INTO game_players
            (game_id, player_id, player_name, buyin_cash, buyin_marker, addons,
             total_in, cash_out, marker_out, total_out, result, pay_in, pay_out,
             paid_in, paid_out, owes, owed)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        `, [
          gameId, p.player_id || null, p.name,
          p.buyinCash||0, p.buyinMarker||0, JSON.stringify(p.addons||[]),
          totalIn, p.cashOut||0, p.markerOut||0, totalOut, result,
          p.payIn||0, p.payOut||0, p.paidIn||0, p.paidOut||0, owes, owed
        ]);
      }
    }

    // Upsert expenses
    if (expenses) {
      await pool.query('DELETE FROM expenses WHERE game_id=$1', [gameId]);
      await pool.query(`
        INSERT INTO expenses (game_id, base, tips, misc, gross, comm_pct, commission, net, paid, owed)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `, [gameId, expenses.base||0, expenses.tips||0, expenses.misc||0,
          expenses.gross||0, expenses.commPct||0, expenses.commission||0,
          expenses.net||0, expenses.paid||0, expenses.owed||0]);
    }

    // Upsert partners
    if (partners && partners.length) {
      await pool.query('DELETE FROM partners WHERE game_id=$1', [gameId]);
      for (const p of partners) {
        await pool.query(
          'INSERT INTO partners (game_id, name, pct, share, paid, owed) VALUES ($1,$2,$3,$4,$5,$6)',
          [gameId, p.name, p.pct||0, p.share||0, p.paid||0, p.owed||0]
        );
      }
    }

    res.json({ success: true, game: game.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== SETTLEMENT =====

// Calculate and save settlement + send notifications
app.post('/api/games/:id/settle', async (req, res) => {
  try {
    const gameResult = await pool.query('SELECT * FROM games WHERE id=$1', [req.params.id]);
    if (!gameResult.rows.length) return res.status(404).json({ error: 'Game not found' });
    const game = gameResult.rows[0];

    const players = await pool.query(`
      SELECT gp.*, p.telegram_id, p.name as reg_name
      FROM game_players gp
      LEFT JOIN players p ON p.id = gp.player_id
      WHERE gp.game_id = $1
    `, [req.params.id]);

    // Calculate settlement (minimum transactions)
    const balances = players.rows.map(p => ({
      id: p.player_id,
      name: p.player_name,
      balance: parseFloat(p.result),
      telegram_id: p.telegram_id
    }));

    const transactions = minTransactions(balances);

    // Save settlements
    await pool.query('DELETE FROM settlements WHERE game_id=$1', [req.params.id]);
    const savedSettlements = [];
    for (const t of transactions) {
      const s = await pool.query(`
        INSERT INTO settlements (game_id, from_player_id, from_name, to_player_id, to_name, amount)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
      `, [req.params.id, t.fromId, t.from, t.toId, t.to, t.amount]);
      savedSettlements.push({
        ...s.rows[0],
        from_telegram_id: t.fromTelegram,
        to_telegram_id: t.toTelegram,
        game_location: game.location
      });
    }

    // Update game status
    await pool.query('UPDATE games SET status=$1, completed_at=NOW() WHERE id=$2', ['settled', req.params.id]);

    // Send Telegram notifications
    const notifyResults = [];
    for (const p of players.rows) {
      if (p.telegram_id) {
        const result = parseFloat(p.result);
        await notifyGameResult(p.telegram_id, p.player_name, result, game.location, game.date);
        notifyResults.push({ player: p.player_name, notified: true });
      }
    }

    // Send settlement notifications
    await notifySettlement(req.params.id, savedSettlements);

    res.json({
      success: true,
      settlements: savedSettlements,
      notifications: notifyResults
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark settlement as paid
app.put('/api/settlements/:id/paid', async (req, res) => {
  try {
    const s = await pool.query(
      'UPDATE settlements SET paid=TRUE WHERE id=$1 RETURNING *',
      [req.params.id]
    );
    if (!s.rows.length) return res.status(404).json({ error: 'Not found' });

    // Notify both parties
    const settlement = s.rows[0];
    const gameResult = await pool.query('SELECT * FROM games WHERE id=$1', [settlement.game_id]);
    const game = gameResult.rows[0];

    // Get telegram IDs
    const fromPlayer = await pool.query('SELECT telegram_id FROM players WHERE id=$1', [settlement.from_player_id]);
    const toPlayer = await pool.query('SELECT telegram_id FROM players WHERE id=$1', [settlement.to_player_id]);

    if (fromPlayer.rows[0]?.telegram_id) {
      const { sendNotification } = require('./bot');
      await sendNotification(fromPlayer.rows[0].telegram_id,
        `✅ *Payment Confirmed*\n\nYour $${parseFloat(settlement.amount).toFixed(2)} payment to *${settlement.to_name}* for ${game.location} has been marked as paid!`
      );
    }
    if (toPlayer.rows[0]?.telegram_id) {
      const { sendNotification } = require('./bot');
      await sendNotification(toPlayer.rows[0].telegram_id,
        `💰 *Payment Received*\n\n*${settlement.from_name}* paid you $${parseFloat(settlement.amount).toFixed(2)} for ${game.location}!`
      );
    }

    res.json(s.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== STATS =====
app.get('/api/stats', async (req, res) => {
  try {
    const leaderboard = await pool.query(`
      SELECT
        p.id, p.name,
        COUNT(gp.id) as games,
        SUM(gp.result) as total_result,
        SUM(gp.total_in) as total_in,
        MAX(gp.result) as best,
        MIN(gp.result) as worst
      FROM players p
      JOIN game_players gp ON gp.player_id = p.id
      GROUP BY p.id, p.name
      ORDER BY total_result DESC
    `);

    const totals = await pool.query(`
      SELECT COUNT(*) as total_games, SUM(total_in) as total_money
      FROM (SELECT g.id, SUM(gp.total_in) as total_in FROM games g JOIN game_players gp ON gp.game_id = g.id GROUP BY g.id) sub
    `);

    res.json({ leaderboard: leaderboard.rows, totals: totals.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== HELPERS =====
function minTransactions(balances) {
  let debtors = balances.filter(b => b.balance < 0).map(b => ({ ...b, amount: Math.abs(b.balance) }));
  let creditors = balances.filter(b => b.balance > 0).map(b => ({ ...b, amount: b.balance }));
  const transactions = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amount, creditors[j].amount);
    if (pay > 0.005) {
      transactions.push({
        from: debtors[i].name, fromId: debtors[i].id, fromTelegram: debtors[i].telegram_id,
        to: creditors[j].name, toId: creditors[j].id, toTelegram: creditors[j].telegram_id,
        amount: Math.round(pay * 100) / 100
      });
    }
    debtors[i].amount -= pay;
    creditors[j].amount -= pay;
    if (debtors[i].amount < 0.005) i++;
    if (creditors[j].amount < 0.005) j++;
  }
  return transactions;
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🃏 Pocketbooks server running on port ${PORT}`));
