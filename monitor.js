const fs = require('fs');
const path = require('path');
const axios = require('axios');
const EventEmitter = require('events');
const { HttpsProxyAgent } = require('https-proxy-agent');

const TARGET_URL = 'https://steamcommunity.com/market/listings/730/Charm%20%7C%20Die-cast%20AK/render/';
const OUTPUT_FILE = path.join(__dirname, 'found_items.txt');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

class Monitor extends EventEmitter {
  constructor() {
    super();
    this.running = false;
    this.seenListingIds = new Set();
    this.writtenLines = new Set();
    this.pollPromise = null;
    this.proxies = [];
    this.listingsToParse = 0;
    this.loadExistingFileLines();
  }

  loadExistingFileLines() {
    try {
      if (!fs.existsSync(OUTPUT_FILE)) {
        return;
      }
      const content = fs.readFileSync(OUTPUT_FILE, 'utf-8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) {
          this.writtenLines.add(trimmed);
        }
      }
    } catch (err) {
      this.log(`Failed to preload ${OUTPUT_FILE}: ${err.message}`);
    }
  }

  getStatus() {
    return this.running ? 'Running' : 'Stopped';
  }

  log(message) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${message}`;
    console.log(line);
    this.emit('log', line);
  }

  emitStatus() {
    this.emit('status', this.getStatus());
  }

  async start({ listingsToParse, proxies }) {
    if (this.running) {
      return { ok: false, error: 'Monitor is already running' };
    }

    this.listingsToParse = listingsToParse;
    this.proxies = proxies;
    this.running = true;
    this.emitStatus();
    this.log(`Started monitor. listingsToParse=${listingsToParse}, proxies=${proxies.length}`);

    this.pollPromise = this.runLoop().catch((err) => {
      this.log(`Monitor crashed: ${err.message}`);
    });

    return { ok: true, status: this.getStatus() };
  }

  async stop() {
    if (!this.running) {
      return { ok: true, status: this.getStatus(), message: 'Monitor already stopped' };
    }

    this.running = false;
    if (this.pollPromise) {
      await this.pollPromise;
      this.pollPromise = null;
    }

    this.emitStatus();
    this.log('Stopped monitor');
    return { ok: true, status: this.getStatus() };
  }

  async runLoop() {
    while (this.running) {
      await this.pollOnce();
      if (!this.running) break;
      await sleep(10_000);
    }
  }

  buildStartOffsets() {
    const starts = [];
    for (let start = 0; start < this.listingsToParse; start += 10) {
      starts.push(start);
    }
    return starts;
  }

  async pollOnce() {
    const starts = this.buildStartOffsets();
    this.log(`Polling ${starts.length} page(s)`);

    for (const start of starts) {
      if (!this.running) break;

      try {
        const data = await this.fetchPageWithRetry(start, 10);
        this.processResponse(data);
      } catch (err) {
        this.log(`Page start=${start} failed: ${err.message}`);
      }

      await sleep(randomInt(200, 500));
    }
  }

  pickProxy(excludeProxy = null) {
    const candidates = this.proxies.filter((p) => p !== excludeProxy);
    if (!candidates.length) {
      return null;
    }
    return candidates[randomInt(0, candidates.length - 1)];
  }

  async fetchPageWithRetry(start, count) {
    const firstProxy = this.pickProxy();
    try {
      return await this.fetchPage(start, count, firstProxy);
    } catch (firstErr) {
      this.log(`Retrying start=${start} after failure: ${firstErr.message}`);
      const secondProxy = this.pickProxy(firstProxy);
      return this.fetchPage(start, count, secondProxy);
    }
  }

  async fetchPage(start, count, proxyUrl) {
    const params = { start, count, currency: 1 };
    const config = {
      method: 'get',
      url: TARGET_URL,
      params,
      headers: {
        'User-Agent': 'Mozilla/5.0'
      },
      timeout: 10_000,
      validateStatus: (status) => status >= 200 && status < 300
    };

    if (proxyUrl) {
      const agent = new HttpsProxyAgent(proxyUrl);
      config.httpsAgent = agent;
      config.proxy = false;
    }

    const res = await axios(config);
    if (!res || typeof res.data !== 'object' || res.data === null) {
      throw new Error('Invalid JSON response');
    }

    return res.data;
  }

  processResponse(data) {
    const listinginfo = data.listinginfo;
    const assets = data.assets;

    if (!listinginfo || typeof listinginfo !== 'object') {
      this.log('Empty or malformed listinginfo');
      return;
    }

    if (!assets || typeof assets !== 'object') {
      this.log('Empty or malformed assets');
      return;
    }

    const entries = Object.entries(listinginfo);
    if (!entries.length) {
      this.log('No listings in response');
      return;
    }

    for (const [listingId, listing] of entries) {
      if (this.seenListingIds.has(listingId)) {
        continue;
      }
      this.seenListingIds.add(listingId);

      const asset = this.resolveAsset(assets, listing);
      if (!asset) continue;

      const template = this.extractTemplate(asset);
      if (template === null) continue;
      if (!this.isTemplateInRange(template)) continue;

      const priceCents = Number(listing.converted_price ?? listing.price);
      if (!Number.isFinite(priceCents)) continue;
      const price = (priceCents / 100).toFixed(2);

      const output = `ID: ${listingId} | Template: ${template} | Price: ${price}`;
      this.log(output);
      this.appendUniqueLine(output);
    }
  }

  resolveAsset(assets, listing) {
    const assetInfo = listing.asset;
    if (!assetInfo) return null;

    const appid = String(assetInfo.appid);
    const contextid = String(assetInfo.contextid);
    const assetId = String(assetInfo.id);

    const appMap = assets[appid];
    if (!appMap) return null;

    const contextMap = appMap[contextid];
    if (!contextMap) return null;

    return contextMap[assetId] || null;
  }

  extractTemplate(asset) {
    const descriptions = Array.isArray(asset.descriptions) ? asset.descriptions : [];
    for (const entry of descriptions) {
      const text = typeof entry.value === 'string' ? entry.value : '';
      const match = text.match(/Charm Template:\s*(\d+)/i);
      if (match) {
        return Number(match[1]);
      }
    }
    return null;
  }

  isTemplateInRange(template) {
    return (template >= 1 && template <= 5000) || (template >= 20000 && template <= 25000);
  }

  appendUniqueLine(payloadLine) {
    if (this.writtenLines.has(payloadLine)) {
      return;
    }

    this.writtenLines.add(payloadLine);
    const timestamp = new Date().toISOString();
    const fullLine = `[${timestamp}] ${payloadLine}`;
    fs.appendFile(OUTPUT_FILE, `${fullLine}\n`, (err) => {
      if (err) {
        this.log(`Failed to write to file: ${err.message}`);
      }
    });
  }
}

module.exports = Monitor;
