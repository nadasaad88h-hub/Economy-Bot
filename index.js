const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    EmbedBuilder
} = require('discord.js');
const express = require('express');
const fs = require('fs');

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers] 
});

const app = express();
app.get('/', (req, res) => res.send('Economy System Core Active.'));

// ⚙️ CONFIGURATION SYSTEM
const TARGET_CHANNEL_ID = '1506139329536327760'; // Only allowed channel

// 📦 DATABASE CONTROLLER
const DB_FILE = './economy.json';
const writeQueues = {};

function loadDB() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            fs.writeFileSync(DB_FILE, JSON.stringify({}, null, 4));
            return {};
        }
        const data = fs.readFileSync(DB_FILE, 'utf8').trim();
        return data ? JSON.parse(data) : {};
    } catch (e) {
        console.error('Database read error:', e);
        return {};
    }
}

function saveDB(data) {
    if (!writeQueues[DB_FILE]) writeQueues[DB_FILE] = Promise.resolve();
    writeQueues[DB_FILE] = writeQueues[DB_FILE].then(() => {
        return fs.promises.writeFile(DB_FILE, JSON.stringify(data, null, 4), 'utf8').catch(() => {});
    });
}

function getUserData(db, userId) {
    if (!db[userId]) {
        db[userId] = {
            wallet: 0,
            withdrawn: 0,
            dailyStreak: 0,
            lastDailyTimestamp: 0,
            cooldowns: {}
        };
    }
    return db[userId];
}

// ────────────────────────────────────────────────────────
// SLASH COMMAND REGISTER APPLICATION LAYER
// ────────────────────────────────────────────────────────
client.once('ready', async () => {
    console.log(`💸 Economy system logged in as ${client.user.tag}`);
    
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
        const commands = [
            new SlashCommandBuilder()
                .setName('economy_leaderboard')
                .setDescription('View the points leaderboard and your statistics.'),
                
            new SlashCommandBuilder()
                .setName('withdraw_points')
                .setDescription('Secure wallet points into your non-stealable withdraw quota storage.')
                .addIntegerOption(opt => opt.setName('amount').setDescription('Amount of points to withdraw').setRequired(true).setMinValue(1)),
                
            new SlashCommandBuilder()
                .setName('steal_points')
                .setDescription('Attempt a high-stakes 50/50 robbery on another player.')
                .addUserOption(opt => opt.setName('target').setDescription('The user you want to steal from').setRequired(true))
                .addIntegerOption(opt => opt.setName('amount').setDescription('The target amount of points to steal').setRequired(true).setMinValue(1)),
                
            new SlashCommandBuilder()
                .setName('earn_points')
                .setDescription('Work a night shift to obtain points.'),
                
            new SlashCommandBuilder()
                .setName('daily_points')
                .setDescription('Claim your daily points reward and build up your streak.'),
                
            new SlashCommandBuilder()
                .setName('collect_points')
                .setDescription('Retrieve points back from your withdrawn quota into your active wallet.')
                .addIntegerOption(opt => opt.setName('amount').setDescription('Amount of points to collect back').setRequired(true).setMinValue(1))
        ].map(cmd => cmd.toJSON());

        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Economy Commands successfully hooked to Discord.');
    } catch (err) {
        console.error('Slash registration failed:', err);
    }
});

// ────────────────────────────────────────────────────────
// INTERACTION EXECUTION LAYER
// ────────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    // 🔒 Channel Lock Validation Gate
    if (interaction.channelId !== TARGET_CHANNEL_ID) {
        return interaction.reply({ 
            content: `❌ This command can only be executed in <#${TARGET_CHANNEL_ID}>.`, 
            ephemeral: true 
        });
    }

    const { commandName, user } = interaction;
    const db = loadDB();
    const userData = getUserData(db, user.id);
    const now = Date.now();
    const halfHourMs = 30 * 60 * 1000;

    // ⏱️ Global 30-Min Cooldown Enforcement Gate (Exempting non-spam commands)
    const exemptCommands = ['economy_leaderboard', 'withdraw_points', 'collect_points'];
    if (!exemptCommands.includes(commandName)) {
        const lastUsed = userData.cooldowns[commandName] || 0;
        if (now - lastUsed < halfHourMs) {
            const expirationTimeUnix = Math.floor((lastUsed + halfHourMs) / 1000);
            return interaction.reply({
                content: `⚠️ You cannot execute the command yet! Please wait <t:${expirationTimeUnix}:R> in order to use the command again.`,
                ephemeral: true
            });
        }
    }

    // ─────────────── COMMAND A: ECONOMY LEADERBOARD ───────────────
    if (commandName === 'economy_leaderboard') {
        const sortedPlayers = Object.entries(db)
            .map(([id, data]) => ({ id, wallet: data.wallet || 0 }))
            .sort((a, b) => b.wallet - a.wallet);

        const serverTotal = interaction.guild ? interaction.guild.memberCount : 10;
        const displayLimit = Math.min(serverTotal, 10);
        let leaderboardText = '';
        
        for (let i = 0; i < displayLimit; i++) {
            if (sortedPlayers[i]) {
                leaderboardText += `${i + 1}. <@${sortedPlayers[i].id}>\n`;
            } else {
                leaderboardText += `${i + 1}.\n`;
            }
        }

        leaderboardText += `\nYou: ${userData.wallet}\nWithdrew Points: ${userData.withdrawn}`;

        return interaction.reply({
            content: leaderboardText,
            ephemeral: true 
        });
    }

    // ─────────────── COMMAND B: WITHDRAW POINTS ───────────────
    if (commandName === 'withdraw_points') {
        const amount = interaction.options.getInteger('amount');

        if (userData.wallet < amount) {
            return interaction.reply({ content: `❌ You don't have ${amount} points in your active wallet to transfer.`, ephemeral: true });
        }

        userData.wallet -= amount;
        userData.withdrawn += amount;
        saveDB(db);

        return interaction.reply({
            content: `Withdrew Points: ${amount}`,
            ephemeral: true
        });
    }

    // ─────────────── COMMAND C: STEAL POINTS ───────────────
    if (commandName === 'steal_points') {
        const targetUser = interaction.options.getUser('target');
        const requestedAmount = interaction.options.getInteger('amount');

        if (targetUser.id === user.id) {
            return interaction.reply({ content: '❌ You can’t mug yourself!', ephemeral: true });
        }

        const targetData = getUserData(db, targetUser.id);

        if (targetData.wallet <= 0) {
            return interaction.reply({ content: '❌ This user has no points in their active wallet to take!', ephemeral: true });
        }

        userData.cooldowns[commandName] = now;
        const isSuccess = Math.random() < 0.5; 
        
        if (isSuccess) {
            const actualStealAmount = Math.min(targetData.wallet, requestedAmount);

            targetData.wallet -= actualStealAmount;
            userData.wallet += actualStealAmount;
            saveDB(db);

            const alertEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setDescription(`🚨${user.username} has stole ${actualStealAmount} Points from <@${targetUser.id}>!`);

            return interaction.reply({ embeds: [alertEmbed] });
        } else {
            const penaltyAmount = Math.min(userData.wallet, requestedAmount);

            userData.wallet -= penaltyAmount;
            targetData.wallet += penaltyAmount;
            saveDB(db);

            const failEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setDescription(`🚨${user.username} has attempted to **steal ${requestedAmount}** Points from <@${targetUser.id}> and got **caught!** Oof, better luck next time!\n***Points lost: ${penaltyAmount}***`);

            return interaction.reply({ embeds: [failEmbed] });
        }
    }

    // ─────────────── COMMAND D: EARN POINTS ───────────────
    if (commandName === 'earn_points') {
        userData.wallet += 2;
        userData.cooldowns[commandName] = now;
        saveDB(db);

        return interaction.reply({
            content: `🌙 You had a night shift and earned 2 points, well done!`,
            ephemeral: true
        });
    }

    // ─────────────── COMMAND E: DAILY POINTS ───────────────
    if (commandName === 'daily_points') {
        const oneDayMs = 24 * 60 * 60 * 1000;
        const twoDaysMs = 48 * 60 * 60 * 1000;
        const lastDaily = userData.lastDailyTimestamp || 0;

        if (lastDaily !== 0 && now - lastDaily < oneDayMs) {
            const nextAvailableUnix = Math.floor((lastDaily + oneDayMs) / 1000);
            return interaction.reply({
                content: `⚠️ Your next daily reward is ready <t:${nextAvailableUnix}:R>.`,
                ephemeral: true
            });
        }

        let activeReward = 3;

        if (lastDaily === 0) {
            userData.dailyStreak = 1;
            activeReward = 3;
        } else if (now - lastDaily <= twoDaysMs) {
            userData.dailyStreak += 1;
            activeReward = Math.min(3 + (userData.dailyStreak - 1), 10);
        } else {
            userData.dailyStreak = 1;
            activeReward = 3;
        }

        userData.lastDailyTimestamp = now;
        userData.wallet += activeReward;
        userData.cooldowns[commandName] = now;
        saveDB(db);

        return interaction.reply({
            content: `📆 Daily reward claimed! You received \`${activeReward}\` Points!`,
            ephemeral: true
        });
    }

    // ─────────────── COMMAND F: COLLECT POINTS ───────────────
    if (commandName === 'collect_points') {
        const inputAmount = interaction.options.getInteger('amount');

        if (userData.withdrawn <= 0) {
            return interaction.reply({ content: '❌ You have no points inside your withdrawn database allocation to retrieve.', ephemeral: true });
        }

        const actualWithdrawBack = Math.min(userData.withdrawn, inputAmount);

        userData.withdrawn -= actualWithdrawBack;
        userData.wallet += actualWithdrawBack;
        saveDB(db);

        return interaction.reply({
            content: `📥 Retracted \`${actualWithdrawBack}\` Points back out into your active wallet.`,
            ephemeral: true
        });
    }
});

client.login(process.env.TOKEN);
