# CRM-AI

POC AI Playground.

## Prompt Studio

A small web app for building AI prompt templates for a CRM and running them through Claude.

- **Templates:** write instructions with merge fields like `{{lead_name}}`. Each merge field becomes an input. Output can be text (emails, notes) or structured fields (JSON you could write back to a CRM).
- **Conversations:** upload an exported text, email or chat thread (`.txt`, `.csv` or `.json`, up to 200 KB). A template input set to "Conversation file" reads the whole thread.
- **Run:** fill in the inputs, run on Claude Haiku 5.5, Sonnet 5.5 or Opus 5.5, and read the result. Structured results show as fields, tags and tables, with the raw JSON one click away.

It ships with three example templates (cold-lead email, lead scoring, preference capture) and a sample SMS thread in [`samples/`](samples/sample-sms-thread-marcus-lee.txt). All example people and businesses are made up.

### Running it

It's a static site with no build step and no server.

- **GitHub Pages:** Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`.
- **Locally:** `python3 -m http.server` in this folder, then open http://localhost:8000. (Opening `index.html` straight from disk works too, but the sample conversation only loads over HTTP.)

### API keys and security

Each person enters their own Anthropic API key on the **API key** screen.

- The key is kept in the browser tab (`sessionStorage`) and forgotten when the tab closes. It's saved in `localStorage` only if the person ticks "Remember on this device".
- The key is sent only to `https://api.anthropic.com`, directly from the browser. The page's Content Security Policy blocks every other network destination and every third-party script.
- Nothing is stored on GitHub or any other server. Templates and conversations live in the browser's `localStorage`. **Export workspace** saves them to a JSON file (never including the key), and **Import** loads one back.
- Anyone who can run code in the page can read the key, for example a malicious browser extension. So use a key made just for this tool, set a spending limit on it in the Anthropic Console, and delete it when you're done.

This model suits a proof of concept where each user brings their own key. For a client's production CRM, call Claude from the CRM's server with the key in a server-side secret, so it never reaches a browser.
