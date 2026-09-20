# Omniview

A personal design reference tool for collecting and browsing inspiring web and mobile designs.

[image coming soon]

## What it does

Omniview centralizes your scattered design inspiration into one searchable local library. Screenshot a website or mobile app you love, add it to your collection with metadata and style tags, then browse and filter your growing library whenever you need design references.

## Features

- **Capture & Store**: Add screenshots with metadata (source URL, app name, description)
- **Tag by Style**: Organize designs by visual style, pattern, or aesthetic
- **Browse & Search**: Filter your collection to find relevant references fast
- **Project Boards**: Group designs into project-specific boards
- **Local Only**: Everything runs on your machine—no cloud, no accounts, no sharing

## Getting Started

1. Clone the repo and install dependencies:
   ```bash
   npm install
   ```

2. Start the server:
   ```bash
   npm start
   ```

3. Open `http://localhost:3000` in your browser

[screenshot of app interface coming soon]

## How it works

- **Frontend**: Browser-based interface to browse, search, and manage designs
- **Backend**: Express server with file upload and storage
- **Database**: Local JSON-based library of stored designs

[screenshot of library view coming soon]

## Project Structure

```
├── public/           # Frontend (HTML, CSS, JavaScript)
├── db/              # Local database
├── server.js        # Express server
└── package.json     # Dependencies
```

## Single-User Design

Omniview is built for one person on one machine. No multi-user features, no authentication, no deployment—just a personal tool that runs when you need it.

---

Built with Node.js & Express
