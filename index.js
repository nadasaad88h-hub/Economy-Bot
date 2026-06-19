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
app.use(express.json());

app.get('/', (req, res) => res.send('Economy System Core Active.'));

// 🔒 SECURE BOT-TO-BOT PASSWORD
const AUTH_SECRET = process.env.BOT_SECRET || 'SuperSecretToken123!';

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

// 🌐 PRIVATE SYNC API ENDPOINT FOR GEOGUESSR/LOCATION BOT
app.post('/api/add-points', (req, res) => {
    const { secret, userId, points } = req.body;

    if (!secret || secret !== AUTH_SECRET) {
        return res.status(403).json({ error: 'Unauthorized communication attempt.' });
    }

    if (!userId || !points) {
        return res.status(400).json({ error: 'Missing parameters.' });
    }

    const db = loadDB();
    const userData = getUserData(db, userId);
    userData.wallet += Number(points);
    saveDB(db);

    console.log(`📡 API Sync: Added ${points} points to user ${userId} via external system confirmation.`);
    return res.json({ success: true, newBalance: userData.wallet });
});

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
                .addIntegerOption(opt => opt.setName('amount').setDescription('Amount of points to collect back').setRequired(true).setMinValue(1)),

            new SlashCommandBuilder()
                .setName('gamble')
                .setDescription('Risk your wallet points on a color draw!')
                .addIntegerOption(opt => opt.setName('points').setDescription('The amount of points you want to bet.').setRequired(true).setMinValue(1))
                .addStringOption(opt => opt.setName('color').setDescription('Pick your color destination').setRequired(true)
                    .addChoices(
                        { name: 'Red 🔴', value: 'red' },
                        { name: 'Green 🟢', value: 'green' },
                        { name: 'Yellow 🟡', value: 'yellow' }
                    )),

            new SlashCommandBuilder()
                .setName('point_flip')
                .setDescription('Flip a coin to win 8 points!')
                .addStringOption(opt => opt.setName('choice').setDescription('Pick Heads or Tails').setRequired(true)
                    .addChoices(
                        { name: 'Heads 🪙', value: 'heads' },
                        { name: 'Tails 🪙', value: 'tails' }
                    ))
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

    if (interaction.channelId !== TARGET_CHANNEL_ID) {
        return interaction.reply({ 
            content: `❌ This command can only be executed in <#${TARGET_CHANNEL_ID}>.`, 
            ephemeral: true 
        });
    }

    const { commandName, user } = interaction;
    const now = Date.now();
    const halfHourMs = 30 * 60 * 1000;
    const tenMinutesMs = 10 * 60 * 1000;

    let initialDb = loadDB();
    let initialUser = getUserData(initialDb, user.id);

    // Global Cooldown Handler
    const exemptCommands = ['economy_leaderboard', 'withdraw_points', 'collect_points', 'gamble', 'point_flip'];
    if (!exemptCommands.includes(commandName)) {
        const lastUsed = initialUser.cooldowns[commandName] || 0;
        if (now - lastUsed < halfHourMs) {
            const expirationTimeUnix = Math.floor((lastUsed + halfHourMs) / 1000);
            return interaction.reply({
                content: `⚠️ You cannot execute the command yet! Please wait <t:${expirationTimeUnix}:R> in order to use the command again.`,
                ephemeral: true
            });
        }
    }

    // 🪙 POINT FLIP COMMAND LOGIC
    if (commandName === 'point_flip') {
        const lastFlipUsed = initialUser.cooldowns[commandName] || 0;
        if (now - lastFlipUsed < tenMinutesMs) {
            const expirationTimeUnix = Math.floor((lastFlipUsed + tenMinutesMs) / 1000);
            return interaction.reply({
                content: `⚠️ Cooldown active! Please wait <t:${expirationTimeUnix}:R> before flipping again.`,
                ephemeral: true
            });
        }

        const userChoice = interaction.options.getString('choice'); 
        const displayChoice = userChoice.charAt(0).toUpperCase() + userChoice.slice(1);

        initialUser.cooldowns[commandName] = now;
        saveDB(initialDb);

        const initialEmbed = new EmbedBuilder()
            .setColor('#FEE75C')
            .setTitle(`You chose ${displayChoice}!`)
            .setDescription('🪙 Flipping…..');

        await interaction.reply({ embeds: [initialEmbed] });

        setTimeout(async () => {
            const runtimeDb = loadDB();
            const runtimeUser = getUserData(runtimeDb, user.id);
            
            const outcomes = ['heads', 'tails'];
            const landedOn = outcomes[Math.floor(Math.random() * outcomes.length)];
            const displayLanded = landedOn.charAt(0).toUpperCase() + landedOn.slice(1);
            
            const resultEmbed = new EmbedBuilder();
            const oldPoints = runtimeUser.wallet;

            if (userChoice === landedOn) {
                runtimeUser.wallet += 8;
                saveDB(runtimeDb);

                resultEmbed
                    .setColor('#57F287')
                    .setTitle(`Congratulations ${user.username}, you won 8 Points!`)
                    .setDescription(`It landed on **${displayLanded}** 🎉\n\n**Old points:** ${oldPoints}\n**New points:** ${runtimeUser.wallet}`);
            } else {
                resultEmbed
                    .setColor('#ED4245')
                    .setTitle(`🔴 Oof, it landed on **${displayLanded}**, better luck next time!`)
                    .setDescription('No points were deducted, do not worry.');
            }

            await interaction.followUp({ content: `<@${user.id}>`, embeds: [resultEmbed] });
        }, 4000);

        return;
    }

    // 🎰 GAMBLE COMMAND LOGIC LAYER (NO COOLDOWN, CUSTOM BET SPLIT MATH)
    if (commandName === 'gamble') {
        if (initialUser.wallet <= 0) {
            return interaction.reply({ content: '❌ You don’t have any points in your wallet to gamble with!', ephemeral: true });
        }

        let betAmount = interaction.options.getInteger('points');
        const chosenColorKey = interaction.options.getString('color');

        if (betAmount > initialUser.wallet) {
            betAmount = initialUser.wallet;
        }

        const colorMap = {
            'red': { emoji: '🔴', display: 'red', hex: '#FF0000' },
            'green': { emoji: '🟢', display: 'green', hex: '#00FF00' },
            'yellow': { emoji: '🟡', display: 'yellow', hex: '#FFFF00' }
        };

        const playerColor = colorMap[chosenColorKey];
        const oldPointsSnapshot = initialUser.wallet;
        const lossAmount = Math.floor(betAmount / 2);

        // Deduct potential maximum loss immediately to prevent race-condition balance spamming
        initialUser.wallet -= lossAmount;
        if (initialUser.wallet < 0) initialUser.wallet = 0;
        saveDB(initialDb);

        const displayName = user.username.toLowerCase() === 'unbreakilo' ? 'Unbreakilo' : user.username;
        const introEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle(`${playerColor.emoji} ${displayName} chose to gamble ${betAmount} on ${playerColor.display}!`)
            .setDescription('🏆 Gambling….');

        await interaction.reply({ embeds: [introEmbed] });

        const colorKeys = ['red', 'green', 'yellow'];
        const drawnColorKey = colorKeys[Math.floor(Math.random() * colorKeys.length)];
        const drawnColor = colorMap[drawnColorKey];

        setTimeout(async () => {
            const runtimeDb = loadDB();
            const runtimeUserData = getUserData(runtimeDb, user.id);

            const outcomeEmbed = new EmbedBuilder();
            let dynamicNewPoints;

            if (chosenColorKey === drawnColorKey) {
                // WIN: Refund the pre-deducted half-loss, then add the full win amount
                runtimeUserData.wallet += (lossAmount + betAmount); 
                dynamicNewPoints = runtimeUserData.wallet;

                outcomeEmbed
                    .setColor(playerColor.hex)
                    .setTitle(`${playerColor.emoji} Congratulations ${displayName}, landed on ${playerColor.display}!`)
                    .setDescription(`Your gambled points have been doubled! (+${betAmount} pts)\n\nOld points: ${oldPointsSnapshot}\nNew points: ${dynamicNewPoints}`);
            } else {
                // LOSE: Points are already deducted from wallet, just render output
                dynamicNewPoints = runtimeUserData.wallet;

                outcomeEmbed
                    .setColor(drawnColor.hex)
                    .setTitle(`${drawnColor.emoji} Oof, it landed on ${drawnColor.display}. Better luck next time!`)
                    .setDescription(`You lost half of your bet. (-${lossAmount} pts)\n\nOld points: ${oldPointsSnapshot}\nNew points: ${dynamicNewPoints}`);
            }

            saveDB(runtimeDb);
            await interaction.followUp({ content: `<@${user.id}>`, embeds: [outcomeEmbed] });
        }, 2500);

        return;
    }

    if (commandName === 'economy_leaderboard') {
        await interaction.deferReply({ ephemeral: true });
        
        const activeDb = loadDB();
        const personalData = getUserData(activeDb, user.id);
        
        const sortedPlayers = Object.entries(activeDb)
            .map(([id, data]) => ({ id, wallet: data.wallet || 0 }))
            .filter(player => player.wallet > 0)
            .sort((a, b) => b.wallet - a.wallet);

        const displayLimit = Math.min(sortedPlayers.length, 10);
        let leaderboardText = '';
        
        for (let i = 0; i < displayLimit; i++) {
            const player = sortedPlayers[i];
            let username = `User (${player.id})`;
            
            try {
                const fetchedMember = interaction.guild?.members.cache.get(player.id) || await interaction.guild?.members.fetch(player.id).catch(() => null);
                if (fetchedMember) username = fetchedMember.user.username;
            } catch {}
            
            leaderboardText += `**${i + 1}.** ${username} ─ \`${player.wallet} pts\`\n`;
        }

        if (displayLimit === 0) {
            leaderboardText = '*The leaderboard is currently empty. No active players with points!*';
        }

        const leaderboardEmbed = new EmbedBuilder()
            .setColor('#1E90FF')
            .setTitle('🏆 Points Leaderboard')
            .setDescription(leaderboardText)
            .addFields(
                { name: '👤 Your Statistics', value: `Active Wallet: \`${personalData.wallet} pts\`\nWithdrawn Quota: \`${personalData.withdrawn} pts\`` }
            )
            .setTimestamp();

        return interaction.editReply({ embeds: [leaderboardEmbed] });
    }

    if (commandName === 'withdraw_points') {
        const actionDb = loadDB();
        const actionUser = getUserData(actionDb, user.id);
        const amount = interaction.options.getInteger('amount');

        if (actionUser.wallet < amount) {
            return interaction.reply({ content: `❌ You don't have ${amount} points in your active wallet to transfer.`, ephemeral: true });
        }

        actionUser.wallet -= amount;
        actionUser.withdrawn += amount;
        saveDB(actionDb);

        return interaction.reply({ content: `Withdrew Points: ${amount}`, ephemeral: true });
    }

    if (commandName === 'steal_points') {
        const actionDb = loadDB();
        const actionUser = getUserData(actionDb, user.id);
        
        const targetUser = interaction.options.getUser('target');
        const requestedAmount = interaction.options.getInteger('amount');

        if (targetUser.id === user.id) {
            return interaction.reply({ content: '❌ You can’t mug yourself!', ephemeral: true });
        }

        const targetData = getUserData(actionDb, targetUser.id);

        if (targetData.wallet <= 0) {
            return interaction.reply({ content: '❌ This user has no points in their active wallet to take!', ephemeral: true });
        }

        actionUser.cooldowns[commandName] = now;
        const isSuccess = Math.random() < 0.5; 
        
        if (isSuccess) {
            const actualStealAmount = Math.min(targetData.wallet, requestedAmount);

            targetData.wallet -= actualStealAmount;
            actionUser.wallet += actualStealAmount;
            saveDB(actionDb);

            const alertEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setDescription(`🚨 **${user.username}** stole \`${actualStealAmount}\` Points from <@${targetUser.id}>!`);

            return interaction.reply({ embeds: [alertEmbed] });
        } else {
            const penaltyAmount = Math.min(actionUser.wallet, requestedAmount);

            actionUser.wallet -= penaltyAmount;
            targetData.wallet += penaltyAmount;
            saveDB(actionDb);

            const failEmbed = new EmbedBuilder()
                .setColor('#FF0000')
                .setDescription(`🚨 **${user.username}** attempted to steal \`${requestedAmount}\` Points from <@${targetUser.id}> and got **caught!** Oof, better luck next time!\n***Points lost: ${penaltyAmount}***`);

            return interaction.reply({ embeds: [failEmbed] });
        }
    }

    if (commandName === 'earn_points') {
        const actionDb = loadDB();
        const actionUser = getUserData(actionDb, user.id);

        actionUser.wallet += 2;
        actionUser.cooldowns[commandName] = now;
        saveDB(actionDb);

        return interaction.reply({ content: `🌙 You had a night shift and earned 2 points, well done!`, ephemeral: true });
    }

    if (commandName === 'daily_points') {
        const actionDb = loadDB();
        const actionUser = getUserData(actionDb, user.id);

        const oneDayMs = 24 * 60 * 60 * 1000;
        const twoDaysMs = 48 * 60 * 60 * 1000;
        const lastDaily = actionUser.lastDailyTimestamp || 0;

        if (lastDaily !== 0 && now - lastDaily < oneDayMs) {
            const nextAvailableUnix = Math.floor((lastDaily + oneDayMs) / 1000);
            return interaction.reply({ content: `⚠️ Your next daily reward is ready <t:${nextAvailableUnix}:R>.`, ephemeral: true });
        }

        let activeReward = 3;

        if (lastDaily === 0) {
            actionUser.dailyStreak = 1;
            activeReward = 3;
        } else if (now - lastDaily <= twoDaysMs) {
            actionUser.dailyStreak += 1;
            activeReward = Math.min(3 + (actionUser.dailyStreak - 1), 10);
        } else {
            actionUser.dailyStreak = 1;
            activeReward = 3;
        }

        actionUser.lastDailyTimestamp = now;
        actionUser.wallet += activeReward;
        actionUser.cooldowns[commandName] = now;
        saveDB(actionDb);

        return interaction.reply({ content: `📆 Daily reward claimed! You received \`${activeReward}\` Points!`, ephemeral: true });
    }

    if (commandName === 'collect_points') {
        const actionDb = loadDB();
        const actionUser = getUserData(actionDb, user.id);
        const inputAmount = interaction.options.getInteger('amount');

        if (actionUser.withdrawn <= 0) {
            return interaction.reply({ content: '❌ You have no points inside your withdrawn database allocation to retrieve.', ephemeral: true });
        }

        const actualWithdrawBack = Math.min(actionUser.withdrawn, inputAmount);

        actionUser.withdrawn -= actualWithdrawBack;
        actionUser.wallet += actualWithdrawBack;
        saveDB(actionDb);

        return interaction.reply({ content: `📥 Retracted \`${actualWithdrawBack}\` Points back out into your active wallet.`, ephemeral: true });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🌐 Express web listener bonded to internal port: ${PORT}`);
    
    setInterval(() => {
        const PROJECT_URL = `https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost:' + PORT}`;
        fetch(PROJECT_URL)
            .then(() => console.log('💓 Keep-alive pulse transmitted successfully.'))
            .catch((err) => console.error('⚠️ Keep-alive heartbeat connection dropped:', err.message));
    }, 5 * 60 * 1000); 
});

client.login(process.env.TOKEN);
