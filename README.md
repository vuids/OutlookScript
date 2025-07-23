# Outlook Automation Script

High-volume Outlook login automation with anti-detection features.

## 🚀 Features

- **Stealth Mode**: Anti-detection with user agent rotation and human-like behavior
- **2FA Support**: Automatic 2FA code generation and entry
- **Proxy Support**: Rotate through multiple proxy servers
- **High Volume**: Process thousands of accounts with concurrent workers
- **Real-time CSV**: Results written immediately as they complete
- **Error Categorization**: Network vs Microsoft blocking vs 2FA issues

## 📋 Setup

### 1. Install Dependencies
```bash
npm install puppeteer-extra puppeteer-extra-plugin-stealth clipboardy csv-parser csv-writer
```

### 2. Prepare Input File
Copy `input.example.csv` to `input.csv` and fill with your data:
```csv
email,password,proxy_str,twofa
your@email.com,password123,ip:port:user:pass,2FA_SECRET_KEY
```

### 3. Create Required Directories
```bash
mkdir -p cookies results/screenshots
```

### 4. Run the Script
```bash
node outlookScript.js
```

## 📁 File Structure

```
├── mainWithCredentials.js    # Main login logic with anti-detection
├── outlookScript.js          # Concurrent processing controller  
├── helperFunctions.js        # Utility functions
├── postLoginTasks.js         # Post-login automation
├── input.csv                 # Your credentials (excluded from git)
├── input.example.csv         # Template file
├── cookies/                  # Session cookies (excluded from git)
├── results/                  # Output CSV files (excluded from git)
└── .gitignore               # Excludes sensitive files
```

## ⚙️ Configuration

### Concurrency Settings
```javascript
// In outlookScript.js
const maxConcurrent = 3; // Adjust based on your needs
```

### Stealth Settings
- Random delays: 2-7 seconds between attempts
- User agent rotation: 4 different browsers
- Human-like typing: Variable keystroke delays
- Random viewports: Varies screen dimensions

## 🛡️ Security

- **Never commit** `input.csv` or any credential files
- **Never commit** cookies or session data
- **Use separate branch** for sensitive development
- **Rotate proxies** regularly to avoid IP bans

## 📊 Results

Results are written to:
- `results/success.csv` - Successful logins
- `results/failed.csv` - Failed attempts with error details

## 🐛 Troubleshooting

### Common Errors:
- **"All 2FA input fields disappeared"** - Microsoft detected automation
- **"net::ERR_ABORTED"** - Proxy connection issues  
- **"Execution context destroyed"** - Page navigation errors

### Solutions:
- Reduce concurrency (`maxConcurrent = 1`)
- Use higher quality proxies
- Increase delays between attempts
- Check proxy connectivity manually

## ⚠️ Disclaimer

This tool is for educational purposes and legitimate account management only. Users are responsible for complying with all applicable terms of service and laws.