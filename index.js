const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, SlashCommandBuilder, MessageFlags } = require('discord.js');
const fs = require('fs');

const puzzles = JSON.parse(fs.readFileSync('puzzles.json', 'utf8'));
const walletMintFile = 'wallet_mint.json';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers] });

const puzzleRooms = {
    "Begified": "1338850636715917445",
    "Entry1": "1339645737746829362",
    "Entry2": "1339647059531272255",
    "Entry3": "1339647126644195338",
    "Entry4": "1339647197527937096",
    "Entry5": "1339647298145091635",
    "Entry6": "1339647345368764417",
    "RewardRoom": "1340346396380889260"
};

const specialMessages = {
    "Entry6": "🏆 You've actually done it! Open up the final stage and become a bottom of the barrel begger!",
    "RewardRoom": "Congrates on finishing begging school go out and beg to your hearts content!!!"
};

const failedAttempts = new Map();

client.on('interactionCreate', async interaction => {
    if (interaction.isButton()) {
        const puzzleId = interaction.customId.split('-')[1];
        const puzzleData = puzzles[puzzleId];

        if (puzzleData) {
            const isRewardRoom = puzzleId === "RewardRoom";

            const modal = new ModalBuilder()
                .setCustomId(`answer-${puzzleId}`)
                .setTitle(`Submit Your Answer`);

            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('answer')
                        .setLabel('Enter your answer')
                        .setStyle(TextInputStyle.Short)
                )
            );

            if (isRewardRoom) {
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('walletInput')
                            .setLabel('Enter your wallet address')
                            .setStyle(TextInputStyle.Paragraph)
                            .setRequired(false)
                    )
                );
            }

            await interaction.showModal(modal);
        }
    }

    if (interaction.isModalSubmit()) {
        const [_, puzzleId] = interaction.customId.split('-');
        const userId = interaction.user.id;
        const userAnswerInput = interaction.fields.getTextInputValue('answer').trim().toLowerCase(); 
        const member = interaction.guild.members.cache.get(userId);

        const correctAnswer = puzzles[puzzleId].answer.toLowerCase().trim(); 
        const secretAnswer = puzzles[puzzleId].secretAnswer?.toLowerCase().trim(); 
        const secretResponse = puzzles[puzzleId].secretResponse || "";
        const hints = puzzles[puzzleId].hints || [];

        let responseMessage = "";

        const isFinalRoom = puzzleId === "RewardRoom";
        let walletUserInput = "";

        if (isFinalRoom) {
            walletUserInput = interaction.fields.getTextInputValue('walletInput').trim();
            const success = saveWalletEntry(userId, interaction.user.username, walletUserInput);
            if (success) {
                responseMessage += `\n📜 Your wallet address has been saved!`;
            } else {
                responseMessage += `\n❌ You have already submitted an address and cannot submit again.`;
            }
        }

        const userWords = userAnswerInput.split(/\s*,\s*/).map(word => word.trim()); 
        const correctAnswers = correctAnswer.split(/\s*,\s*/).map(word => word.trim()); 

        const isCorrect = correctAnswers.every(answer => userWords.includes(answer));



        if (isCorrect) {
           
            responseMessage = specialMessages[puzzleId] || `✅ Correct! You have unlocked the next stage.\n`;

            const nextRoleId = puzzles[puzzleId].nextRole;

            const removableRoles = Object.values(puzzles)
                .filter(p => p.removableRole)
                .map(p => p.nextRole)
                .filter(roleId => roleId && roleId !== nextRoleId);

            failedAttempts.delete(`${userId}-${puzzleId}`);

            if (nextRoleId && member) {
                for (const roleId of removableRoles) {
                    if (member.roles.cache.has(roleId)) {
                        await member.roles.remove(roleId).catch(console.error);
                    }
                }

                await member.roles.add(nextRoleId).catch(console.error);
            }
        } else {
            const attemptKey = `${userId}-${puzzleId}`;
            let attempts = failedAttempts.get(attemptKey) || 0;
            attempts++;
            failedAttempts.set(attemptKey, attempts);

            responseMessage += `❌ Incorrect, try again!\n`;

            if (hints.length > 0 && attempts <= hints.length) {
                responseMessage += `\n💡 Hint ${attempts}: ${hints[attempts - 1]}`;
            }
        }

        if (secretAnswer && userWords.includes(secretAnswer)) {
            responseMessage += `\n🔍 ${secretResponse}`;
        }

        await interaction.reply({ content: responseMessage, flags: MessageFlags.Ephemeral });
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'question') {
        const channelId = interaction.channelId;
        const puzzleId = Object.keys(puzzleRooms).find(key => puzzleRooms[key] === channelId);

        if (!puzzleId || !puzzles[puzzleId]) {
            await interaction.reply({ content: `❌ No puzzle is assigned to this channel.`, flags: MessageFlags.Ephemeral });
            return;
        }

        let messageParts = [];

        if (puzzles[puzzleId].image) {
            messageParts.push(`🖼️ **Complete the image question:**`);
        }

        if (puzzles[puzzleId].question) {
            messageParts.push(`🧩 **Puzzle ${puzzleId}:** ${puzzles[puzzleId].question}`);
        }
        if (puzzles[puzzleId].instructions) {
            messageParts.push(`📜 **Instructions:** ${puzzles[puzzleId].instructions}`);
        }

        let messageContent = messageParts.join("\n") || "⚠️ No puzzle content available.";

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`puzzle-${puzzleId}`)
                .setLabel(`Solve Puzzle ${puzzleId}`)
                .setStyle(ButtonStyle.Primary)
        );


        const files = puzzles[puzzleId].image ? [{ attachment: puzzles[puzzleId].image }] : [];

        await interaction.reply({ content: messageContent, components: [row], files });
    }
});

function saveWalletEntry(userId, username, userInput) {
    if (!userInput) return false;

    let walletMint = [];

    if (fs.existsSync(walletMintFile)) {
        try {
            const fileData = fs.readFileSync(walletMintFile, 'utf8').trim();
            walletMint = fileData ? JSON.parse(fileData) : []; 
        } catch (error) {
            console.error("Error reading wallet_mint.json:", error);
            walletMint = [];
        }
    }

    if (!Array.isArray(walletMint)) {
        console.error("wallet_mint.json is not an array. Resetting...");
        walletMint = []; 
    }

    const existingEntry = walletMint.find(entry => entry.userId === userId);
    if (existingEntry) return false;

    walletMint.push({ userId, username, message: userInput, timestamp: new Date().toISOString() });

    fs.writeFileSync(walletMintFile, JSON.stringify(walletMint, null, 2));
    return true;
}

client.on('ready', async () => {
    const guild = client.guilds.cache.first();
    if (!guild) return console.error("❌ No guilds found.");

    await guild.commands.create(new SlashCommandBuilder()
        .setName('question')
        .setDescription('Resend the puzzle question in this room')
    );

    console.log("✅ Bot is online.");
    console.log("✅ Slash command `/question` registered.");
});




client.login(process.env.DISCORD_TOKEN_SECRET);

