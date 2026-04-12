const TelegramBot = require('node-telegram-bot-api');
const { pool } = require('./db');

let bot = null;

function initBot(token) {
  if (!token) {
    console.log('⚠️  No TELEGRAM_BOT_TOKEN set — bot disabled');
    return null;
  }

  bot = new TelegramBot(token, { polling: true });

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username;
    const firstName = msg.from.first_name;

    // Check if already registered
    const existing = await pool.query(
      'SELECT p.* FROM players p JOIN telegram_registrations tr ON tr.player_id = p.id WHERE tr.telegram_id = $1',
      [chatId]
    );

    if (existing.rows.length) {
      const player = existing.rows[0];
      return bot.sendMessage(chatId,
        `👋 Welcome back, ${player.name}!\n\nYou're registered with Pocketbooks. You'll receive notifications when game settlements are calculated.`
      );
    }

    bot.sendMessage(chatId,
      `🃏 *Welcome to Pocketbooks!*\n\nI'm your poker ledger bot. I'll send you notifications about buy-ins, results, and who owes who after each game.\n\nTo get started, tell me your name:\n\n_Just type your first and last name_`,
      { parse_mode: 'Markdown' }
    );

    // Listen for their name
    bot.once('message', async (nameMsg) => {
      if (nameMsg.chat.id !== chatId) return;
      const name = nameMsg.text.trim();
      if (name.startsWith('/')) return;

      try {
        // Check if player exists by name
        let player = await pool.query(
          'SELECT * FROM players WHERE LOWER(name) = LOWER($1) LIMIT 1',
          [name]
        );

        if (player.rows.length) {
          // Link existing player
          await pool.query(
            'UPDATE players SET telegram_id = $1, telegram_username = $2 WHERE id = $3',
            [chatId, username, player.rows[0].id]
          );
          await pool.query(
            `INSERT INTO telegram_registrations (telegram_id, player_id) VALUES ($1, $2)
             ON CONFLICT (telegram_id) DO UPDATE SET player_id = $2`,
            [chatId, player.rows[0].id]
          );
          bot.sendMessage(chatId,
            `✅ *Linked!* You're now connected as *${name}*.\n\nYou'll get notified whenever you're in a game. Let's play! 🎰`,
            { parse_mode: 'Markdown' }
          );
        } else {
          // Create new player
          const newPlayer = await pool.query(
            'INSERT INTO players (name, telegram_id, telegram_username) VALUES ($1, $2, $3) RETURNING *',
            [name, chatId, username]
          );
          await pool.query(
            `INSERT INTO telegram_registrations (telegram_id, player_id) VALUES ($1, $2)
             ON CONFLICT (telegram_id) DO UPDATE SET player_id = $2`,
            [chatId, newPlayer.rows[0].id]
          );
          bot.sendMessage(chatId,
            `✅ *Registered!* You're now in Pocketbooks as *${name}*.\n\nYou'll get notified whenever you're in a game. Let's play! 🎰`,
            { parse_mode: 'Markdown' }
          );
        }
      } catch (err) {
        console.error('Bot registration error:', err);
        bot.sendMessage(chatId, '❌ Something went wrong. Please try /start again.');
      }
    });
  });

  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const reg = await pool.query(
      'SELECT p.* FROM players p JOIN telegram_registrations tr ON tr.player_id = p.id WHERE tr.telegram_id = $1',
      [chatId]
    );
    if (!reg.rows.length) {
      return bot.sendMessage(chatId, '❌ You\'re not registered. Send /start to register.');
    }
    const player = reg.rows[0];

    // Get recent games
    const games = await pool.query(
      `SELECT g.location, g.date, gp.result, gp.owes, gp.owed
       FROM game_players gp
       JOIN games g ON g.id = gp.game_id
       WHERE gp.player_id = $1
       ORDER BY g.date DESC LIMIT 5`,
      [player.id]
    );

    let msg_text = `👤 *${player.name}*\n\n`;
    if (games.rows.length) {
      msg_text += `📋 *Recent Games:*\n`;
      games.rows.forEach(g => {
        const dt = g.date ? new Date(g.date).toLocaleDateString('en-US', {month:'short', day:'numeric'}) : '?';
        const result = parseFloat(g.result);
        const sign = result > 0 ? '+' : '';
        msg_text += `• ${g.location} (${dt}): ${sign}$${Math.abs(result).toFixed(0)}\n`;
      });
    } else {
      msg_text += '_No games recorded yet._';
    }

    bot.sendMessage(chatId, msg_text, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id,
      `🃏 *Pocketbooks Bot Commands*\n\n/start - Register or re-link your account\n/status - View your recent game history\n/help - Show this message\n\nYou'll automatically receive notifications when:\n• You're added to a game\n• Settlement is calculated\n• Someone marks a payment as paid`,
      { parse_mode: 'Markdown' }
    );
  });

  console.log('🤖 Telegram bot initialized');
  return bot;
}

async function sendNotification(telegramId, message) {
  if (!bot || !telegramId) return false;
  try {
    await bot.sendMessage(telegramId, message, { parse_mode: 'Markdown' });
    return true;
  } catch (err) {
    console.error(`Failed to notify ${telegramId}:`, err.message);
    return false;
  }
}

async function notifySettlement(gameId, settlements) {
  for (const s of settlements) {
    // Notify the payer
    if (s.from_telegram_id) {
      await sendNotification(s.from_telegram_id,
        `💸 *Game Settlement — ${s.game_location}*\n\nYou owe *${s.to_name}* $${parseFloat(s.amount).toFixed(2)}\n\n_Settle up and mark it paid in Pocketbooks._`
      );
    }
    // Notify the receiver
    if (s.to_telegram_id) {
      await sendNotification(s.to_telegram_id,
        `🏆 *Game Settlement — ${s.game_location}*\n\n*${s.from_name}* owes you $${parseFloat(s.amount).toFixed(2)}\n\n_Track payments in Pocketbooks._`
      );
    }
  }
}

async function notifyGameResult(telegramId, playerName, result, location, date) {
  if (!telegramId) return;
  const sign = result > 0 ? '+' : '';
  const emoji = result > 0 ? '🏆' : result < 0 ? '💸' : '🤝';
  await sendNotification(telegramId,
    `${emoji} *${location} Results*\n\n${playerName}: *${sign}$${Math.abs(result).toFixed(2)}*\n\n_Settlement details coming soon._`
  );
}

module.exports = { initBot, sendNotification, notifySettlement, notifyGameResult };
