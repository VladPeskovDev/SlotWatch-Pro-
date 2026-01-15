# SlotWatch Pro

Universal queue monitoring browser extension. Automatically detects page changes through visual screenshot comparison and sends instant Telegram alerts when slots become available.

## Features

- 🔍 **Visual Monitoring** - Compares screenshots pixel-by-pixel to detect any changes
- 📸 **Auto-refresh** - Automatically reloads the monitored page every 10-15 seconds
- 💬 **Telegram Notifications** - Instant alerts when changes are detected
- 🔔 **Browser Notifications** - Built-in Chrome notifications as backup
- ⚙️ **Configurable** - Customizable monitoring intervals and detection sensitivity
- 🌐 **Universal** - Works on any website with queues or booking systems

## Use Cases

- Government services appointment booking (СИЗО, Госуслуги)
- Visa center appointments
- Medical appointments
- Concert/event tickets
- Restaurant reservations
- Any queue-based system

## How It Works

1. **Capture Reference**: Take a screenshot of the page showing "No slots available"
2. **Start Monitoring**: Extension automatically refreshes the page every 10-15 seconds
3. **Visual Comparison**: Compares new screenshots with the reference image
4. **Alert**: When >5% of pixels change, sends Telegram notification

## Installation

### Prerequisites

- Node.js 18+ and npm
- Google Chrome or Brave browser
- Telegram account

### Build from Source

1. Clone the repository:
```bash
git clone https://github.com/yourusername/SlotWatch-Pro.git
cd SlotWatch-Pro
```

2. Install dependencies:
```bash
npm install
```

3. Build the extension:
```bash
npm run build
```

4. Load in Chrome:
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist/` folder

## Setup

### 1. Create Telegram Bot

1. Open Telegram and find [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow instructions
3. Copy the **Bot Token** (looks like `1234567890:ABCdef...`)

### 2. Get Your Chat ID

1. Find [@userinfobot](https://t.me/userinfobot) in Telegram
2. Send `/start`
3. Copy your **Chat ID** (a number like `123456789`)

### 3. Configure Extension

1. Click the SlotWatch Pro icon in Chrome
2. Enter your **Bot Token** and **Chat ID**
3. (Optional) Add custom detection keywords
4. Click **Save Settings**

## Usage

1. **Navigate** to the page you want to monitor
2. Make sure it shows "No slots available" or similar
3. Click **📸 Capture Reference** to save the current state
4. Click **▶️ Start Monitoring**
5. The extension will:
   - Refresh the page every 10-15 seconds
   - Compare screenshots
   - Alert you when changes are detected

**Note**: Keep the browser window open. The extension monitors the active tab.