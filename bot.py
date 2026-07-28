import os
import sqlite3
import asyncio
import random
from flask import Flask
from threading import Thread
from pyrogram import Client, filters
from pyrogram.types import InlineKeyboardButton, InlineKeyboardMarkup

# ================== RENDER WEB SERVER ==================
app_web = Flask(__name__)

@app_web.route('/')
def home():
    return "Bot is Alive!"

def run():
    port = int(os.environ.get("PORT", 8080))
    app_web.run(host='0.0.0.0', port=port)

# ================== BOT CONFIG ==================
# Ye variables Render ke Environment Variables se aayenge
API_ID = int(os.environ.get("API_ID", "31068209"))
API_HASH = os.environ.get("API_HASH", "23883c643d5a596ce49070e9ae9300d0")
BOT_TOKEN = os.environ.get("BOT_TOKEN", "8293292993:AAEvT_FiUSk6tSibpniYjVYVJDaA1OSESo4")
ADMIN_ID = int(os.environ.get("ADMIN_ID", "7663556460"))

# Bot Status
BOT_ON = True
REFER_REWARD = 2
MIN_WITHDRAW = 50

# ================== DATABASE ==================
conn = sqlite3.connect("users.db", check_same_thread=False)
c = conn.cursor()
c.execute("""CREATE TABLE IF NOT EXISTS users (
    user_id INTEGER PRIMARY KEY, 
    inviter_id INTEGER, 
    balance INTEGER DEFAULT 0, 
    verified INTEGER DEFAULT 0, 
    is_new INTEGER DEFAULT 1)""")
conn.commit()

bot = Client("CashFactoryBot", api_id=API_ID, api_hash=API_HASH, bot_token=BOT_TOKEN)

# ================== KEYBOARDS ==================
def main_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("💰 Balance", callback_data="balance"), InlineKeyboardButton("👥 Refer", callback_data="refer")],
        [InlineKeyboardButton("📤 Withdraw", callback_data="withdraw")],
        [InlineKeyboardButton("✅ Verify", callback_data="verify")]
    ])

def admin_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("📢 Broadcast", callback_data="broadcast")],
        [InlineKeyboardButton("📊 Stats", callback_data="stats"), InlineKeyboardButton("🛑 Toggle Bot", callback_data="toggle")]
    ])

# ================== HANDLERS ==================

@bot.on_message(filters.command("start"))
async def start_cmd(_, m):
    uid = m.from_user.id
    
    # Check if bot is off
    if not BOT_ON and uid != ADMIN_ID:
        return await m.reply("⚠️ Bot is currently under maintenance.")

    # Referral system
    inviter = None
    if len(m.command) > 1:
        try:
            inviter = int(m.command[1])
            if inviter == uid: inviter = None
        except: pass

    # Add user to DB
    c.execute("INSERT OR IGNORE INTO users (user_id, inviter_id) VALUES (?, ?)", (uid, inviter))
    conn.commit()

    if uid == ADMIN_ID:
        await m.reply("👑 Admin Panel Open", reply_markup=admin_menu())
    else:
        await m.reply(f"👋 Welcome {m.from_user.first_name}!\nEarn money by referring friends.", reply_markup=main_menu())

@bot.on_callback_query()
async def cb_data(_, q):
    uid = q.from_user.id
    data = q.data
    
    c.execute("SELECT * FROM users WHERE user_id=?", (uid,))
    user = c.fetchone()

    if data == "balance":
        await q.answer()
        await q.message.edit_text(f"💰 Your Balance: ₹{user[2]}\n\nInvite more friends to earn!", reply_markup=main_menu())

    elif data == "refer":
        bot_info = await bot.get_me()
        ref_link = f"https://t.me/{bot_info.username}?start={uid}"
        await q.message.edit_text(f"👥 Refer & Earn\n\nPer Refer: ₹{REFER_REWARD}\n\nYour Link: `{ref_link}`", reply_markup=main_menu())

    elif data == "verify":
        if user[3] == 1:
            return await q.answer("Already Verified ✅", show_alert=True)
        
        # Verify user
        c.execute("UPDATE users SET verified=1 WHERE user_id=?", (uid,))
        
        # Give reward to inviter
        if user[1] and user[4] == 1: # if has inviter and is new
            c.execute("UPDATE users SET balance=balance+?, is_new=0 WHERE user_id=?", (REFER_REWARD, user[1]))
            try: await bot.send_message(user[1], f"🎉 New Referral! You got ₹{REFER_REWARD}")
            except: pass
        
        conn.commit()
        await q.answer("Verified Successfully! ✅", show_alert=True)
        await q.message.edit_text("✅ Account Verified! You can now withdraw.", reply_markup=main_menu())

    elif data == "withdraw":
        if user[2] < MIN_WITHDRAW:
            return await q.answer(f"❌ Minimum ₹{MIN_WITHDRAW} required!", show_alert=True)
        await q.answer("Request Sent to Admin!", show_alert=True)
        await bot.send_message(ADMIN_ID, f"📤 **Withdraw Request**\nUser ID: `{uid}`\nAmount: ₹{user[2]}")

    # Admin actions
    if uid == ADMIN_ID:
        if data == "stats":
            c.execute("SELECT COUNT(*) FROM users")
            total = c.fetchone()[0]
            await q.answer(f"Total Users: {total}", show_alert=True)
        elif data == "toggle":
            global BOT_ON
            BOT_ON = not BOT_ON
            await q.answer(f"Bot {'ON' if BOT_ON else 'OFF'}", show_alert=True)

# ================== START BOT ==================
if __name__ == "__main__":
    # Start Flask Server
    Thread(target=run).start()
    # Start Telegram Bot
    print("Bot is starting...")
    bot.run()
