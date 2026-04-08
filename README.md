
### Clone this Repository
Run 
```bash
git clone git@github.com:nrllh/2025-lead-ecosystem.git
```

---

### Install NodeJS
Installing NodeJS for macOS using `nvm` and `npm`.  
For alternative settings, see: https://nodejs.org/en/download

```bash
# 1️⃣ Download and install nvm:
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash

# 2️⃣ Load nvm (if not restarting shell)
\. "$HOME/.nvm/nvm.sh"

# 3️⃣ Install Node.js:
nvm install 22

# 4️⃣ Verify Node.js version:
node -v      # Should print "v22.15.0"
nvm current  # Should print "v22.15.0"

# 5️⃣ Verify npm version:
npm -v       # Should print "10.9.2"
```

---

### Install Redis
For macOS using Homebrew:

```bash
brew install redis

# Start Redis server (default port 6379)
brew services start redis

# Check Redis is running
redis-cli ping    # Should respond with PONG
```

For Linux:

```bash
sudo apt update
sudo apt install redis-server

# Start and enable Redis
sudo systemctl enable redis
sudo systemctl start redis

# Check Redis is running
redis-cli ping    # Should respond with PONG
```

---

### Install Dependencies
Run
```bash
npm install
```

---

### Run Crawler
Run
```bash
node crawler.js <site_id> <webpage_url>
```
Example:
```bash
node crawler.js 1 https://google.com
```

---

### Completing the Crawl
Press `Ctrl + C` in the terminal window where the crawler is running.

---

### Process Redis Queues in Parallel

In a **separate terminal window**, start the queue processor:

```bash
node process_queue.js
```

✅ This will consume data from Redis (e.g., JS overrides, callstacks)  
✅ The processor writes this data into a separate database for analysis  

✅ **Both `crawler.js` and `process_queue.js` should run in parallel**
