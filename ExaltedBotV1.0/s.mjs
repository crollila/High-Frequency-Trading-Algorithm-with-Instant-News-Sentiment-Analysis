import dotenv from 'dotenv';
import fetch from 'node-fetch';
import Alpaca from '@alpacahq/alpaca-trade-api';
import fs from 'fs';
import moment from 'moment-timezone';

// Initialize dotenv to load environment variables
dotenv.config();

const alpaca = new Alpaca({
        keyId: process.env.APCA_API_KEY_ID,
        secretKey: process.env.APCA_API_SECRET_KEY,
        paper: true,
});

const FMP_API_KEY = process.env.FMP_API_KEY;
const LIVE_POSITIONS_FILE = '../ExtendedPositions/LivePositionsPrice.txt';
const LOG_FILE = './Positions.txt';
const SCORES_FILE = '../News/scores.txt';
let positions = [];
let lastProcessedId = getLastProcessedId();

let isProcessingScores = false;

async function main() {
    // Set up file watcher to detect changes in the scores file
    fs.watch(SCORES_FILE, async (eventType, filename) => {
        if (eventType === 'change') {
            await processNewScores();
        }
    });

    // Initial run to process any existing scores
    await processNewScores();
}

async function processNewScores() {
    if (isProcessingScores) return; // Prevent concurrent processing
    isProcessingScores = true;

    try {
        let lastProcessedId = getLastProcessedId();
        const scores = readScores().filter(score => score.id > lastProcessedId);

        if (scores.length > 0) {
            for (const { id, ticker, score } of scores) {
                console.log(`Processing score for ${ticker}: ${score}`);
                await executeTrade(ticker, score);
                updateLastProcessedId(id);
            }
        } else {
            console.log("No new scores to process.");
        }
    } catch (error) {
        console.error('Error processing scores:', error);
    } finally {
        isProcessingScores = false;
    }
}

async function retryOperation(fn, retries = 5, delay = 10000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === retries - 1) {
                throw error; // Re-throw error if last retry also fails
            }
            console.error(`Operation failed. Retrying in ${delay / 1000} seconds...`, error);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// Example of how to use retryOperation
retryOperation(main).catch(error => {
    console.error('Unhandled error in retryOperation:', error);
});

async function ProcessScores() {
    while (true) {
        try {
            let lastProcessedId = getLastProcessedId();
            const scores = readScores().filter(score => score.id > lastProcessedId);

            if (scores.length > 0) {
                for (const { id, ticker, score } of scores) {
                    console.log(`Processing score for ${ticker}: ${score}`);
                    await executeTrade(ticker, score);
                    updateLastProcessedId(id);
                }
            } else {
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for 1 second if no scores
            }
        } catch (error) {
            console.error('Error processing scores:', error);
            await new Promise(resolve => setTimeout(resolve, 10000)); // Wait for 10 seconds before retrying
        }
    }
}

function readScores() {
    try {
        const scoresData = fs.readFileSync(SCORES_FILE, 'utf8');
        return scoresData.split('\n')
            .filter(Boolean)
            .map(line => {
                const parts = line.split(',');
                return { id: parseInt(parts[0]), ticker: parts[1].trim(), score: parseInt(parts[2].trim(), 10) };
            })
            .filter(entry => entry.id > lastProcessedId);
    } catch (error) {
        console.error('Failed to read scores file:', error);
        return [];
    }
}

function updateLastProcessedId(id) {
    fs.writeFileSync('./lastProcessedId.txt', id.toString());
}

function getLastProcessedId() {
    try {
        const id = fs.readFileSync('./lastProcessedId.txt', 'utf8');
        return parseInt(id, 10);
    } catch (error) {
        // If there's an error reading the file, assume no scores have been processed.
        return 0;
    }
}

// Helper function to read the log file and return a JavaScript object
function readLog() {
    try {
        const fileContent = fs.readFileSync(LOG_FILE, 'utf8');
        return fileContent ? JSON.parse(fileContent) : {};
    } catch (error) {
        console.error('Error reading log file:', error);
        return {};
    }
}

// Helper function to write the updated log back to the file
function writeLog(log) {
    try {
        fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2), 'utf8');
    } catch (error) {
        console.error('Error writing to log file:', error);
    }
}

// Helper function to read LivePositionsPrice.txt file
function getLivePositionPrices() {
    try {
        const data = fs.readFileSync(LIVE_POSITIONS_FILE, 'utf8');
        const lines = data.split('\n');
        const prices = {};
        for (const line of lines) {
            const [symbol, price] = line.split(':');
            if (symbol && price) {
                prices[symbol.trim()] = parseFloat(price.trim());
            }
        }
        return prices;
    } catch (error) {
        console.error('Error reading LivePositionsPrice.txt:', error);
        return {};
    }
}

async function getCurrentPositionPrices() {
    try {
        const positions = await retryOperation(() => alpaca.getPositions());
        if (!Array.isArray(positions)) {
            console.error('Positions fetched are not an array:', positions);
            return null; // Return null if positions is not an array
        }

        const now = moment().tz("America/New_York");
        const hour = now.hour();
        const minute = now.minute();
        const isTradingHours = (hour > 9 || (hour === 9 && minute >= 30)) && hour < 16;

        const prices = {};

        if (isTradingHours) {
            // Use current prices from Alpaca during trading hours
            positions.forEach(position => {
                prices[position.symbol] = {
                    symbol: position.symbol,
                    current_price: parseFloat(position.current_price),
                    qty: parseFloat(position.qty),
                    avg_entry_price: parseFloat(position.avg_entry_price)
                };
            });
        } else {
            // Use prices from LivePositionsPrice.txt outside trading hours and qty from Alpaca positions
            const livePrices = getLivePositionPrices();
            positions.forEach(position => {
                const symbol = position.symbol;
                if (livePrices[symbol]) {
                    prices[symbol] = {
                        symbol: symbol,
                        current_price: livePrices[symbol],
                        qty: parseFloat(position.qty),
                        avg_entry_price: parseFloat(position.avg_entry_price)
                    };
                }
            });
        }

        return prices;
    } catch (error) {
        console.error('Failed to fetch positions:', error.message);
        return null; // Return null if there's an error fetching positions
    }
}

async function getCurrentStockPrice(symbol) {
    const now = moment().tz("America/New_York");
    const hour = now.hour();
    const minute = now.minute();
    const isTradingHours = (hour > 9 || (hour === 9 && minute >= 30)) && hour < 16;

    if (isTradingHours) {
        // Fetch current price from Alpaca during trading hours
        try {
            const url = `https://data.alpaca.markets/v2/stocks/${symbol}/trades/latest`;
            const response = await fetchWithRetry(url, {
                headers: {
                    'APCA-API-KEY-ID': process.env.APCA_API_KEY_ID,
                    'APCA-API-SECRET-KEY': process.env.APCA_API_SECRET_KEY
                }
            });

            const data = await response.json();
            const current_price = data.trade.p;

            if (!current_price) {
                console.error(`No valid price data found for ${symbol} from Alpaca`);
                return null;
            }
            return current_price;
        } catch (error) {
            console.error(`Error fetching price for ${symbol} from Alpaca:`, error);
            return null;
        }
    } else {
        // Fetch current price from Financial Modeling Prep API outside trading hours
        try {
            const url = `https://financialmodelingprep.com/api/v4/pre-post-market-trade/${symbol}?apikey=${FMP_API_KEY}`;
            const response = await fetchWithRetry(url);

            const data = await response.json();
            const current_price = data.price;

            if (!current_price) {
                console.error(`No valid price data found for ${symbol} from FMP`);
                return null;
            }
            return current_price;
        } catch (error) {
            console.error(`Error fetching price for ${symbol} from Financial Modeling Prep API:`, error);
            return null;
        }
    }
}

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

async function updateAndCheckPositions() {
    const accountDetails = await alpaca.getAccount();
    const totalAccountValue = parseFloat(accountDetails.equity);
    const buyingPower = parseFloat(accountDetails.buying_power); // This includes margin
    const regTBuyingPower = totalAccountValue * 2; // RegT allows leverage up to 2:1
    const bufferThreshold = regTBuyingPower * 0.98; // 2% buffer below the RegT threshold
    const positionMarketValue = parseFloat(accountDetails.position_market_value);
    const powerPercentage = ((regTBuyingPower - positionMarketValue) / regTBuyingPower) * 100;

    console.log(`MARGIN INFO:`);
    console.log(`Total Account positions: $${positionMarketValue}`);
    console.log(`Equity: $${totalAccountValue}`);
    console.log(`Buying Power: $${buyingPower}`);
    console.log(`RegT Buying Power Threshold: $${regTBuyingPower}`);
    console.log(`${powerPercentage.toFixed(2)}% of RegT portfolio is unspent`);
    console.log('------------------------------------------------------');

    const currentPositions = await getCurrentPositionPrices();
    if (!currentPositions) return; // Stop execution if currentPositions is null

    const currentPrices = Object.keys(currentPositions).reduce((acc, symbol) => {
        acc[symbol] = currentPositions[symbol].current_price;
        return acc;
    }, {});

    // Check if the total position value exceeds the buffer threshold
    if (positionMarketValue > bufferThreshold) {
        console.log("Total position value exceeds margin buffer threshold. Adjusting positions...");

        // Find the position with the lowest gain since its highest logged price
        let lowestGainer = null;
        let lowestGainPercentage = Infinity;

        for (const symbol in currentPositions) {
            const currentPrice = currentPositions[symbol].current_price;
            const qty = currentPositions[symbol].qty;
            const isShort = qty < 0; // Identify if it's a short position
            const loggedPrices = readLog()[symbol] || { highest: currentPrice, lowest: currentPrice };
            const highestLoggedPrice = parseFloat(loggedPrices.highest);
            const lowestLoggedPrice = parseFloat(loggedPrices.lowest);
            const gainPercentage = isShort 
                ? ((lowestLoggedPrice - currentPrice) / lowestLoggedPrice) * 100 
                : ((currentPrice - highestLoggedPrice) / highestLoggedPrice) * 100;

            if (gainPercentage < lowestGainPercentage) {
                lowestGainer = { symbol, currentPrice, qty };
                lowestGainPercentage = gainPercentage;
            }
        }

        if (lowestGainer) {
            const { symbol, currentPrice, qty } = lowestGainer;
            console.log(`Lowest gaining position: ${symbol} with a gain of ${lowestGainPercentage}%`);
            const valueOfLowestGainer = currentPrice * qty;

            let limit_price;
            if (qty < 0) { // Covering a short position
                limit_price = currentPrice * 1.01;
            } else { // Selling a long position
                limit_price = currentPrice * 0.99;
            }
            limit_price = Number(limit_price.toFixed(2)); // Ensures two decimal precision

            if (valueOfLowestGainer < regTBuyingPower * 0.02) {
                if (qty < 0) {
                    await coverPosition(symbol, Math.abs(qty), limit_price);
                } else {
                    await sellPosition(symbol, Math.abs(qty), limit_price);
                }
            } else {
                const quantityToSell = (regTBuyingPower * 0.02) / currentPrice;
                if (qty < 0) {
                    await coverPosition(symbol, quantityToSell, limit_price);
                } else {
                    await sellPosition(symbol, quantityToSell, limit_price);
                }
            }
        }
    }

    const log = readLog();

    const openOrders = await alpaca.getOrders({ status: 'open' });

    await Promise.all(Object.keys(currentPositions).map(async (symbol) => {
        const { current_price, qty, avg_entry_price } = currentPositions[symbol];
        const isShort = qty < 0; // Identify if it's a short position

        // Use the higher of the average entry price or current price to update the log
        let loggedPrices = log[symbol] || { highest: 0, lowest: Number.POSITIVE_INFINITY };
        let newHighestPrice = Math.max(avg_entry_price, current_price, loggedPrices.highest);
        let newLowestPrice = Math.min(avg_entry_price, current_price, loggedPrices.lowest);

        // Update the log if the new log prices are different
        if (newHighestPrice !== loggedPrices.highest || newLowestPrice !== loggedPrices.lowest) {
            log[symbol] = { highest: newHighestPrice, lowest: newLowestPrice };
            console.log(`Updated ${symbol} in the log with highest price: ${newHighestPrice} and lowest price: ${newLowestPrice}`);
        }

        // Proceed with selling or covering logic if the current price has crossed the threshold
        const priceThreshold = isShort ? loggedPrices.lowest * 1.05 : loggedPrices.highest * 0.95;
        if ((isShort && current_price > priceThreshold) || (!isShort && current_price < priceThreshold)) {
            console.log(`${symbol} has crossed the threshold since its logged price.`);

            const existingOrders = openOrders.filter(order => order.symbol === symbol && ((isShort && order.side === 'buy') || (!isShort && order.side === 'sell')));
            const totalOrderQty = existingOrders.reduce((sum, order) => sum + parseFloat(order.qty), 0);

            let limit_price = current_price;  // Define limit_price here

            if (totalOrderQty < Math.abs(qty)) {
                console.log(`Found existing ${isShort ? 'cover' : 'sell'} orders for ${symbol}. Adjusting quantity to ${isShort ? 'cover' : 'sell'}...`);
                let remainingQty = Math.abs(qty) - totalOrderQty;

                limit_price = isShort ? current_price * 1.01 : current_price * 0.99;
                limit_price = Number(limit_price.toFixed(2));
                limit_price = Math.floor(limit_price * 100) / 100;

                if (remainingQty > 0) {
                    if (isShort) {
                        await coverPosition(symbol, remainingQty, limit_price); // Cover short position
                    } else {
                        await sellPosition(symbol, remainingQty, limit_price); // Sell long position
                    }
                } else {
                    console.log(`No remaining shares to ${isShort ? 'cover' : 'sell'} for ${symbol}`);
                }
            } else if (existingOrders.length === 0) {
                if (isShort) {
                    await coverPosition(symbol, Math.abs(qty), limit_price); // Cover short position
                } else {
                    await sellPosition(symbol, qty, limit_price); // Sell long position
                }
            } else {
                console.log(`Sufficient existing ${isShort ? 'cover' : 'sell'} orders for ${symbol}, no action needed.`);
            }
        }
    }));    

    // Remove stocks from the log that are no longer in positions
    for (const symbol in log) {
        if (!Object.keys(currentPositions).includes(symbol)) {
            delete log[symbol];
            console.log(`Removed ${symbol} from the log as it is no longer owned.`);
        }
    }

    writeLog(log); // Save the updated log after all positions are processed
}


async function sellPosition(symbol, quantity, limit_price) {
    try {
        const absQty = Math.abs(quantity);
        const currentPosition = await alpaca.getPosition(symbol);

        if (!currentPosition || currentPosition.qty < absQty) {
            console.error(`Not enough quantity available to sell. Available: ${currentPosition ? currentPosition.qty : 0}, Required: ${absQty}`);
            return;
        }

        const order = await alpaca.createOrder({
            symbol: symbol,
            qty: absQty,
            side: 'sell',
            type: 'limit',
            limit_price: limit_price,
            time_in_force: 'day',
            extended_hours: true
        });

        console.log(`Successfully placed sell order for ${quantity} shares of ${symbol} at a limit price of $${limit_price} for a total of $${limit_price * quantity} to increase cash available.`);
    } catch (error) {
        console.error(`Failed to place sell order for ${symbol} to increase cash available:`, error.message);
    }
}


async function coverPosition(symbol, quantity, limit_price) {
    try {
        // Check if there's an existing open buy order for the symbol
        const openOrders = await alpaca.getOrders({ status: 'open' });
        const existingBuyOrders = openOrders.filter(order => order.symbol === symbol && order.side === 'buy');
        if (existingBuyOrders.length > 0) {
            console.log(`${symbol} Currently has an existing cover order`);
            return;
        }

        // Place the buy order to cover the position
        const order = await alpaca.createOrder({
            symbol: symbol,
            qty: quantity,
            side: 'buy',
            type: 'limit',
            limit_price: limit_price,
            time_in_force: 'day',
            extended_hours: true
        });
        console.log(`Successfully placed buy order to cover ${quantity} shares of ${symbol} at a limit price of $${limit_price} for a total of $${limit_price * quantity} to cover the short position.`);
    } catch (error) {
        console.error(`Failed to place buy order to cover ${symbol} to cover the short position:`, error);
    }
}

async function fetchLastTradingDayVolume(symbol) {
    for (let daysAgo = 1; daysAgo <= 7; daysAgo++) {
        let date = moment().tz("America/New_York").subtract(daysAgo, "days");
        if (date.day() !== 6 && date.day() !== 0) {  // skip weekends
            let start = date.startOf('day').format();
            let end = date.endOf('day').format();

            const bars = await alpaca.getBarsV2(
                symbol,
                {
                    start: start,
                    end: end,
                    timeframe: "1Day",
                    adjustment: 'raw'
                },
                alpaca.configuration
            );

            let barset = [];
            for await (let bar of bars) {
                barset.push(bar);
            }

            if (barset.length > 0) {
                return barset[0].Volume; // Return the volume of the last trading day
            }
        }
    }
    return 0;  // Return zero if no trading data is available
}

async function executeTrade(symbol, score) {
    if (!symbol.match(/^[A-Z]+$/)) {
        console.log(`No trading volume available for ${symbol}.`);
        return;
    }
    if (Number.isNaN(score)) {
        console.log(`Score for ${symbol} is not a number. No trade executed.`);
        console.log('------------------------------------------------------');
        return;
    }
    const lastDayVolume = await fetchLastTradingDayVolume(symbol);
    if (lastDayVolume === 0) {
        console.log(`No trading volume available for ${symbol}.`);
        return 0;
    }

    // Fetch account details and current stock price
    const account = await alpaca.getAccount();
    const equity = parseFloat(account.equity);
    const buyingPower = parseFloat(account.buying_power);
    const Y = equity / 500;

    const current_price = await getCurrentStockPrice(symbol);

    if (!current_price) {
        console.error(`Error fetching price for ${symbol}`);
        return;
    }

    // Calculate the trading volume * price from the previous day
    const tradeValueThreshold = 5000000; // Set your threshold value here
    const tradeValue = lastDayVolume * current_price;

    console.log(`Trade value: ${tradeValue}`);
    console.log(`Account Value: $${equity}`);
    console.log(`Buying Power: $${buyingPower}`);

    let action = 'hold';
    let quantity = 0;
    let limit_price = current_price;

    if (score >= 70) {
        if (tradeValue < tradeValueThreshold) {
            console.log(`Trade value of ${symbol} is below the threshold. No trade executed.`);
            console.log('------------------------------------------------------');
            return;
        }
        action = 'buy';
        quantity = determineQuantity(score, Y, current_price, equity, buyingPower);
        limit_price = current_price * 1.007;
        limit_price = Number(limit_price.toFixed(2)); // Ensure the limit price is rounded to two decimal places
    } else if (score <= 45) {
        action = 'sell';
        const position = await alpaca.getPosition(symbol).catch(err => {
            console.error(`No current positions of ${symbol}:`, err.message);
            return { qty: 0 };
        });
        quantity = determineSellQuantity(score, position.qty);
        limit_price = current_price * 0.99;
    }

    limit_price = Number(limit_price.toFixed(2)); // Ensure the limit price is rounded to two decimal places

    // Implement short selling logic
    if (score <= 30) {
        if (tradeValue < tradeValueThreshold) {
            console.log(`Trade value of ${symbol} is below the threshold. No short executed.`);
            console.log('------------------------------------------------------');
            return;
        }
        // Sell current shares if any
        const position = await alpaca.getPosition(symbol).catch(err => {
            return { qty: 0 };
        });
        if (position.qty > 0) {
            await sellPosition(symbol, position.qty, current_price);
        }

        // Determine the multiplier for short selling
        let multiplier = 1;
        if (score <= 30) multiplier = 2;
        if (score <= 20) multiplier = 4;
        if (score <= 10) multiplier = 9;
        if (score === 0) multiplier = 15;

        let quantityToShort = determineShortQuantity(score, Y, current_price, multiplier, equity, buyingPower);
        quantityToShort = Math.floor(quantityToShort); // Ensure quantity is not fractional for shorting
        if (quantityToShort === 0) {
            console.log(`Cannot short fractional shares for ${symbol}. Skipping this order.`);
            return;
        }
        limit_price = current_price * 0.993;
        limit_price = Number(limit_price.toFixed(2)); // Ensure the limit price is rounded to two decimal places

        try {
            const order = await alpaca.createOrder({
                symbol: symbol,
                qty: quantityToShort,
                side: 'sell',
                type: 'limit',
                limit_price: limit_price,
                time_in_force: 'day',
                extended_hours: true
            });
            console.log(`Shorted ${quantityToShort} shares of ${symbol} at ${limit_price}.`);
            console.log('------------------------------------------------------');
        } catch (error) {
            console.error(`Error shorting ${symbol}:`, error.message);
            console.log('------------------------------------------------------');
        }
    }

    if (action !== 'hold' && quantity > 0) {
        try {
            const order = await alpaca.createOrder({
                symbol: symbol,
                qty: quantity,
                side: action,
                type: 'limit',
                limit_price: limit_price,
                time_in_force: 'day',
                extended_hours: true
            });
            console.log(`Order successful: ${action} ${quantity} shares of ${symbol} at $${limit_price}`);
            console.log('------------------------------------------------------');
        } catch (error) {
            console.error(`Error executing ${action} for ${symbol}:`, error.message);
            console.log('------------------------------------------------------');
        }
    } else {
        console.log(`No action needed for ${symbol} with score ${score}`);
        console.log('------------------------------------------------------');
    }
}

function determineQuantity(score, Y, current_price, equity, buyingPower) {
    let factor = 0;
    if (score === 100) factor = 19;
    else if (score >= 90) factor = 14;
    else if (score >= 80) factor = 6;
    else if (score >= 70) factor = 3;

    // Ensure we stay within RegT buying power limits
    const maxQuantity = (equity * 2 - equity) / current_price;
    return Math.min((Y * factor) / current_price, maxQuantity);
}

function determineSellQuantity(score, positionQty) {
    if (score <= 30) return positionQty; // Sell all shares
    return Math.ceil(positionQty / 2); // Sell half, rounded up
}

function determineShortQuantity(score, Y, current_price, multiplier, equity, buyingPower) {
    // Ensure we stay within RegT buying power limits
    const maxQuantity = (equity * 2 - equity) / current_price;
    return Math.min(Math.floor((Y * multiplier) / current_price), maxQuantity);
}

async function cancelOrdersOutsideTradingHours() {
    const now = moment().tz("America/New_York"); // Get current time in Eastern Time
    const etHour = now.hour(); // Get the hour in Eastern Time
    const minute = now.minute(); // Get the minute

    console.log(`Checking orders to cancel outside trading hours. Current ET time: ${etHour}:${minute}`);

    // Check if current ET time is outside trading hours (before 9:30 am or after 4:00 pm)
    if (etHour < 4 || etHour >= 20 || (etHour === 9 && minute < 30)) {
        const openOrders = await alpaca.getOrders({ status: 'open' });
        const buyOrders = openOrders.filter(order => order.side === 'buy');
        const sellOrders = openOrders.filter(order => order.side === 'sell');

        console.log(`Found ${buyOrders.length} open buy orders outside trading hours.`);

        // Cancel buy orders outside trading hours
        for (const order of buyOrders) {
            try {
                await alpaca.cancelOrder(order.id);
                console.log(`Cancelled buy order ${order.id} for ${order.symbol}`);
            } catch (error) {
                console.error(`Error cancelling buy order ${order.id} for ${order.symbol}:`, error);
            }
        }

        console.log(`Found ${sellOrders.length} open sell orders outside trading hours.`);

        // Cancel sell orders that exceed the current position
        for (const order of sellOrders) {
            try {
                const position = await alpaca.getPosition(order.symbol).catch(err => {
                    console.error(`No open positions of ${order.symbol}`);
                    return { qty: 0 };
                });
                const positionQty = parseFloat(position.qty);
                const orderQty = parseFloat(order.qty);

                if (orderQty > positionQty) {
                    await alpaca.cancelOrder(order.id);
                    console.log(`Cancelled sell order ${order.id} for ${order.symbol} because it exceeds the current position.`);
                }
            } catch (error) {
                console.error(`Error cancelling sell order ${order.id} for ${order.symbol}:`, error);
            }
        }
    }
}


async function cancelFailedLimitOrders() {
    console.log(`Checking non-filled limit orders to cancel.`);
    const openOrders = await alpaca.getOrders({ status: 'open' });
    const nowInEasternTime = moment().tz("America/New_York");

    for (const order of openOrders) {
        const orderCreationTime = moment(order.created_at).tz("America/New_York");
        const timeDifference = nowInEasternTime.diff(orderCreationTime, 'minutes');

        if (timeDifference > 5) {
            try {
                await alpaca.cancelOrder(order.id);
                console.log(`Cancelled order ${order.id} for ${order.symbol} after ${timeDifference} minutes.`);
            } catch (error) {
                console.error(`Error cancelling order ${order.id} for ${order.symbol}:`, error);
            }
        }
    }
}

async function reviewAndSellPositions() {
    const currentPositions = await getCurrentPositionPrices();
    if (!currentPositions) return; // Stop execution if currentPositions is null

    for (const symbol in currentPositions) {
        const { current_price, qty, avg_entry_price } = currentPositions[symbol];
        
        if (current_price === null || isNaN(current_price)) {
            console.error(`Could not fetch current price for ${symbol}`);
            continue;
        }

        const isShort = qty < 0; // Identify if it's a short position
        const loggedPrices = readLog()[symbol] || { highest: avg_entry_price, lowest: avg_entry_price };
        const highestLoggedPrice = parseFloat(loggedPrices.highest);
        const lowestLoggedPrice = parseFloat(loggedPrices.lowest);

        const percentageChange = isShort 
            ? ((lowestLoggedPrice - current_price) / lowestLoggedPrice) * 100 
            : ((current_price - highestLoggedPrice) / highestLoggedPrice) * 100;

        let limit_price = isShort ? current_price * 1.01 : current_price * 0.99;
        limit_price = Number(limit_price.toFixed(2));

        if ((isShort && percentageChange >= 3.5) || (!isShort && percentageChange <= -3.5)) {
            const action = isShort ? 'buy' : 'sell';
            const absQty = Math.abs(qty); // Ensure the full quantity is used for covering

            console.log(`${action === 'sell' ? 'Selling' : 'Buying to cover'} ${absQty} shares of ${symbol} due to a ${isShort ? 'gain' : 'drop'} of 3.5% or more.`);

            await alpaca.createOrder({
                symbol: symbol,
                qty: absQty,
                side: action,
                type: 'limit',
                limit_price: limit_price,
                time_in_force: 'day',
                extended_hours: true
            }).catch(error => {
                console.error(`An order likley already exists ${action} for ${symbol}:`);
            });
        }
    }
}

setInterval(cancelFailedLimitOrders, 30000);
setInterval(cancelOrdersOutsideTradingHours, 30000);
setInterval(reviewAndSellPositions, 30000);
setInterval(updateAndCheckPositions, 10000);
updateAndCheckPositions();
retryOperation(main).catch(error => {
    console.error('Unhandled error in retryOperation:', error);
});

main();