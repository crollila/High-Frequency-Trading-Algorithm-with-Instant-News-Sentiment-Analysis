import dotenv from 'dotenv';
import fetch from 'node-fetch';
import OpenAI from 'openai';
import fs from 'fs';
import fsPromises from 'fs/promises';
import moment from 'moment-timezone';

// Initialize dotenv to load environment variables
dotenv.config();

const BENZINGA_API_KEY = process.env.BENZINGA_API_KEY;
const API_URL = `https://api.benzinga.com/api/v2/news?token=${BENZINGA_API_KEY}&displayOutput=full`;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TIMESTAMP_FILE = './lastUpdatedTimestamp.txt'; // File to store the last updated timestamp
const SCORES_FILE = './scores.txt';

const openai = new OpenAI(OPENAI_API_KEY);

let lastUpdatedTimestamp = 0;

try {
    const timestampData = fs.readFileSync(TIMESTAMP_FILE, 'utf8');
    lastUpdatedTimestamp = parseInt(timestampData, 10) || Math.floor(Date.now() / 1000); // Conversion from milliseconds to seconds.
} catch (error) {
    lastUpdatedTimestamp = Math.floor(Date.now() / 1000); // Fallback to current time if file read fails
    console.error('Error reading timestamp file, using current time:', error);
}

function stripHtml(html) {
    const strippedString = html.replace(/<[^>]+>/g, '');
    const text = strippedString
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&');
    const condensedText = text.replace(/\s\s+/g, ' ');
    return condensedText;
}

async function fetchBenzingaNews() {
    const now = moment().tz('America/New_York'); // Get current time in Eastern Time
    const startOfDay = now.clone().startOf('day');
    const publishedSince = Math.floor(startOfDay.unix()); // Convert to Unix timestamp in seconds

    if (moment().tz('America/New_York').date() !== now.date()) {
        lastUpdatedTimestamp = publishedSince;
    }

    const url = `${API_URL}&publishedSince=${lastUpdatedTimestamp}`;
    try {
        const response = await fetchWithRetry(url, { headers: { 'Accept': 'application/json' } });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (data.length > 0) {
            console.log(`${data.length} new news items to process.`);
            let maxTimestamp = lastUpdatedTimestamp;

            const currentTimestamp = moment().tz('America/New_York').unix(); // Current timestamp in seconds

            const isTradingHours = now.hours() >= 4 && now.hours() < 20;

            const sentimentPromises = data.map(async (news) => {
                const newsTimestamp = Math.floor(new Date(news.updated).getTime() / 1000);

                // Update the maxTimestamp even if we skip processing
                maxTimestamp = Math.max(maxTimestamp, newsTimestamp);

                // Skip articles older than 5 minutes (300 seconds)
                if (currentTimestamp - newsTimestamp > 300) {
                    return null;
                }

                if (newsTimestamp <= lastUpdatedTimestamp) {
                    return null;
                }

                if (!isTradingHours) {
                    return null; // Skip processing if not within trading hours
                }

                let info = stripHtml(news.body);
                info = info.length > 1000 ? `${info.substring(0, 1000)}...` : info;
                info = info.trim() ? info : "No additional information available.";

                const stockTickers = news.stocks.map(stock => stock.name).join(', ');
                if (!stockTickers) {
                    console.log(`Skipping article with no stock tickers: ${news.title}`);
                    return null;
                }

                const sentimentScore = await analyzeNewsSentiment(news.title, info, stockTickers);
                const articleDate = new Date(news.created).toLocaleString('en-US', { timeZone: 'America/New_York' });

                console.log('------------------------------------------------------');
                console.log(`Title: ${news.title}`);
                console.log(`Date: ${articleDate}`);
                console.log(`Information: ${info}`);
                console.log(`Stock Tickers: ${stockTickers}`);
                console.log(`Sentiment Score: \x1b[34m${sentimentScore}\x1b[0m`);
                console.log('------------------------------------------------------');

                await saveScores(stockTickers, sentimentScore);

                return news.id;
            });

            await Promise.all(sentimentPromises);

            // Update lastUpdatedTimestamp to the highest timestamp of processed articles or the latest article's timestamp
            if (maxTimestamp > lastUpdatedTimestamp) {
                lastUpdatedTimestamp = maxTimestamp;
                fs.writeFileSync(TIMESTAMP_FILE, lastUpdatedTimestamp.toString());
            }
            console.log('All news items processed.');
        } else {
            console.log('No new news to process at this time.');
        }
    } catch (error) {
        console.error('Error fetching Benzinga news:', error);
    }
    setTimeout(fetchBenzingaNews, 1000); // Schedule the next fetch
}

async function fetchWithRetry(url, options, retries = 5, backoff = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.ok) {
                return response;
            } else if (response.status === 429) {
                console.warn(`Rate limit exceeded. Retrying in ${backoff}ms...`);
                await delay(backoff);
                backoff *= 2; // Exponential backoff
            } else {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
        } catch (error) {
            if (i === retries - 1) {
                throw error; // If it's the last retry, throw the error
            }
            console.warn(`Attempt ${i + 1} failed. Retrying in ${backoff}ms...`);
            await delay(backoff);
            backoff *= 2; // Exponential backoff
        }
    }
    throw new Error('Max retries reached');
}

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function analyzeNewsSentiment(title, info, stockTickers) {
    const prompt = `Analyze this article for the following stocks: "${stockTickers}", rate how much this news will increase or decrease each stock on a scale from 0-100, 0=large % drop, 100= large % increase in stock price. Respond ONLY in this format "stockticker: rating 0-100" for each "${stockTickers}". or else respond with "NA". Article: "${title}" "${info}"`;

    try {
        const response = await openai.chat.completions.create({
            messages: [{ role: "system", content: "" }, { role: "user", content: prompt }],
            model: "gpt-4o", // or: gpt-3.5-turbo
        });

        const sentimentScore = response.choices[0].message.content.trim();
        return sentimentScore;
    } catch (error) {
        console.error('Error analyzing news sentiment:', error);
        return "Error analyzing sentiment";
    }
}

let currentScoreId = loadCurrentScoreId(); // Load the last saved ID on startup

function saveScores(tickers, sentimentScore) {
    const scoreLines = sentimentScore.split('\n');
    const scoreEntries = scoreLines.map(line => {
        const parts = line.split(':');
        if (parts.length === 2) {
            const ticker = parts[0].trim();
            const score = parseInt(parts[1].trim(), 10);
            // Check if the ticker contains the '$' symbol and skip if it does
            if (!ticker.includes('$') && !isNaN(score)) {
                return `${currentScoreId++}, ${ticker}, ${score}\n`;
            } else {
                console.log(`Skipping score entry for ticker ${ticker}`);
            }
        } else {
            console.error(`Failed to parse score for ticker from line: ${line}`);
        }
        return null;
    }).filter(entry => entry !== null);

    try {
        fs.appendFileSync(SCORES_FILE, scoreEntries.join(''));
        saveCurrentScoreId(currentScoreId); // Save the updated ID
    } catch (error) {
        console.error('Error writing to scores file:', error);
    }
}

function saveCurrentScoreId(id) {
    fs.writeFileSync('./lastScoreId.txt', id.toString());
}

function loadCurrentScoreId() {
    try {
        const data = fs.readFileSync('./lastScoreId.txt', 'utf8');
        const id = parseInt(data, 10);
        if (isNaN(id)) throw new Error('Invalid ID');
        return id;
    } catch (error) {
        console.error('Error reading lastScoreId file, starting from 0:', error);
        return 0;  // Start from 0 if the file doesn't exist or is invalid
    }
}

async function clearScores() {
    // This function will clear the scores file
    try {
        await fsPromises.writeFile(SCORES_FILE, '');
        console.log('Scores cleared successfully.');
    } catch (error) {
        console.error('Error clearing scores file:', error);
    }
}

setInterval(clearScores, 300000);
fetchBenzingaNews();

// Global error handler for unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
