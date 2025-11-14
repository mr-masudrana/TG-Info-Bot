// index.js
require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // e.g. https://yourdomain.com/webhook
const PORT = process.env.PORT || 3000;
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(',').map(s => s.trim()).filter(Boolean).map(Number);

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN missing in .env");
  process.exit(1);
}
if (!WEBHOOK_URL) {
  console.warn("WEBHOOK_URL not set. You can still run locally but set webhook to receive updates from Telegram.");
}

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const app = express();
app.use(express.json({ limit: '1mb' }));

// Simple in-memory rate limit: { userId: {count, ts} }
const rateLimit = {};
const RATE_LIMIT_WINDOW = 10 * 1000; // 10s window
const RATE_LIMIT_MAX = 5; // max 5 commands per 10s

const USERS_FILE = path.join(__dirname, 'users.json');
function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE));
  } catch {
    return {};
  }
}
function saveUsers(j) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(j, null, 2));
}
const usersDb = loadUsers();

// helper: call Telegram API
async function tg(method, params = {}) {
  // choose GET for no-bodied simple requests
  const url = `${API}/${method}`;
  const hasBody = Object.keys(params).length > 0;
  if (!hasBody) {
    const res = await fetch(url);
    return res.json();
  } else {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    return res.json();
  }
}

async function sendMessage(chat_id, text, extra = {}) {
  return tg('sendMessage', Object.assign({ chat_id, text, parse_mode: 'HTML' }, extra));
}

function recordUser(u) {
  if (!u) return;
  const id = u.id;
  if (!usersDb[id]) {
    usersDb[id] = {
      id,
      first_name: u.first_name || '',
      last_name: u.last_name || '',
      username: u.username || '',
      count: 1,
      last: Date.now()
    };
  } else {
    usersDb[id].count = (usersDb[id].count || 0) + 1;
    usersDb[id].last = Date.now();
  }
  saveUsers(usersDb);
}

function checkRateLimit(userId) {
  const now = Date.now();
  const entry = rateLimit[userId] || { count: 0, ts: now };
  if (now - entry.ts > RATE_LIMIT_WINDOW) {
    entry.count = 1;
    entry.ts = now;
    rateLimit[userId] = entry;
    return false;
  } else {
    entry.count++;
    rateLimit[userId] = entry;
    return entry.count > RATE_LIMIT_MAX;
  }
}

// webhook endpoint
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // respond quickly
  try {
    const update = req.body;
    if (!update) return;
    // handle message updates (basic)
    const message = update.message || update.edited_message;
    if (!message) return;

    const chatId = message.chat.id;
    const from = message.from;
    recordUser(from);

    // rate limit
    if (checkRateLimit(from.id)) {
      await sendMessage(chatId, "⚠️ আপনি খুব দ্রুত অনুরোধ করছেন — একটু ধৈর্য্য ধরুন।");
      return;
    }

    const text = (message.text || '').trim();
    if (!text) return;

    // parse command
    const parts = text.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    if (cmd === '/start') {
      const msg = `হ্যালো ${from.first_name || ''}!\nএই বটটি ইউজার/চ্যানেল/গ্রুপ ইনফো দেখাতে তৈরি করা হয়েছে.\n\nকমান্ড: /me, /botinfo, /userinfo, /groupinfo, /channelinfo, /profilephoto\n\nউদাহরণ: <code>/userinfo 12345678</code> অথবা রিপ্লাই করে <code>/userinfo</code>`;
      await sendMessage(chatId, msg);
    } else if (cmd === '/me') {
      // show info about the user who sent the command
      const u = from;
      let out = `<b>User Info</b>\n`;
      out += `ID: <code>${u.id}</code>\n`;
      out += `Name: ${u.first_name || ''} ${u.last_name || ''}\n`;
      out += `Username: ${u.username ? '@' + u.username : '—'}\n`;
      out += `Is Bot: ${u.is_bot ? 'Yes' : 'No'}\n`;
      await sendMessage(chatId, out);
    } else if (cmd === '/botinfo') {
      const me = await tg('getMe');
      if (me.ok) {
        const b = me.result;
        let out = `<b>Bot Info</b>\n`;
        out += `ID: <code>${b.id}</code>\n`;
        out += `Name: ${b.first_name}\n`;
        out += `Username: @${b.username}\n`;
        await sendMessage(chatId, out);
      } else {
        await sendMessage(chatId, "Bot info পাওয়া যায়নি।");
      }
    } else if (cmd === '/userinfo') {
      // if message is reply, use replied user; else accept argument userId or @username
      let targetId = null;
      if (message.reply_to_message && message.reply_to_message.from) {
        targetId = message.reply_to_message.from.id;
      } else if (args[0]) {
        const arg = args[0].trim();
        if (/^\d+$/.test(arg)) targetId = Number(arg);
        else targetId = arg; // username
      } else {
        await sendMessage(chatId, "ব্যবহারের পদ্ধতি: /userinfo <userId|@username>\nবা কারো মেসেজ রিপ্লাই করে /userinfo পাঠাও।");
        return;
      }

      try {
        // getChatMember works for bots that are in same chat where the user is; but for global info we use getChat if username (works for channels)
        let infoText = `<b>Requested user info</b>\n`;
        // Try getChatMember in current chat first (if numeric)
        if (typeof targetId === 'number') {
          // getChatMember requires a chat id + user id — we try getChatMember with same chat
          try {
            const memberRes = await tg('getChatMember', { chat_id: chatId, user_id: targetId });
            if (memberRes.ok) {
              const m = memberRes.result;
              infoText += `User ID: <code>${m.user.id}</code>\n`;
              infoText += `Name: ${m.user.first_name || ''} ${m.user.last_name || ''}\n`;
              infoText += `Username: ${m.user.username ? '@' + m.user.username : '—'}\n`;
              infoText += `Status in this chat: ${m.status}\n`;
              await sendMessage(chatId, infoText);
              return;
            }
          } catch (e) {
            // fallback
          }
          // fallback: try getChat on 'user' id (this typically fails for users)
        } else {
          // if username (like @channel or @username) we try getChat
          const g = await tg('getChat', { chat_id: targetId });
          if (g.ok) {
            const r = g.result;
            infoText += `Chat ID: <code>${r.id}</code>\n`;
            infoText += `Title/Name: ${r.title || r.first_name || ''}\n`;
            infoText += `Type: ${r.type}\n`;
            infoText += `Username: ${r.username ? '@' + r.username : '—'}\n`;
            await sendMessage(chatId, infoText);
            return;
          } else {
            await sendMessage(chatId, "ব্যবহারকারীর তথ্য পাওয়া গেল না। (বট এবং টার্গেট চ্যাট-এ থাকা আবশ্যক অথবা ইউজারনেম ভুল হতে পারে)");
            return;
          }
        }

        await sendMessage(chatId, "লুকআপ সম্পন্ন হয়নি — লক্ষ্য ব্যবহারকারী/চ্যানেল বটের অ্যাক্সেসে আছে কিনা চেক করে দেখুন।");
      } catch (err) {
        console.error(err);
        await sendMessage(chatId, "কিছু একটা সমস্যা হয়েছে userinfo চালানোর সময়।");
      }
    } else if (cmd === '/groupinfo' || cmd === '/channelinfo') {
      // arg should be chat id or @username
      const target = args[0];
      if (!target) {
        await sendMessage(chatId, `ব্যবহার: ${cmd} <chatId|@username>`);
        return;
      }
      try {
        const g = await tg('getChat', { chat_id: target });
        if (!g.ok) {
          await sendMessage(chatId, "Chat পাওয়া যায়নি — বটকে সেই চ্যাটে যোগ করে দেখুন অথবা username সঠিক কিনা চেক করুন।");
          return;
        }
        const r = g.result;
        let out = `<b>Chat Info</b>\n`;
        out += `ID: <code>${r.id}</code>\n`;
        out += `Title: ${r.title || r.first_name || ''}\n`;
        out += `Type: ${r.type}\n`;
        out += `Username: ${r.username ? '@' + r.username : '—'}\n`;
        // member count (may require bot permissions)
        try {
          const cntRes = await tg('getChatMemberCount', { chat_id: r.id });
          if (cntRes.ok) out += `Members: <code>${cntRes.result}</code>\n`;
        } catch (e) {
          // ignore
        }
        // administrators
        try {
          const admRes = await tg('getChatAdministrators', { chat_id: r.id });
          if (admRes.ok) {
            const admins = admRes.result.map(a => `${a.user.username ? '@' + a.user.username : a.user.first_name || ''} (${a.user.id})`).slice(0, 20);
            out += `Admins: \n` + admins.join('\n');
          }
        } catch (e) {}
        await sendMessage(chatId, out);
      } catch (e) {
        console.error(e);
        await sendMessage(chatId, "চ্যাট তথ্য আনতে সমস্যা হয়েছে।");
      }
    } else if (cmd === '/admins') {
      const target = args[0] || chatId;
      try {
        const admRes = await tg('getChatAdministrators', { chat_id: target });
        if (!admRes.ok) {
          await sendMessage(chatId, "অ্যাডমিন তালিকা পাওয়া যায়নি।");
          return;
        }
        const admins = admRes.result;
        const lines = admins.map(a => {
          const u = a.user;
          return `${u.first_name || ''} ${u.username ? '(@' + u.username + ')' : ''} — ${a.status}`;
        });
        await sendMessage(chatId, `<b>Admins of ${target}:</b>\n` + lines.join('\n'));
      } catch (e) {
        console.error(e);
        await sendMessage(chatId, "অ্যাডমিন তালিকা আনতে সমস্যা হয়েছে।");
      }
    } else if (cmd === '/profilephoto') {
      // reply, or arg userId
      let target;
      if (message.reply_to_message && message.reply_to_message.from) target = message.reply_to_message.from.id;
      else if (args[0]) target = args[0];
      else target = from.id;
      try {
        const photos = await tg('getUserProfilePhotos', { user_id: target, limit: 1 });
        if (!photos.ok || photos.result.total_count === 0) {
          await sendMessage(chatId, "প্রোফাইল ফটো পাওয়া যায়নি।");
          return;
        }
        const photo = photos.result.photos[0].slice(-1)[0]; // largest size
        const fileRes = await tg('getFile', { file_id: photo.file_id });
        if (fileRes.ok) {
          const filePath = fileRes.result.file_path;
          const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
          // send as photo
          await tg('sendPhoto', { chat_id: chatId, photo: fileUrl, caption: `Profile photo of ${target}` });
        } else {
          await sendMessage(chatId, "ফাইল রিট্রিভায়ার সমস্যা হয়েছে।");
        }
      } catch (e) {
        console.error(e);
        await sendMessage(chatId, "প্রোফাইল ফটো আনতে সমস্যা হয়েছে।");
      }
    } else if (cmd === '/setwebhook') {
      // only admin
      if (!ADMIN_IDS.includes(from.id)) {
        await sendMessage(chatId, "এই কমান্ড ব্যবহারের অনুমতি আপনি পাচ্ছেন না।");
        return;
      }
      // set webhook to WEBHOOK_URL
      if (!WEBHOOK_URL) {
        await sendMessage(chatId, "WEBHOOK_URL অ্যাড করা হয়নি .env ফাইলে।");
        return;
      }
      try {
        const path = '/webhook';
        const r = await tg('setWebhook', { url: `${WEBHOOK_URL}${path}` });
        if (r.ok) await sendMessage(chatId, "Webhook সেট হয়েছে: " + JSON.stringify(r.result));
        else await sendMessage(chatId, "Webhook সেটিং ব্যর্থ: " + JSON.stringify(r));
      } catch (e) {
        console.error(e);
        await sendMessage(chatId, "Webhook সেট করতে সমস্যা।");
      }
    } else if (cmd === '/whoami') {
      // try determine role in current chat
      try {
        const memberRes = await tg('getChatMember', { chat_id: chatId, user_id: from.id });
        if (memberRes.ok) {
          await sendMessage(chatId, `আপনি এই চ্যাটে: ${memberRes.result.status}`);
        } else {
          await sendMessage(chatId, "স্ট্যাটাস পাওয়া যায়নি।");
        }
      } catch (e) {
        await sendMessage(chatId, "স্ট্যাটাস চেক করতে সমস্যা হয়েছে।");
      }
    } else if (cmd === '/stats') {
      // admin only: show number of known users
      if (!ADMIN_IDS.includes(from.id)) {
        await sendMessage(chatId, "অনুমোদিত নয়।");
        return;
      }
      const totalUsers = Object.keys(usersDb).length;
      await sendMessage(chatId, `Known users: ${totalUsers}`);
    } else {
      // unknown command - ignore or give hint
      // do nothing
    }

  } catch (err) {
    console.error("Update handler error:", err);
  }
});

// health check
app.get('/', (req, res) => res.send('Telegram Info Bot running'));

// start server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  if (WEBHOOK_URL) {
    try {
      const path = '/webhook';
      const r = await tg('setWebhook', { url: `${WEBHOOK_URL}${path}` });
      console.log('setWebhook result:', r);
    } catch (e) {
      console.error('Error setting webhook:', e);
    }
  } else {
    console.log('WEBHOOK_URL not set; remember to call setWebhook manually.');
  }
});
