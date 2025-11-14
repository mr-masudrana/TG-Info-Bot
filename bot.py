Advanced Telegram Info Bot – Vercel Deployment Version

Full code with all requested features will be placed here.

FULL Advanced Telegram Info Bot (Webhook Version for Vercel/Railway)

All 15+ features added.

from telegram import Update, Bot from telegram.ext import ApplicationBuilder, CommandHandler, ContextTypes from telegram.ext import MessageHandler, filters import os import json from datetime import datetime

TOKEN = os.getenv("BOT_TOKEN") WEBHOOK_URL = os.getenv("WEBHOOK_URL")

-------------------- UTIL FUNCTIONS --------------------

def format_dt(timestamp): return datetime.utcfromtimestamp(timestamp).strftime('%Y-%m-%d %H:%M:%S') if timestamp else "N/A"

-------------------- MAIN INFO FUNCTION --------------------

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE): user = update.effective_user chat = update.effective_chat bot = context.bot

# BASIC INFO
user_id = user.id
username = f"@{user.username}" if user.username else "N/A"
full_name = f"{user.first_name} {user.last_name if user.last_name else ''}".strip()
chat_id = chat.id
chat_type = chat.type
lang = user.language_code or "N/A"
is_premium = "Yes" if user.is_premium else "No"
is_bot = "Yes" if user.is_bot else "No"

# USER BIO
try:
    bio = (await bot.get_chat(user_id)).bio or "N/A"
except:
    bio = "N/A"

# PROFILE PHOTOS
try:
    photos = await bot.get_user_profile_photos(user_id)
    photo_count = photos.total_count
except:
    photo_count = 0

# GROUP/CHANNEL EXTRA INFO
group_title = "N/A"
members = "N/A"
owner = "N/A"
admin_list = "N/A"
user_admin = "N/A"
invite_link = "N/A"
join_date = "N/A"
permissions = "N/A"

if chat_type in ["group", "supergroup", "channel"]:

    try:
        group_title = chat.title
    except:
        pass

    # MEMBERS COUNT
    try:
        members = await bot.get_chat_member_count(chat_id)
    except:
        pass

    # ADMIN CHECK
    try:
        member = await bot.get_chat_member(chat_id, user_id)
        user_admin = member.status
        if member.status in ["administrator", "creator"]:
            user_admin = "Yes"
        else:
            user_admin = "No"
    except:
        user_admin = "N/A"

    # PERMISSIONS
    try:
        member = await bot.get_chat_member(chat_id, user_id)
        permissions = json.dumps(member.to_dict(), indent=2)
    except:
        pass

    # OWNER DETECT
    try:
        admins = await bot.get_chat_administrators(chat_id)
        for a in admins:
            if a.status == "creator":
                owner = f"{a.user.first_name} ({a.user.id})"
        admin_list = "

".join([f"• {adm.user.first_name} ({adm.user.id})" for adm in admins]) except: pass

# JOIN DATE
    try:
        member = await bot.get_chat_member(chat_id, user_id)
        if member.until_date:
            join_date = format_dt(member.until_date)
    except:
        pass

    # INVITE LINK
    try:
        chat_data = await bot.get_chat(chat_id)
        invite_link = chat_data.invite_link or "N/A"
    except:
        pass

# ACCOUNT AGE ESTIMATE
if user_id < 1000000000:
    age = "Old (2015-2018)"
elif user_id < 2000000000:
    age = "Medium (2019-2021)"
else:
    age = "New (2022-2025)"

# SAFETY SCORE
score = 0
if user.username: score += 20
if photo_count > 0: score += 20
if bio != "N/A": score += 20
if is_premium == "Yes": score += 20
if age.startswith("Old"): score += 20

# -------------------- FINAL MESSAGE -------------------- #

msg = f"""

<b>⚡️ Advanced Telegram Info Bot</b>

<b>👤 User Info</b> ━━━━━━━━━━━━━━ <b>Name:</b> {full_name} <b>Username:</b> {username} <b>User ID:</b> <code>{user_id}</code> <b>Language:</b> {lang} <b>Premium:</b> {is_premium} <b>Bot Account:</b> {is_bot} <b>Bio:</b> {bio} <b>Profile Photos:</b> {photo_count} <b>Account Age (Est):</b> {age} <b>Safety Score:</b> {score}/100

<b>💬 Chat Info</b> ━━━━━━━━━━━━━━ <b>Chat ID:</b> <code>{chat_id}</code> <b>Chat Type:</b> {chat_type} <b>Title:</b> {group_title} <b>Members:</b> {members} <b>Invite Link:</b> {invite_link}

<b>👮 Admin Info</b> ━━━━━━━━━━━━━━ <b>User Admin:</b> {user_admin} <b>Group Owner:</b> {owner}

<b>👥 Admin List:</b> {admin_list}

<b>⏳ Join Date:</b> {join_date}

<b>📌 Permissions:</b> <code>{permissions}</code> """

await update.message.reply_text(msg, parse_mode="HTML")

-------------------- WEBHOOK SETUP --------------------

async def set_webhook(): bot = Bot(TOKEN) await bot.delete_webhook() await bot.set_webhook(url=f"{WEBHOOK_URL}/webhook")

def build_app(): app = ApplicationBuilder().token(TOKEN).build()

app.add_handler(CommandHandler("start", start))
app.add_handler(CommandHandler("info", start))

return app

-------------------- Vercel Handler (api/webhook.py) --------------------

Use this file under /api/webhook.py in Vercel

from telegram.ext import Application from telegram import Update import functions_framework

app_instance = build_app()

@functions_framework.http def webhook(request): if request.method == "POST": update = Update.de_json(request.get_json(force=True), app_instance.bot) app_instance.process_update(update) return "OK", 200 return "Webhook running", 200

-------------------- api/setwebhook.py --------------------

Hit this route once to activate webhook

import requests

def handler(request): url = f"{WEBHOOK_URL}/api/webhook" r = requests.get(f"https://api.telegram.org/bot{TOKEN}/setWebhook?url={url}") return r.text
