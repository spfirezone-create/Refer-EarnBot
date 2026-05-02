import TelegramBot from 'node-telegram-bot-api';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, set, update, runTransaction } from 'firebase/database';
import axios from 'axios';

// --- CONFIGURATION ---
const BOT_TOKEN = '8713191692:AAH84bKAs0mrmXexjF194NWTG88KA5hkg34'; // Token
const ADMIN_ID = 7663556460; // Master Admin

// These will be auto-filled by the bot token automatically
let BOT_NAME = "Loading..."; 
let BOT_USERNAME = "Loading...";

const firebaseConfig = {
    apiKey: "AIzaSyAkpcLp-oBWk4k39QyH-5BkLM0bsYeM8ao",
    authDomain: "referearnbot.firebaseapp.com",
    databaseURL: "https://referearnbot-default-rtdb.firebaseio.com",
    projectId: "referearnbot",
    storageBucket: "referearnbot.firebasestorage.app",
    messagingSenderId: "884048848740",
    appId: "1:884048848740:web:1e10af168d6cfdd0cbfc71"
};

// --- INITIALIZATION ---
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Auto-fetch Bot Name and Username from Token
bot.getMe().then((botInfo) => {
    BOT_NAME = botInfo.first_name;
    BOT_USERNAME = botInfo.username;
    console.log(`✅ Automatically fetched bot details:`);
    console.log(`🤖 Name: ${BOT_NAME}`);
    console.log(`🔗 Username: @${BOT_USERNAME}`);
    console.log(`🚀 ${BOT_NAME} is now running!`);
}).catch(err => {
    console.error("❌ Error fetching bot info:", err.message);
});

// Prevent bot from crashing due to Telegram API polling network errors
bot.on("polling_error", (err) => console.log("Polling error:", err.message));

// --- MEMORY STATE ---
const userStates = {};

// --- MENUS ---
const USER_MENU = {
    reply_markup: {
        keyboard: [
            ['Balance', 'Refer Earn'],
            ['Bonus', 'Withdraw'],
            ['Payout method']
        ],
        resize_keyboard: true
    }
};

const ADMIN_MENU = {
    reply_markup: {
        keyboard: [
            ['🤖 Bot ON/OFF', '💸 Withdraw ON/OFF'],
            ['📢 Add Channel', '❌ Remove Channel'], 
            ['📢 Broadcast', '🆔 Chat IDs'], 
            ['📝 Channel Message'], 
            ['⚙️ Set API Gateway', '👨‍💻 Manage Admins'],
            ['⬇️ Min Withdraw', '⬆️ Max Withdraw'],
            ['💰 Refer Amount', '📉 Min Refer'],
            ['🎁 Set Bonus'],
            ['📊 Stats', '🏆 Leaderboard'],
            ['🚫 Ban User', '✅ Unban User'],
            ['💳 Reset Balance'],
            ['➕ Add Amount', '➖ Deduct Amount']
        ],
        resize_keyboard: true
    }
};

// --- UTILS ---
async function checkIsAdmin(id) {
    if (id === ADMIN_ID) return true;
    const snap = await get(ref(db, `admins/${id}`));
    return snap.exists() && snap.val() === true;
}

async function getSettings() {
    const snap = await get(ref(db, 'settings'));
    const defaultSettings = {
        botStatus: true,
        withdrawStatus: true,
        minWithdraw: 10,
        maxWithdraw: 100,
        referAmount: 5,
        minRefer: 1,
        bonusAmount: 1
    };
    if (!snap.exists()) {
        await set(ref(db, 'settings'), defaultSettings);
        return defaultSettings;
    }
    return { ...defaultSettings, ...snap.val() };
}

async function getGateways() {
    const snap = await get(ref(db, 'gateways'));
    return snap.exists() ? snap.val() : {};
}

// --- UPDATED CHECK CHANNELS FUNCTION ---
async function checkChannels(userId) {
    const snap = await get(ref(db, 'channels'));
    if (!snap.exists()) return { allJoined: true, channels: [] };
    
    const channels = Object.values(snap.val());
    let allJoined = true;
    let pending = []; 

    for (let ch of channels) {
        let chId = ch.includes('|') ? ch.split('|')[0] : ch;
        let isJoinedOrRequested = false;
        let numericChatId = chId;

        try {
            const chatInfo = await bot.getChat(chId);
            numericChatId = chatInfo.id;
            
            const member = await bot.getChatMember(numericChatId, userId);
            if (['member', 'administrator', 'creator'].includes(member.status)) {
                isJoinedOrRequested = true;
            }
        } catch (e) {
        }

        if (!isJoinedOrRequested) {
            const pendingReq = await get(ref(db, `join_requests/${numericChatId}/${userId}`));
            if (pendingReq.exists() && pendingReq.val() === true) {
                isJoinedOrRequested = true;
            }
        }

        if (!isJoinedOrRequested) {
            allJoined = false;
            pending.push(ch); 
        }
    }
    return { allJoined, channels: pending };
}

function generateJoinKeyboard(channels) {
    let buttons = channels.map((ch) => {
        let url = ch.includes('|') ? ch.split('|')[1] : `https://t.me/${ch.replace('@', '')}`;
        return { text: `📢 Join`, url: url };
    });

    let keyboard = [];
    for (let i = 0; i < buttons.length; i += 2) {
        keyboard.push(buttons.slice(i, i + 2));
    }
    keyboard.push([{ text: '✅ Verify Join', callback_data: 'verify_join' }]);
    
    return { reply_markup: { inline_keyboard: keyboard } };
}

// --- MAIN MESSAGE HANDLER ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text || ''; 
    const firstName = msg.from.first_name || 'User';

    const isAdminUser = await checkIsAdmin(userId);

    if (text === '/dev') return bot.sendMessage(chatId, "Made by [Alpha](https://t.me/ALPHAxBMW)", { parse_mode: 'Markdown', disable_web_page_preview: true });
    if (text === '/build') return bot.sendMessage(chatId, "Made by [Sunny](https://t.me/sunnybotmaker)", { parse_mode: 'Markdown', disable_web_page_preview: true });

    const settings = await getSettings();

    const banSnap = await get(ref(db, `banned/${userId}`));
    if (banSnap.exists()) return bot.sendMessage(chatId, "🚫 You are banned from using this bot.");

    if (!settings.botStatus && !isAdminUser) {
        return bot.sendMessage(chatId, `🛠 ${BOT_NAME} is currently under maintenance.`);
    }

    if (text === '/skadmin' && isAdminUser) {
        delete userStates[userId];
        return bot.sendMessage(chatId, "👨‍💻 Welcome to the Admin Panel!", ADMIN_MENU);
    }

    const userRef = ref(db, `users/${userId}`);
    const userSnap = await get(userRef);
    let userData = userSnap.exists() ? userSnap.val() : null;

    // --- START COMMAND ---
    if (text.startsWith('/start')) {
        const referredByMatch = text.split(' ')[1];
        let referredBy = false;
        if (referredByMatch && Number(referredByMatch) !== userId) {
            referredBy = Number(referredByMatch);
        }

        if (!userData) {
            userData = {
                balance: 0,
                referrals: 0,
                referredBy: referredBy,
                verified: false,
                rewardGiven: false,
                wallet: "Not Linked"
            };
            await set(userRef, userData);
        } else if (referredBy && !userData.referredBy) {
            await update(userRef, { referredBy: referredBy });
        }

        const channelStatus = await checkChannels(userId);
        if (!channelStatus.allJoined) {
            return bot.sendMessage(chatId, `⚠️ *To use ${BOT_NAME}, you MUST join our channels first!*`, Object.assign({ parse_mode: 'Markdown' }, generateJoinKeyboard(channelStatus.channels)));
        } else {
            return promptDeviceVerification(chatId, userId, firstName);
        }
    }

    if (!userData && !isAdminUser) return;

    if (userData && userData.verified === false && !isAdminUser) {
        return bot.sendMessage(chatId, "❌ You must verify your device first. Type /start to verify.");
    }

    // ==========================================
    // STATE HANDLING 
    // ==========================================
    if (userStates[userId] && userStates[userId].step) {
        const state = userStates[userId].step;
        const val = text.trim();

        if (state === 'LINK_WALLET') {
            if (!/^\d{10}$/.test(val)) {
                return bot.sendMessage(chatId, "❌ Invalid format. Please enter exactly 10 digits for your wallet number:");
            }
            await update(userRef, { wallet: val });
            delete userStates[userId];
            return bot.sendMessage(chatId, `✅ Payout Method Saved!\nWallet number ${val} linked successfully! You can now withdraw easily.`, USER_MENU);
        }

        if (state === 'WITHDRAW_AMOUNT') {
            const amt = Number(val);
            
            if (isNaN(amt) || amt < settings.minWithdraw || amt > settings.maxWithdraw || amt > userData.balance) {
                delete userStates[userId];
                return bot.sendMessage(chatId, "❌ Invalid amount or insufficient balance. Try again via 'Withdraw'.", USER_MENU);
            }

            const gws = await getGateways();
            const gwKeys = Object.keys(gws);
            if (gwKeys.length === 0) {
                delete userStates[userId];
                return bot.sendMessage(chatId, "❌ No payment gateways available right now. Please contact admin.");
            }

            let inlineKeyboard = [];
            for (let key in gws) {
                try {
                    const urlObj = new URL(gws[key]);
                    let domain = urlObj.hostname.replace('www.', '');
                    let nameParts = domain.split('.')[0].split('-');
                    let name = nameParts.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '); 
                    
                    inlineKeyboard.push([{ text: `🏦 ${name}`, callback_data: `pay_${amt}_${key}` }]);
                } catch(e) {}
            }

            bot.sendMessage(chatId, `💰 *Amount:* ₹${amt}\n\n👇 *Choose Gateway for Withdrawal:*`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: inlineKeyboard }
            });
            delete userStates[userId];
            return;
        }

        if (isAdminUser) {
            let adminStateMatched = true;
            try {
                if (state === 'ADD_CHANNEL') {
                    let channelId;
                    let channelLink = null;

                    if (msg.forward_from_chat && msg.forward_from_chat.type === 'channel') {
                        if (msg.forward_from_chat.username) {
                            channelId = '@' + msg.forward_from_chat.username;
                        } else {
                            channelId = String(msg.forward_from_chat.id);
                        }
                    } else if (val.includes(' ')) {
                        const parts = val.split(' ');
                        channelId = parts[0]; 
                        channelLink = parts[1]; 

                        if (!channelId.startsWith('-100')) {
                            return bot.sendMessage(chatId, "❌ Private Chat ID hamesha -100 se start hota hai.", { parse_mode: 'Markdown' });
                        }
                    } else {
                        channelId = val;
                        if (channelId.includes('t.me/')) {
                            const parts = channelId.split('t.me/');
                            channelId = '@' + parts[1].split('/')[0].replace('+', '');
                        } else if (!channelId.startsWith('@') && !channelId.startsWith('-100')) {
                            channelId = '@' + channelId;
                        }
                    }

                    try {
                        const chatInfo = await bot.getChat(channelId);
                        const botInfo = await bot.getMe();
                        const memberInfo = await bot.getChatMember(chatInfo.id, botInfo.id);
                        
                        if (!['administrator', 'creator'].includes(memberInfo.status)) {
                            return bot.sendMessage(chatId, `❌ Bot is not an Admin in ${chatInfo.title || channelId}. Pehle bot ko admin banayein.`, ADMIN_MENU);
                        } else {
                            const finalId = String(chatInfo.id);
                            const dbValue = channelLink ? `${finalId}|${channelLink}` : finalId;
                            
                            await set(ref(db, `channels/${Date.now()}`), dbValue);
                            bot.sendMessage(chatId, `✅ Channel '${chatInfo.title}' added successfully!`, ADMIN_MENU);
                        }
                    } catch (e) {
                        bot.sendMessage(chatId, `❌ Channel invalid hai ya bot usme add nahi hai.`, { parse_mode: 'Markdown' });
                    }
                } else if (state === 'ADD_GATEWAY') {
                    if (!val.startsWith('http')) {
                        bot.sendMessage(chatId, "❌ Invalid URL format. Must start with http or https.", ADMIN_MENU);
                    } else {
                        await set(ref(db, `gateways/${Date.now()}`), val);
                        bot.sendMessage(chatId, "✅ Gateway added successfully.", ADMIN_MENU);
                    }
                } else if (state === 'MIN_WITHDRAW') {
                    await update(ref(db, 'settings'), { minWithdraw: Number(val) });
                    bot.sendMessage(chatId, `✅ Min Withdraw set to ${val}.`, ADMIN_MENU);
                } else if (state === 'MAX_WITHDRAW') {
                    await update(ref(db, 'settings'), { maxWithdraw: Number(val) });
                    bot.sendMessage(chatId, `✅ Max Withdraw set to ${val}.`, ADMIN_MENU);
                } else if (state === 'REFER_AMOUNT') {
                    await update(ref(db, 'settings'), { referAmount: Number(val) });
                    bot.sendMessage(chatId, `✅ Refer Amount set to ${val}.`, ADMIN_MENU);
                } else if (state === 'MIN_REFER') {
                    await update(ref(db, 'settings'), { minRefer: Number(val) });
                    bot.sendMessage(chatId, `✅ Min Refer set to ${val}.`, ADMIN_MENU);
                } else if (state === 'SET_BONUS') {
                    await update(ref(db, 'settings'), { bonusAmount: Number(val) });
                    bot.sendMessage(chatId, `✅ Bonus Amount set to ₹${val}.`, ADMIN_MENU);
                } else if (state === 'BAN_USER') {
                    await set(ref(db, `banned/${val}`), true);
                    bot.sendMessage(chatId, `🚫 User ${val} has been manually banned.`, ADMIN_MENU);
                } else if (state === 'UNBAN_USER') {
                    await set(ref(db, `banned/${val}`), null);
                    bot.sendMessage(chatId, `✅ User ${val} has been unbanned.`, ADMIN_MENU);
                } else if (state === 'ADD_AMOUNT') {
                    const parts = val.split(' ');
                    if (parts.length === 2) {
                        const trgId = parts[0];
                        const amt = Number(parts[1]);
                        const refDb = ref(db, `users/${trgId}/balance`);
                        runTransaction(refDb, (current) => (current || 0) + amt);
                        bot.sendMessage(chatId, `✅ Added ${amt} to ${trgId}.`, ADMIN_MENU);
                    } else bot.sendMessage(chatId, "❌ Format: USERID AMOUNT");
                } else if (state === 'DEDUCT_AMOUNT') {
                    const parts = val.split(' ');
                    if (parts.length === 2) {
                        const trgId = parts[0];
                        const amt = Number(parts[1]);
                        const refDb = ref(db, `users/${trgId}/balance`);
                        runTransaction(refDb, (current) => ((current || 0) - amt >= 0 ? (current || 0) - amt : 0));
                        bot.sendMessage(chatId, `✅ Deducted ${amt} from ${trgId}.`, ADMIN_MENU);
                    } else bot.sendMessage(chatId, "❌ Format: USERID AMOUNT");
                } else if (state === 'ADD_ADMIN_STATE') {
                    const targetId = Number(val);
                    if (isNaN(targetId)) return bot.sendMessage(chatId, "❌ Invalid User ID.", ADMIN_MENU);
                    await set(ref(db, `admins/${targetId}`), true);
                    bot.sendMessage(chatId, `✅ User ${targetId} is now an Admin.`, ADMIN_MENU);
                } else if (state === 'REMOVE_ADMIN_STATE') {
                    const targetId = Number(val);
                    if (isNaN(targetId)) return bot.sendMessage(chatId, "❌ Invalid User ID.", ADMIN_MENU);
                    if (targetId === ADMIN_ID) return bot.sendMessage(chatId, "❌ Cannot remove the Master Admin.", ADMIN_MENU);
                    await set(ref(db, `admins/${targetId}`), null);
                    bot.sendMessage(chatId, `✅ User ${targetId} is no longer an Admin.`, ADMIN_MENU);
                } else if (state === 'BROADCAST_MESSAGE') {
                    bot.sendMessage(chatId, "⏳ Starting broadcast...");
                    const usersSnap = await get(ref(db, 'users'));
                    let successCount = 0;
                    let failCount = 0;
                    if (usersSnap.exists()) {
                        const users = usersSnap.val();
                        for (let uid in users) {
                            try {
                                await bot.sendMessage(uid, text);
                                successCount++;
                            } catch (e) {
                                failCount++;
                            }
                        }
                    }
                    bot.sendMessage(chatId, `✅ *Broadcast Completed!*\n\n📨 Sent: ${successCount}\n❌ Failed: ${failCount}`, { parse_mode: 'Markdown', reply_markup: ADMIN_MENU.reply_markup });
                } else if (state === 'SEND_CHANNEL_MSG') {
                    const channelKey = userStates[userId].channelKey;
                    const snap = await get(ref(db, `channels/${channelKey}`));
                    
                    if (snap.exists()) {
                        let chData = snap.val();
                        let chId = chData.includes('|') ? chData.split('|')[0] : chData;
                        try {
                            await bot.sendMessage(chId, text);
                            bot.sendMessage(chatId, `✅ Message successfully posted!`, ADMIN_MENU);
                        } catch (e) {
                            bot.sendMessage(chatId, `❌ Failed to send.`, ADMIN_MENU);
                        }
                    } else {
                        bot.sendMessage(chatId, `❌ Channel not found.`, ADMIN_MENU);
                    }
                } else {
                    adminStateMatched = false;
                }
            } catch (err) {
                bot.sendMessage(chatId, "❌ An error occurred processing your request.");
            }

            if (adminStateMatched) {
                delete userStates[userId];
                return; 
            }
        }
    }

    // ==========================================
    // USER MENU BUTTONS
    // ==========================================
    if (text === 'Balance') {
        return bot.sendMessage(chatId, `💰 Balance: ₹${userData.balance || 0}\n\nUse 'Withdraw' button to withdraw your balance to your wallet`);
    }

    if (text === 'Refer Earn') {
        const refLink = `https://t.me/${BOT_USERNAME}?start=${userId}`;
        const msg = `💰 Per Refer Rs.${settings.referAmount} Upi Cash\n\n👤Your Refferal Link: ${refLink}\n\nShare With Your Friend's & Family And Earn Refer Bonus Easily ✨🤑`;
        return bot.sendMessage(chatId, msg, {
            reply_markup: { 
                inline_keyboard: [
                    [{ text: "🏆 Leaderboard", callback_data: "show_user_leaderboard" }, { text: "👥 My Invites", callback_data: "my_invites" }]
                ] 
            }
        });
    }

    if (text === 'Bonus') {
        const lastBonus = userData.lastBonus || 0;
        const now = Date.now();
        if (now - lastBonus > 86400000) {
   
