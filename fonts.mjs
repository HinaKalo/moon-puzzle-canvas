import { cpSync } from "node:fs";
cpSync("node_modules/@excalidraw/excalidraw/dist/prod/fonts", "public/fonts", { recursive: true });
