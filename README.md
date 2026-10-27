# MapleStory Survivor

A browser survivor game with a MapleStory theme. TypeScript + Vite + PixiJS v8, deployed to GitHub Pages.

This repository holds no Nexon files. A deploy step downloads a GMS v83 client, extracts the sprites,
icons, UI and sound the game lists in `src/maple/*.ts` from its WZ archives, and serves them with the site.
Without them the game falls back to placeholder art.

Non-commercial fan project. MapleStory is a trademark of Nexon.
