# 🔑 OpenAI API Key Setup Guide

This guide shows you how to safely configure your OpenAI API key for the WorkTree Orchestrator.

## Quick Start (Recommended)

### Option 1: Using .env File (Most Secure & Repeatable)

1. **Copy the example environment file:**
   ```bash
   cp .env.example .env
   ```

2. **Edit .env and add your API key:**
   ```bash
   # Open in your editor
   nano .env
   # or
   vim .env
   # or
   code .env
   ```

3. **Add your OpenAI API key:**
   ```env
   OPENAI_API_KEY=sk-proj-...your-actual-key...
   ```

4. **Run the orchestrator:**
   ```bash
   node apps/api/bin/orc.cjs run "Create a cyberpunk track" --template templates/strudel-track.toml
   ```

   Node.js will automatically load `.env` if you're using a modern setup, but to be explicit, you can use dotenv-cli:

   ```bash
   npx dotenv-cli -- node apps/api/bin/orc.cjs run "Create a cyberpunk track" --template templates/strudel-track.toml
   ```

✅ **Advantages:**
- ✅ `.env` is gitignored - your key never gets committed
- ✅ Repeatable - just run the same command every time
- ✅ Easy to share with team (share `.env.example`, not `.env`)
- ✅ Can set multiple environment variables at once

---

### Option 2: Export in Your Shell (Session-Based)

**For current terminal session only:**

```bash
# Set the API key
export OPENAI_API_KEY="sk-proj-...your-actual-key..."

# Verify it's set
echo $OPENAI_API_KEY

# Run the orchestrator
node apps/api/bin/orc.cjs run "Create a cyberpunk track" --template templates/strudel-track.toml
```

**Make it persistent across all terminal sessions:**

Add to your shell config file:

```bash
# For bash users (add to ~/.bashrc)
echo 'export OPENAI_API_KEY="sk-proj-...your-key..."' >> ~/.bashrc
source ~/.bashrc

# For zsh users (add to ~/.zshrc)
echo 'export OPENAI_API_KEY="sk-proj-...your-key..."' >> ~/.zshrc
source ~/.zshrc
```

⚠️ **Warning:** This exposes your key to ALL processes in your shell.

---

### Option 3: Inline Environment Variable (Quick Testing)

**One-time run without saving:**

```bash
OPENAI_API_KEY="sk-proj-...your-key..." node apps/api/bin/orc.cjs run "Create a cyberpunk track" --template templates/strudel-track.toml
```

✅ **Advantages:**
- Quick testing
- Doesn't persist anywhere
- Safe for one-off commands

❌ **Disadvantages:**
- Must type key every time
- Key visible in shell history

---

### Option 4: Using direnv (Advanced - Best for Developers)

[direnv](https://direnv.net/) automatically loads `.env` when you enter the directory.

1. **Install direnv:**
   ```bash
   # Ubuntu/Debian
   sudo apt install direnv
   
   # macOS
   brew install direnv
   ```

2. **Hook direnv into your shell:**
   ```bash
   # Bash
   echo 'eval "$(direnv hook bash)"' >> ~/.bashrc
   
   # Zsh
   echo 'eval "$(direnv hook zsh)"' >> ~/.zshrc
   ```

3. **Create .envrc:**
   ```bash
   echo 'dotenv' > .envrc
   direnv allow .
   ```

4. **Copy and edit .env:**
   ```bash
   cp .env.example .env
   nano .env  # Add your key
   ```

Now direnv will automatically load `.env` whenever you `cd` into this directory!

---

## Getting Your OpenAI API Key

1. Go to [OpenAI Platform](https://platform.openai.com/api-keys)
2. Sign in or create an account
3. Click "Create new secret key"
4. **Copy the key immediately** (you won't see it again!)
5. The key starts with `sk-proj-` or `sk-`

---

## Security Best Practices

### ✅ DO:
- Store keys in `.env` files (gitignored)
- Use environment variables
- Rotate keys periodically
- Use different keys for dev/prod
- Set spending limits on OpenAI dashboard

### ❌ DON'T:
- Commit `.env` to git (it's already gitignored ✓)
- Share keys in Slack/Discord/email
- Hardcode keys in source code
- Share screenshots showing keys
- Store keys in unencrypted note files

---

## Verification

Check if your key is loaded:

```bash
# Using .env file
cat .env | grep OPENAI_API_KEY

# Check if environment variable is set
echo $OPENAI_API_KEY

# Test with a demo run
node apps/api/bin/orc.cjs run --mock "test" --template templates/strudel-track.toml
```

---

## Troubleshooting

### "OPENAI_API_KEY is not set" error

**Problem:** The CLI can't find your API key.

**Solutions:**
1. Make sure `.env` exists: `ls -la .env`
2. Make sure `.env` has the key: `cat .env | grep OPENAI_API_KEY`
3. Try running with dotenv-cli: `npx dotenv-cli -- node apps/api/bin/orc.cjs ...`
4. Or export manually: `export OPENAI_API_KEY="..."`

### "Invalid API key" error

**Problem:** Key is wrong or expired.

**Solutions:**
1. Verify key on [OpenAI Platform](https://platform.openai.com/api-keys)
2. Regenerate a new key
3. Check for extra spaces or quotes in `.env`

### Key works in terminal but not in code

**Problem:** Node.js doesn't auto-load `.env` by default.

**Solutions:**
1. Use `dotenv-cli`: `npx dotenv-cli -- node apps/api/bin/orc.cjs ...`
2. Or add to CLI code (see Issue #3 in ISSUES.md)

---

## Recommended Setup for This Project

**I recommend Option 1 (.env file) because:**

1. ✅ Already gitignored
2. ✅ Professional standard
3. ✅ Easy to manage multiple variables
4. ✅ Safe and repeatable
5. ✅ Works in CI/CD

**Quick setup:**

```bash
# 1. Create .env file
cp .env.example .env

# 2. Edit and add your key
nano .env

# 3. Run with dotenv-cli
npx dotenv-cli -- node apps/api/bin/orc.cjs run "Create a cyberpunk track" --template templates/strudel-track.toml
```

---

## Alternative: No API Key Needed (Mock Mode)

For testing without spending money, use mock mode:

```bash
node apps/api/bin/orc.cjs run --mock "test track" --template templates/strudel-track.toml
```

This uses MockAgent (which we just fixed!) and doesn't require an API key.

---

**Last Updated:** 2026-04-21  
**Related Issues:** #3 (Environment Variable Loading)
