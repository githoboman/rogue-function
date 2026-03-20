/**
 * PreloadScene.ts — Loading screen
 * Loads Kenney sprite sheets, shows progress bar, then starts GameScene.
 * Assets loaded here match exactly what GameScene.ts preload() loads.
 */

import Phaser from "phaser";
import { gameWS } from "../ws";

export class PreloadScene extends Phaser.Scene {
  constructor() { super({ key: "PreloadScene" }); }

  preload(): void {
    const { width, height } = this.scale;

    // ── Loading bar ──────────────────────────────────────
    const bg  = this.add.rectangle(width/2, height/2, 320, 24, 0x1a1a2a);
    const bar = this.add.rectangle(width/2 - 158, height/2, 0, 20, 0xc8a84b).setOrigin(0, 0.5);

    this.add.text(width/2, height/2 - 40, "WORLD OF GENESIS", {
      fontSize: "14px", color: "#c8a84b", fontFamily: "Courier New", letterSpacing: 6,
    }).setOrigin(0.5);

    const pctText = this.add.text(width/2, height/2 + 22, "Loading...", {
      fontSize: "9px", color: "#555577", fontFamily: "Courier New",
    }).setOrigin(0.5);

    this.load.on("progress", (v: number) => {
      bar.setSize(Math.round(316 * v), 20);
      pctText.setText(`${Math.round(v * 100)}%`);
    });

    // ── Load Kenney sprite sheets ─────────────────────────
    this.load.spritesheet("chars", "/assets/characters/roguelikeChar_transparent.png", {
      frameWidth: 16, frameHeight: 16, spacing: 1,
    });
    this.load.spritesheet("rpg", "/assets/tiles/roguelikeRPG_transparent.png", {
      frameWidth: 16, frameHeight: 16, spacing: 1,
    });
    // Tiny Town tilemap — 12 cols × 11 rows, 16×16px, 1px spacing
    this.load.spritesheet("town", "/assets/kenney_tiny-town/Tilemap/tilemap_packed.png", {
      frameWidth: 16, frameHeight: 16, spacing: 1,
    });

    // Gracefully handle missing files — GameScene has shape fallbacks
    this.load.on("loaderror", (file: any) => {
      console.warn(`⚠️  Asset not found: ${file.key} (${file.url}) — using placeholders`);
    });
  }

  create(): void {
    // Pass the ws client and starting zone into GameScene
    this.scene.start("GameScene", { ws: gameWS, zone: "human_meadow" });
  }
}
