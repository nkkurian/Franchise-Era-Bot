const axios = require('axios');
const { EmbedBuilder } = require('discord.js');

// You can use a service like "RSS.app" or "Social Bearing" 
// to get a JSON feed of a specific user.
const REPORTER_FEED_URL = "YOUR_FEED_URL_HERE"; 
const CHANNEL_ID = "1489845470321836032"; // Your news channel
let lastTweetId = null;

async function checkTweets(client) {
    try {
        const response = await axios.get(REPORTER_FEED_URL);
        const tweets = response.data.items; // Adjust based on your feed provider

        if (!tweets || tweets.length === 0) return;

        const latestTweet = tweets[0];

        // Only post if it's a new tweet
        if (latestTweet.id !== lastTweetId) {
            if (lastTweetId !== null) { // Skip posting the very first one on bot start
                const channel = await client.channels.fetch(CHANNEL_ID);
                
                const tweetEmbed = new EmbedBuilder()
                    .setColor(0x1DA1F2) // Twitter Blue
                    .setAuthor({ name: `NFL Reporter Update`, iconURL: 'https://abs.twimg.com/favicons/twitter.ico' })
                    .setDescription(latestTweet.content_text || latestTweet.summary)
                    .setURL(latestTweet.url)
                    .setTimestamp(new Date(latestTweet.date_published));

                if (latestTweet.image) tweetEmbed.setImage(latestTweet.image);

                await channel.send({ embeds: [tweetEmbed] });
            }
            lastTweetId = latestTweet.id;
        }
    } catch (error) {
        console.error("Twitter Feed Error:", error.message);
    }
}

module.exports = { checkTweets };
