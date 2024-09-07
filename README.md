# ChatGPTTradingBot :star:
This is my ChatGPT Trading bot, a Node.js project that uses the Alpaca Trade API for trading activities. When a live news event is released via Benzinga News, it will Immediatly send the important data from the article to a prompted GPT 4.0o and recieves a sentiment analysius response on if the event will have a positive or negative effect on the company stock on a scale from 0-100, 0=worst news, 100=best news. Based on that logic it will BUY/SELL, SHORT/COVER a certain amount of the stock that scales based on funds in the account and if margin trading is turned on. 

## Additional Features:
- Adjustable Fail safe mechanism at different thresholds that will sell all positions in the event of 
- Adjustable requirements for the volume/liquidity of a stock to be able to buy or short.
- Adjustable profit taking thresholds, 2%, 4%, 6%, 10% - Along with % of stock to be sold/covered after profiting from those thresholds.
- Instant and efficient News Reception, parsing, data feed into LLM and consistent accurate responses.
- From news -> Purchased stock = 5-70ms
- Live Logs all scores and prices of stock to compare against portfolio to make any adjustments/optimizations as needed at all times.
- Supports pre-market and after-market trading
- Supports pre-market and after-market live pricing updates to accurate adjust portfolio at all times. 
- In the case of internet outage, bot will continue to retry and run to save and update positions as soon as problems are resolved.
- Console log updates on thought process and execution of bot
- Bot will not invest in Crypto currencies, Adjustable

## BOT INFO
3 - "Time in beats timing" 5% emergency sell off - sell off lowest on new opportunity - Margin/Short
If anything drops 5% from highest logged price, sell (LONG)
If anything drops 5% from highest logged price, buy (SHORT)
Buy/Short tradeValueThreshold = 5000000 : /1
Buy/Short limit_price = current_price * 1.007 : .993
Sell/Cover limit_price = current_price * .99 : 1.01
emergency sell-off/cover @3.5% loss of position from avg purchase price

RegT Threshold @ 98%

## Getting Started

### Prerequisites
- Make sure [Node.js](https://nodejs.org/) is installed on your machine
- npm install 
- Configuration - Create your own ChatGPT API on https://platform.openai.com/
- Configuration - Create your own Alpaca account and obtain your API Keys on https://app.alpaca.markets/
- Configuration - Create your own Beninga News account and obtain your API Keys on https://www.benzinga.com/apis/ (14 day free trial)
- Configuration - Create your own Financial Modeling Prep account and obtain your API Keys on https://site.financialmodelingprep.com/developer/docs/pricing (for pre-after market live pricing and trading)
- Configuration - Inside the .env file enter your API Keys

### Running the Server
This script uses ECMAScript (ES) modules, which is a modern JavaScript module system that differs from CommonJS
- node s.mjs

### Dependancies
- @alpacahq/alpaca-trade-api
- dotenv
- fs
- moment-timezone
- node-fetch
- openai

### Tech Stack 
- Node.js (version 12 +)
- JavaScript (ES Modules)
- npm (usually comes with Node.js)(npm install)
- OpenAI
- dotenv
- node-fetch
- @alpacahq/alpaca-trade-api
- fs & fs/promises
- moment-timezone
npm install dotenv node-fetch @alpacahq/alpaca-trade-api moment-timezone openai
