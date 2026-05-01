import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import crypto from 'crypto';
import http from 'http';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, set, child } from 'firebase/database';

// ==========================================
// DUMMY SERVER FOR RAILWAY (PREVENTS CRASH)
// ==========================================
http.createServer((req, res) => res.end('Bot is running!')).listen(process.env.PORT || 3000);

// ==========================================
// CONFIGURATION & SETUP
// ==========================================
const BOT_TOKEN = '8733358384:AAHBAGABFmQc_6rdMdwFktCL_N5R9Di7dzk'; 
const ADMIN_ID = 7663556460; // Master Admin ID

const BOT_NAME = "Rupiya Money 🔥💸"; 
const BOT_USERNAME = "Rupiya_MoneyBot"; 

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ANTI-CRASH POLLING ERROR HANDLER
bot.on('polling_error', (error) => {
    console.log("Polling Error (Bot won't crash): ", error.code, error.message);
});

// ==========================================
// FIREBASE DATABASE SYSTEM (No Service Key)
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyC6kbLjy-Hr_ZK5b0kMNMaO-e_ZoahiNDY",
  authDomain: "bot-alpha-77a82.firebaseapp.com",
  databaseURL: "https://bot-alpha-77a82-default-rtdb.firebaseio.com",
  projectId: "bot-alpha-77a82",
  storageBucket: "bot-alpha-77a82.firebasestorage.app",
  messagingSenderId: "422320067761",
  appId: "1:422320067761:web:f3eb96a35424bd10693e90"
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

// Helper functions for Firebase
async function readDB(collection) {
    try {
        const dbRef = ref(database);
        const snapshot = await get(child(dbRef, collection));
        if (snapshot.exists()) {
            return snapshot.val();
        } else {
            return {};
        }
    } catch (err) {
        console.error(`Error reading ${collection}:`, err);
        return {};
    }
}

async function writeDB(collection, data) {
    try {
        await set(ref(database, collection), data);
    } catch (err) {
        console.error(`Error writing ${collection}:`, err);
    }
}

// ==========================================
// MEMORY STATE & MENUS
// ==========================================
const userStates = {};

const USER_MENU = {
    parse_mode: 'HTML',
    reply_markup: {
        keyboard: [
            ['Balance', 'Refer Earn'],
            ['Bonus', 'Withdraw'],
            ['Link Wallet'] 
        ],
        resize_keyboard: true
    }
};

const ADMIN_MENU = {
    parse_mode: 'HTML',
    reply_markup: {
        keyboard: [
            ['🤖 Bot ON/OFF', '🛡 Verify ON/OFF'],
            ['💸 Withdraw ON/OFF', '📢 Add Channel'], 
            ['❌ Remove Channel', '📢 Broadcast'], 
            ['🆔 Chat IDs', '📝 Channel Message'], 
            ['⚙️ Set API Gateway', '👨‍💻 Manage Admins'],
            ['⬇️ Min Withdraw', '⬆️ Max Withdraw'],
            ['💰 Refer Amount', '📉 Min Refer'],
            ['🎁 Set Bonus', '🎟 Create Gift Code'],
            ['🗑 Remove Gift Code', '📋 Gift Code List'],
            ['📊 Stats', '🏆 Leaderboard'],
            ['🚫 Ban User', '✅ Unban User'],
            ['💳 Reset Balance'],
            ['➕ Add Amount', '➖ Deduct Amount'],
            ['🔙 Exit Admin'] 
        ],
        resize_keyboard: true
    }
};

// ==========================================
// UTILITY FUNCTIONS
// ==========================================
async function checkIsAdmin(id) {
    if (id === ADMIN_ID) return true;
    const admins = await readDB('admins');
    return admins[id] === true;
}

async function getSettings() {
    const defaultSettings = {
        botStatus: true,
        withdrawStatus: true,
        verificationStatus: true, 
        minWithdraw: 10,
        maxWithdraw: 100,
        referAmount: 5,
        minRefer: 1,
        bonusAmount: 1
    };
    const settings = await readDB('settings');
    if (Object.keys(settings).length === 0) {
        await writeDB('settings', defaultSettings);
        return defaultSettings;
    }
    return { ...defaultSettings, ...settings };
}

async function checkChannels(userId) {
    const channels = await readDB('channels');
    const channelVals = Object.values(channels);
    if (channelVals.length === 0) return { allJoined: true, channels: [] };
    
    let allJoined = true;
    let pending = []; 
    const joinReqs = await readDB('join_requests');

    for (let ch of channelVals) {
        let chId = ch.includes('|') ? ch.split('|')[0] : ch;
        let isJoinedOrRequested = false;

        try {
            const member = await bot.getChatMember(chId, userId);
            if (['member', 'administrator', 'creator'].includes(member.status)) {
                isJoinedOrRequested = true;
            }
        } catch (e) {
            if (joinReqs[chId] && joinReqs[chId][userId] === true) {
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

function generateGiftCode() {
    return crypto.randomBytes(6).toString('hex').toUpperCase(); 
}

async function processReferral(userId, inviterId) {
    if (!inviterId || inviterId === false) return;
    
    const users = await readDB('users');
    if (users[userId] && users[userId].rewardGiven !== true) {
        const settings = await getSettings();
        const refAmt = Number(settings.referAmount) || 0;

        users[userId].rewardGiven = true;

        if (users[inviterId]) {
            users[inviterId].balance = (Number(users[inviterId].balance) || 0) + refAmt;
            users[inviterId].referrals = (Number(users[inviterId].referrals) || 0) + 1;
        }
        
        await writeDB('users', users);
        bot.sendMessage(inviterId, `<a href="tg://user?id=${userId}">${userId}</a> Got Invited By Your Url: +₹${refAmt}`, { parse_mode: 'HTML' }).catch(()=>{});
    }
}

// ==========================================
// MAIN MESSAGE HANDLER
// ==========================================
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text || ''; 
    const firstName = msg.from.first_name || 'User';

    const isAdminUser = await checkIsAdmin(userId);

    // ANTI-STUCK SYSTEM
    const menuCommands = ['Balance', 'Refer Earn', 'Bonus', 'Withdraw', 'Link Wallet', '🔙 Exit Admin'];
    if (menuCommands.includes(text)) {
        if (userStates[userId]) delete userStates[userId];
    }

    const banned = await readDB('banned');
    if (banned[userId]) return bot.sendMessage(chatId, "🚫 You are banned from using this bot.", { parse_mode: 'HTML' });

    const settings = await getSettings();
    
    if (!settings.botStatus && !isAdminUser) {
        return bot.sendMessage(chatId, `🛠 ${BOT_NAME} is currently under maintenance.`, { parse_mode: 'HTML' });
    }

    if (text === '/skadmin' && isAdminUser) {
        delete userStates[userId];
        return bot.sendMessage(chatId, "👨‍💻 Welcome to the Premium Admin Panel!", ADMIN_MENU);
    }
    
    // EXIT ADMIN PANEL
    if (text === '🔙 Exit Admin' && isAdminUser) {
        delete userStates[userId];
        return bot.sendMessage(chatId, "🏡 Exited Admin Panel. Welcome to the Main Menu!", USER_MENU);
    }

    const users = await readDB('users');
    let userData = users[userId];

    // --- START COMMAND ---
    if (text.startsWith('/start')) {
        const payload = text.split(' ')[1];

        // NEW: URL Deep Link Verification Logic
        if (payload === 'verificationsuccess') {
            if (!userData) {
                userData = {
                    balance: 0,
                    referrals: 0,
                    referredBy: false,
                    verified: false,
                    rewardGiven: false,
                    wallet: "Not Linked"
                };
                users[userId] = userData;
                await writeDB('users', users);
            }

            const dbRef = ref(database);
            const verificationSnapshot = await get(child(dbRef, `verification/${userId}`));
            
            let isVerifiedOnFirebase = false;
            if (verificationSnapshot.exists()) {
                isVerifiedOnFirebase = verificationSnapshot.val();
            }

            // Silent redirect logic
            if (isVerifiedOnFirebase === true || isVerifiedOnFirebase === "true") {
                users[userId].verified = true;
                await writeDB('users', users);
                bot.sendMessage(chatId, `🏡 Welcome To ${BOT_NAME}!`, USER_MENU);
                await processReferral(userId, userData.referredBy);
            } else if (isVerifiedOnFirebase === 'failed') {
                users[userId].verified = 'failed';
                users[userId].rewardGiven = 'failed';
                await writeDB('users', users);
                bot.sendMessage(chatId, `🏡 Welcome To ${BOT_NAME}!\n\n👀 Same Device Detected By System!\n\nStill You Can Refer & Earn 🥳`, USER_MENU);
            }
            return; 
        }

        let referredBy = false;
        if (payload && Number(payload) !== userId && payload !== 'verificationsuccess') {
            referredBy = Number(payload);
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
            users[userId] = userData;
            await writeDB('users', users);
        } else if (referredBy && !userData.referredBy) {
            userData.referredBy = referredBy;
            users[userId] = userData;
            await writeDB('users', users);
        }

        const channelStatus = await checkChannels(userId);
        if (!channelStatus.allJoined) {
            return bot.sendMessage(chatId, `⚠️ To use ${BOT_NAME}, you MUST join our channels first!`, Object.assign({ parse_mode: 'HTML' }, generateJoinKeyboard(channelStatus.channels)));
        } else {
            if (!settings.verificationStatus) {
                users[userId].verified = true;
                await writeDB('users', users);
                await processReferral(userId, users[userId].referredBy);
                return bot.sendMessage(chatId, `🏡 Welcome To ${BOT_NAME}!`, USER_MENU);
            }
            return promptDeviceVerification(chatId, userId, firstName);
        }
    }

    if (!userData && !isAdminUser) return;

    if (userData && userData.verified === false && !isAdminUser && settings.verificationStatus) {
        return promptDeviceVerification(chatId, userId, firstName);
    }

    // ==========================================
    // STATE HANDLING 
    // ==========================================
    if (userStates[userId] && userStates[userId].step) {
        const state = userStates[userId].step;
        const val = text.trim();

        if (state === 'LINK_WALLET') {
            if (!/^\d{10}$/.test(val)) {
                return bot.sendMessage(chatId, "❌ Invalid format. Please enter exactly 10 digits for your wallet number:", { parse_mode: 'HTML' });
            }
            users[userId].wallet = val;
            await writeDB('users', users);
            delete userStates[userId];
            return bot.sendMessage(chatId, `✅ Wallet Saved!\nWallet number ${val} linked successfully! You can now withdraw easily.`, USER_MENU);
        }

        if (state === 'CLAIM_GIFT_CODE') {
            const codes = await readDB('giftcodes');
            if (!codes[val]) {
                delete userStates[userId];
                return bot.sendMessage(chatId, "❌ Invalid or expired Gift Code.", USER_MENU);
            }

            const codeData = codes[val];
            
            if (codeData.claimedBy && codeData.claimedBy[userId]) {
                delete userStates[userId];
                return bot.sendMessage(chatId, "❌ You have already claimed this Gift Code.", USER_MENU);
            }

            const amount = Number(codeData.amount);
            users[userId].balance = (Number(users[userId].balance) || 0) + amount;
            await writeDB('users', users);
            
            codeData.claimed = (codeData.claimed || 0) + 1;
            if (!codeData.claimedBy) codeData.claimedBy = {};
            codeData.claimedBy[userId] = true;

            if (codeData.claimed >= (codeData.limit || 1)) {
                delete codes[val];
            } else {
                codes[val] = codeData;
            }
            await writeDB('giftcodes', codes);
            delete userStates[userId];

            const successImageUrl = 'https://i.imgur.com/vHqX2qW.jpeg'; 
            return bot.sendPhoto(chatId, successImageUrl, {
                caption: `🎉 Congratulations!\n\nYou Have Successfully Claimed The Gift Code Of ₹${amount}\n💰 New Balance: ₹${users[userId].balance}`,
                parse_mode: 'HTML',
                reply_markup: USER_MENU.reply_markup
            }).catch(err => console.error("Gift Photo Error:", err));
        }

        if (state === 'WITHDRAW_AMOUNT') {
            const amt = Number(val);
            
            if (isNaN(amt) || amt <= 0 || amt < settings.minWithdraw || amt > settings.maxWithdraw || amt > (userData.balance || 0)) {
                delete userStates[userId];
                return bot.sendMessage(chatId, "❌ Invalid amount or insufficient balance. Try again via 'Withdraw'.", USER_MENU);
            }

            const gws = await readDB('gateways');
            const gwKeys = Object.keys(gws);
            if (gwKeys.length === 0) {
                delete userStates[userId];
                return bot.sendMessage(chatId, "❌ No payment gateways available right now. Please contact admin.", { parse_mode: 'HTML' });
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

            bot.sendMessage(chatId, `💰 Amount: ₹${amt}\n\n👇 Choose Gateway for Withdrawal:`, {
                parse_mode: 'HTML',
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
                        channelId = String(msg.forward_from_chat.id);
                    } else if (val.includes(' ')) {
                        const parts = val.split(' ');
                        channelId = parts[0]; 
                        channelLink = parts[1]; 
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
                            bot.sendMessage(chatId, `❌ Bot is not an Admin in ${chatInfo.title || channelId}. Pehle bot ko admin banayein.`, ADMIN_MENU);
                        } else {
                            const finalId = String(chatInfo.id);
                            let finalLink = channelLink;

                            if (!finalLink) {
                                if (chatInfo.username) {
                                    finalLink = `https://t.me/${chatInfo.username}`;
                                } else {
                                    try {
                                        const inviteObj = await bot.createChatInviteLink(finalId, { name: "Bot Verification" });
                                        finalLink = inviteObj.invite_link;
                                    } catch (err) {
                                        try {
                                            finalLink = await bot.exportChatInviteLink(finalId);
                                        } catch (err2) {
                                            return bot.sendMessage(chatId, `❌ Bot ke paas Invite Link generate karne ki permission nahi hai. Kripya channel settings me bot ko 'Invite Users via Link' permission dein.`, ADMIN_MENU);
                                        }
                                    }
                                }
                            }

                            const dbValue = `${finalId}|${finalLink}`;
                            
                            const channels = await readDB('channels');
                            channels[Date.now()] = dbValue;
                            await writeDB('channels', channels);

                            bot.sendMessage(chatId, `✅ Channel '${chatInfo.title}' added successfully!\n🔗 Link: ${finalLink}`, ADMIN_MENU);
                        }
                    } catch (e) {
                        bot.sendMessage(chatId, `❌ Channel invalid hai ya bot usme add nahi hai.`, { parse_mode: 'HTML' });
                    }
                } else if (state === 'ADD_GATEWAY') {
                    if (!val.startsWith('http')) {
                        bot.sendMessage(chatId, "❌ Invalid URL format. Must start with http or https.", ADMIN_MENU);
                    } else {
                        const gws = await readDB('gateways');
                        gws[Date.now()] = val;
                        await writeDB('gateways', gws);
                        bot.sendMessage(chatId, "✅ Gateway added successfully.", ADMIN_MENU);
                    }
                } else if (state === 'MIN_WITHDRAW') {
                    const amt = Number(val); if(amt>0){ settings.minWithdraw = amt; await writeDB('settings', settings); bot.sendMessage(chatId, `✅ Min Withdraw set to ${val}.`, ADMIN_MENU); } else bot.sendMessage(chatId, "❌ Invalid number.", { parse_mode: 'HTML' });
                } else if (state === 'MAX_WITHDRAW') {
                    const amt = Number(val); if(amt>0){ settings.maxWithdraw = amt; await writeDB('settings', settings); bot.sendMessage(chatId, `✅ Max Withdraw set to ${val}.`, ADMIN_MENU); } else 
