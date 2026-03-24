/**
 * GameScene.ts — Phaser 3 Main Game Scene
 * Uses Kenney character sprites with Graphics fallback.
 * Enhanced combat/death/respawn effects.
 */
import Phaser from "phaser";
import type { GameWebSocket, PlayerState } from "../ws";

// ── Visual Config ──────────────────────────────────────────

const CLASS_CONFIG: Record<string, { color: number; accent: number; icon: string; glow: number; charFrame: number }> = {
  Warrior:     { color: 0xdd6644, accent: 0xaa4422, icon: "\u2694", glow: 0xff6633, charFrame: 0 },
  Mage:        { color: 0x7766ee, accent: 0x5544bb, icon: "\u2726", glow: 0x9988ff, charFrame: 109 },
  Ranger:      { color: 0x55bb55, accent: 0x338833, icon: "\u2192", glow: 0x66dd66, charFrame: 54 },
  Cleric:      { color: 0xeebb33, accent: 0xbb8822, icon: "\u271A", glow: 0xffdd44, charFrame: 163 },
  Rogue:       { color: 0xcc5588, accent: 0x993366, icon: "\u2020", glow: 0xee77aa, charFrame: 216 },
  Paladin:     { color: 0x4499ee, accent: 0x2266bb, icon: "\u2666", glow: 0x55aaff, charFrame: 2 },
  Necromancer: { color: 0x9944cc, accent: 0x6622aa, icon: "\u2620", glow: 0xbb66ee, charFrame: 111 },
  Druid:       { color: 0x44bb99, accent: 0x228866, icon: "\u2618", glow: 0x55ddbb, charFrame: 55 },
};

const MOB_CONFIG: Record<string, { color: number; size: number; shape: string }> = {
  giant_rat:      { color: 0x886644, size: 5,  shape: "circle" },
  young_wolf:     { color: 0x8899aa, size: 6,  shape: "circle" },
  wild_boar:      { color: 0x886644, size: 7,  shape: "hex" },
  goblin_scout:   { color: 0x66aa44, size: 6,  shape: "circle" },
  green_slime:    { color: 0x44dd44, size: 6,  shape: "blob" },
  bandit:         { color: 0xaa7744, size: 7,  shape: "hex" },
  alpha_wolf:     { color: 0xbbbbcc, size: 8,  shape: "circle" },
  brown_bear:     { color: 0x885533, size: 10, shape: "hex" },
  giant_spider:   { color: 0x554466, size: 8,  shape: "circle" },
  orc_warrior:    { color: 0x558833, size: 9,  shape: "hex" },
  harpy:          { color: 0x9966aa, size: 7,  shape: "circle" },
  shadow_stalker: { color: 0x334455, size: 8,  shape: "hex" },
  dark_knight:    { color: 0x333344, size: 10, shape: "hex" },
  necromancer:    { color: 0x774499, size: 9,  shape: "circle" },
};

const ZONE_PALETTE: Record<string, { bg: number; grass1: number; grass2: number; grass3: number; detail: number; path: number; pathEdge: number; trees: boolean; tint: number; ambient: number }> = {
  human_meadow: { bg: 0x6ab850, grass1: 0x72b858, grass2: 0x5ea846, grass3: 0x7cc460, detail: 0x88d068, path: 0xd4b87a, pathEdge: 0xb8a060, trees: false, tint: 0xffffff, ambient: 0xfffff0 },
  wild_meadow:  { bg: 0x549840, grass1: 0x5ca448, grass2: 0x4a8a38, grass3: 0x66b050, detail: 0x6aba54, path: 0x9a8a5a, pathEdge: 0x807848, trees: true,  tint: 0xeeffdd, ambient: 0xf0f8e8 },
  dark_forest:  { bg: 0x243038, grass1: 0x2a3840, grass2: 0x1e2a2a, grass3: 0x304444, detail: 0x364848, path: 0x4a4840, pathEdge: 0x3e3e34, trees: true,  tint: 0x7788aa, ambient: 0x99aabb },
};

// Tiny-town tilemap indices (12 cols per row, 16×16px, 1px spacing)
// Row 0 (0-11):  0-3=grass variants, 4-5=green_tree1_top, 6-7=green_tree2_top, 8-9=autumn_tree1_top, 10-11=autumn_tree2_top
// Row 1 (12-23): 12-13=dirt/path, 14-15=grass edge, 16-17=green_tree1_bottom, 18-19=green_tree2_bottom, 20-21=autumn_tree1_bottom, 22-23=autumn_tree2_bottom
// Row 2+ (24+):  buildings, roofs, walls, etc.
const TOWN_TILES = {
  grass: [0, 1, 2, 3],         // grass variants
  grassDark: [2],               // darker grass for forests
  dirtPath: [12, 13],           // dirt/path tiles
  flower: [3],                  // grass with yellow flowers
  // Trees are 2×2 tile combos: [topLeft, topRight, bottomLeft, bottomRight]
  treeGreen1: [4, 5, 16, 17],
  treeGreen2: [6, 7, 18, 19],
  treeAutumn1: [8, 9, 20, 21],
  treeAutumn2: [10, 11, 22, 23],
};

const ZONE_NPCS: Record<string, { x: number; y: number; name: string; role: string; charFrame: number }[]> = {
  human_meadow: [
    { x: 140, y: 180, name: "Farmer John", role: "Quest", charFrame: 108 },
    { x: 340, y: 100, name: "Guard Captain", role: "Quest", charFrame: 2 },
    { x: 250, y: 300, name: "Merchant Gilda", role: "Shop", charFrame: 162 },
  ],
  wild_meadow: [
    { x: 160, y: 200, name: "Ranger Elias", role: "Quest", charFrame: 54 },
    { x: 320, y: 280, name: "Merchant Boris", role: "Shop", charFrame: 108 },
  ],
  dark_forest: [
    { x: 250, y: 250, name: "Dark Oracle", role: "Quest", charFrame: 216 },
  ],
};

const WORLD_SCALE = 2.0;

// ── Interfaces ─────────────────────────────────────────────

interface AgentSprite {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Graphics;
  sprite: Phaser.GameObjects.Image | null;
  hpBar: Phaser.GameObjects.Graphics;
  nameLabel: Phaser.GameObjects.Text;
  levelLabel: Phaser.GameObjects.Text;
  actionLabel: Phaser.GameObjects.Text;
  statusIcon: Phaser.GameObjects.Text;
  cls: string;
  x: number; y: number;
  lastHp: number; lastMaxHp: number;
  isMoving: boolean;
  idleTween: Phaser.Tweens.Tween | null;
  walkTween: Phaser.Tweens.Tween | null;
  currentAction: string;
}

interface MobSprite {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Graphics;
  hpBar: Phaser.GameObjects.Graphics;
  nameLabel: Phaser.GameObjects.Text;
  templateId: string;
}

// ── Utility ────────────────────────────────────────────────

function hexStr(c: number): string {
  return "#" + c.toString(16).padStart(6, "0");
}

// ── Scene ──────────────────────────────────────────────────

export class GameScene extends Phaser.Scene {
  private wsClient!: GameWebSocket;
  private currentZone = "human_meadow";
  private groundLayer!: Phaser.GameObjects.Container;
  private entityLayer!: Phaser.GameObjects.Container;
  private effectLayer!: Phaser.GameObjects.Container;
  private agentSprites = new Map<string, AgentSprite>();
  private mobSprites = new Map<string, MobSprite>();
  private cam!: Phaser.Cameras.Scene2D.Camera;
  private hasCharSprites = false;
  private hasTownTiles = false;

  private readonly W = 1024;
  private readonly H = 720;

  constructor() { super({ key: "GameScene" }); }

  init(data: { ws: GameWebSocket; zone: string }) {
    this.wsClient = data.ws;
    this.currentZone = data.zone || "human_meadow";
  }

  create() {
    this.groundLayer = this.add.container(0, 0).setDepth(0);
    this.entityLayer = this.add.container(0, 0).setDepth(1);
    this.effectLayer = this.add.container(0, 0).setDepth(10);

    // Check which spritesheets loaded successfully
    this.hasCharSprites = this.textures.exists("chars") && this.textures.get("chars").key !== "__MISSING";
    this.hasTownTiles = this.textures.exists("town") && this.textures.get("town").key !== "__MISSING";


    this.cam = this.cameras.main;
    this.cam.setBounds(0, 0, this.W, this.H);

    this.drawGround();
    this.drawProps();
    this.drawNPCs();

    // Zone label — very subtle
    const zoneNames: Record<string, string> = {
      human_meadow: "Human Meadow", wild_meadow: "Wild Meadow", dark_forest: "Dark Forest",
    };
    this.add.text(this.W / 2, 20, zoneNames[this.currentZone] || "", {
      fontSize: "14px", color: "#ffffff", fontFamily: "'Segoe UI', Arial, sans-serif",
      fontStyle: "bold", stroke: "#000000", strokeThickness: 3,
    }).setOrigin(0.5, 0).setDepth(100).setAlpha(0.25);

    // Pan
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!p.isDown) return;
      this.cam.scrollX -= (p.x - p.prevPosition.x) / this.cam.zoom;
      this.cam.scrollY -= (p.y - p.prevPosition.y) / this.cam.zoom;
    });
    // Zoom
    this.input.on("wheel", (_: any, __: any, ___: any, dy: number) => {
      this.cam.setZoom(Phaser.Math.Clamp(this.cam.zoom - dy * 0.001, 0.5, 3));
    });

    this.wireEvents();
  }

  // ── Ground ─────────────────────────────────────────────

  private drawGround() {
    this.groundLayer.removeAll(true);
    const pal = ZONE_PALETTE[this.currentZone] || ZONE_PALETTE.human_meadow;
    const isDark = this.currentZone === "dark_forest";

    // ── Try tile-based ground first (cleanest look) ──────────
    if (this.hasTownTiles) {
      this.drawTileGround(pal, isDark);
    } else {
      this.drawGraphicsGround(pal, isDark);
    }

    // Trees on top
    if (pal.trees) {
      this.drawTrees(pal);
    }

    // Human meadow gets some trees at edges too (lighter coverage)
    if (this.currentZone === "human_meadow") {
      this.drawTrees({ ...pal, trees: true });
    }
  }

  /** Clean tile-based ground using Kenney Tiny Town tiles */
  private drawTileGround(pal: typeof ZONE_PALETTE["human_meadow"], isDark: boolean) {
    const tileScale = 2.5;
    const ts = 16 * tileScale; // 40px per tile
    const cols = Math.ceil(this.W / ts) + 1;
    const rows = Math.ceil(this.H / ts) + 1;
    const grassTiles = isDark ? TOWN_TILES.grassDark : TOWN_TILES.grass;

    // Lay tile grid
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows; row++) {
        const frame = grassTiles[Phaser.Math.Between(0, grassTiles.length - 1)];
        const img = this.add.image(col * ts, row * ts, "town", frame)
          .setScale(tileScale)
          .setTint(pal.tint);
        this.groundLayer.add(img);
      }
    }

    // ── Dirt path — smooth curved path using path tiles ──────
    const pathTiles = TOWN_TILES.dirtPath;
    const pathY = this.H * 0.45;
    for (let px = -ts; px < this.W + ts; px += ts * 0.7) {
      const py = pathY + Math.sin(px * 0.005) * 70 + Math.sin(px * 0.015) * 25;
      // Main path (2 tiles wide)
      for (let row = -1; row <= 1; row++) {
        const frame = pathTiles[Phaser.Math.Between(0, pathTiles.length - 1)];
        const img = this.add.image(px, py + row * ts * 0.6, "town", frame)
          .setScale(tileScale)
          .setTint(pal.tint)
          .setAlpha(row === 0 ? 0.9 : 0.5);
        this.groundLayer.add(img);
      }
    }

    // ── Second smaller path (branching) ──────────────────────
    if (!isDark) {
      const branchX = this.W * 0.35;
      for (let py = pathY; py < this.H - 40; py += ts * 0.7) {
        const px = branchX + Math.sin(py * 0.01) * 30;
        const frame = pathTiles[Phaser.Math.Between(0, pathTiles.length - 1)];
        this.groundLayer.add(
          this.add.image(px, py, "town", frame).setScale(tileScale).setTint(pal.tint).setAlpha(0.6)
        );
      }
    }

    // ── Flower patches (meadows) ─────────────────────────────
    if (!isDark && TOWN_TILES.flower.length > 0) {
      const clusters = this.currentZone === "human_meadow" ? 8 : 4;
      for (let c = 0; c < clusters; c++) {
        const cx = Phaser.Math.Between(60, this.W - 60);
        const cy = Phaser.Math.Between(60, this.H - 60);
        for (let f = 0; f < Phaser.Math.Between(3, 6); f++) {
          const fx = cx + Phaser.Math.Between(-30, 30);
          const fy = cy + Phaser.Math.Between(-20, 20);
          this.groundLayer.add(
            this.add.image(fx, fy, "town", TOWN_TILES.flower[0]).setScale(tileScale).setTint(pal.tint).setAlpha(0.7)
          );
        }
      }
    }

    // ── Overlay: subtle ambient color wash for atmosphere ─────
    const overlay = this.add.graphics();
    overlay.fillStyle(pal.bg, 0.08);
    overlay.fillRect(0, 0, this.W, this.H);
    this.groundLayer.add(overlay);
  }

  /** Fallback: graphics-only ground (no spritesheets available) */
  private drawGraphicsGround(pal: typeof ZONE_PALETTE["human_meadow"], isDark: boolean) {
    const rt = this.add.renderTexture(0, 0, this.W, this.H).setOrigin(0, 0);
    const g = this.make.graphics({ x: 0, y: 0 });

    // Clean base fill — larger tiles, less noise
    const ts = 32;
    const grassColors = [pal.bg, pal.grass1, pal.grass2, pal.grass3];
    for (let x = 0; x < this.W; x += ts) {
      for (let y = 0; y < this.H; y += ts) {
        // Use a deterministic-ish pattern so it doesn't look like TV static
        const idx = ((x * 7 + y * 13) >> 4) % grassColors.length;
        g.fillStyle(grassColors[idx], 1);
        g.fillRect(x, y, ts, ts);
      }
    }

    // Smooth dirt path — drawn as overlapping circles for organic shape
    const pathY = this.H * 0.45;
    for (let px = 0; px < this.W; px += 6) {
      const py = pathY + Math.sin(px * 0.005) * 70 + Math.sin(px * 0.015) * 25;
      // Path edge (wider, darker)
      g.fillStyle(pal.pathEdge, 0.4);
      g.fillCircle(px, py, 18);
      // Path center (lighter)
      g.fillStyle(pal.path, 0.5);
      g.fillCircle(px, py, 13);
      // Highlight center
      g.fillStyle(pal.path, 0.25);
      g.fillCircle(px, py - 2, 8);
    }

    // Grass highlight patches — organic blobs, not tiny dots
    const numPatches = isDark ? 15 : 40;
    for (let i = 0; i < numPatches; i++) {
      const px = Phaser.Math.Between(20, this.W - 20);
      const py = Phaser.Math.Between(20, this.H - 20);
      const size = Phaser.Math.Between(8, 20);
      g.fillStyle(pal.detail, 0.15);
      g.fillEllipse(px, py, size * 2, size * 1.2);
    }

    // Flower clusters (meadows) — grouped, not scattered randomly
    if (!isDark) {
      const flowerColors = [0xf0e050, 0xe8c040, 0xffffff, 0xf0a0a0, 0xa0d0f0];
      const clusters = this.currentZone === "human_meadow" ? 10 : 5;
      for (let c = 0; c < clusters; c++) {
        const cx = Phaser.Math.Between(40, this.W - 40);
        const cy = Phaser.Math.Between(40, this.H - 40);
        const clusterSize = Phaser.Math.Between(4, 8);
        for (let f = 0; f < clusterSize; f++) {
          const fx = cx + Phaser.Math.Between(-15, 15);
          const fy = cy + Phaser.Math.Between(-10, 10);
          g.fillStyle(flowerColors[Phaser.Math.Between(0, flowerColors.length - 1)], 0.7);
          g.fillCircle(fx, fy, Phaser.Math.Between(1, 2.5));
        }
      }
    }

    // Dark forest: fog patches
    if (isDark) {
      for (let i = 0; i < 8; i++) {
        const fx = Phaser.Math.Between(0, this.W);
        const fy = Phaser.Math.Between(0, this.H);
        g.fillStyle(0x334455, 0.06);
        g.fillEllipse(fx, fy, Phaser.Math.Between(80, 200), Phaser.Math.Between(40, 80));
      }
    }

    rt.draw(g);
    g.destroy();
    this.groundLayer.add(rt);
  }

  /** Draw trees — uses tile sprites if available, graphics fallback */
  private drawTrees(pal: typeof ZONE_PALETTE["human_meadow"]) {
    const numTrees = this.currentZone === "dark_forest" ? 28
      : this.currentZone === "human_meadow" ? 8 : 16;

    if (this.hasTownTiles) {
      // Tile-based trees: 2×2 combos from Kenney Tiny Town
      const tileScale = 2;
      const ts = 16 * tileScale;
      const half = ts / 2;
      const treeSets = this.currentZone === "dark_forest"
        ? [TOWN_TILES.treeAutumn1, TOWN_TILES.treeAutumn2]
        : [TOWN_TILES.treeGreen1, TOWN_TILES.treeGreen2];

      for (let i = 0; i < numTrees; i++) {
        const tx = Phaser.Math.Between(ts * 2, this.W - ts * 2);
        const ty = this.treeY(i, numTrees);
        const tree = treeSets[Phaser.Math.Between(0, treeSets.length - 1)];
        const [tl, tr, bl, br] = tree;
        this.groundLayer.add(this.add.image(tx - half, ty - half, "town", tl).setScale(tileScale).setTint(pal.tint));
        this.groundLayer.add(this.add.image(tx + half, ty - half, "town", tr).setScale(tileScale).setTint(pal.tint));
        this.groundLayer.add(this.add.image(tx - half, ty + half, "town", bl).setScale(tileScale).setTint(pal.tint));
        this.groundLayer.add(this.add.image(tx + half, ty + half, "town", br).setScale(tileScale).setTint(pal.tint));
      }
    } else {
      // Graphics fallback trees
      for (let i = 0; i < numTrees; i++) {
        const tx = Phaser.Math.Between(20, this.W - 20);
        const ty = this.treeY(i, numTrees);
        const tg = this.add.graphics();
        const isDark = this.currentZone === "dark_forest";
        // Trunk
        tg.fillStyle(isDark ? 0x2a2220 : 0x5a4430, 0.8);
        tg.fillRect(tx - 2, ty, 4, 12);
        // Canopy
        tg.fillStyle(isDark ? 0x1a2a1a : 0x3a6a2a, 0.7);
        tg.fillTriangle(tx, ty - 14, tx - 10, ty + 2, tx + 10, ty + 2);
        tg.fillTriangle(tx, ty - 20, tx - 8, ty - 6, tx + 8, ty - 6);
        this.groundLayer.add(tg);
      }
    }
  }

  /** Distribute trees — edges + scattered center */
  private treeY(i: number, total: number): number {
    if (i < total * 0.3) return Phaser.Math.Between(20, 100);
    if (i < total * 0.6) return Phaser.Math.Between(this.H - 100, this.H - 20);
    return Phaser.Math.Between(100, this.H - 100);
  }

  // ── Props (environment decorations using RPG spritesheet) ──

  private drawProps() {
    const isDark = this.currentZone === "dark_forest";
    const isWild = this.currentZone === "wild_meadow";

    // ── Rocks — varying sizes with highlight ─────────────────
    const numRocks = isDark ? 15 : 8;
    for (let i = 0; i < numRocks; i++) {
      const rx = Phaser.Math.Between(40, this.W - 40);
      const ry = Phaser.Math.Between(40, this.H - 40);
      const w = Phaser.Math.Between(6, 14);
      const h = Math.floor(w * 0.65);
      const g = this.add.graphics();
      // Shadow
      g.fillStyle(0x000000, 0.12);
      g.fillEllipse(rx + 1, ry + h * 0.4, w + 2, h * 0.5);
      // Body
      g.fillStyle(isDark ? 0x3a3a44 : 0x889988, 0.85);
      g.fillEllipse(rx, ry, w, h);
      // Highlight
      g.fillStyle(0xffffff, 0.12);
      g.fillEllipse(rx - w * 0.15, ry - h * 0.2, w * 0.5, h * 0.35);
      this.groundLayer.add(g);
    }

    // ── Grass tufts — 3-blade clusters ───────────────────────
    const numTufts = isDark ? 10 : 30;
    const grassColor = isDark ? 0x2a4030 : isWild ? 0x5aaa40 : 0x6cc050;
    for (let i = 0; i < numTufts; i++) {
      const tx = Phaser.Math.Between(20, this.W - 20);
      const ty = Phaser.Math.Between(20, this.H - 20);
      const g = this.add.graphics();
      const blades = Phaser.Math.Between(2, 4);
      for (let j = 0; j < blades; j++) {
        const ox = (j - blades / 2) * 2.5;
        const h = Phaser.Math.Between(5, 10);
        const lean = Phaser.Math.Between(-3, 3);
        g.lineStyle(1.2, grassColor, 0.55);
        g.lineBetween(tx + ox, ty, tx + ox + lean, ty - h);
      }
      this.groundLayer.add(g);
    }

    // ── Mushrooms (wild + dark only) ─────────────────────────
    if (!this.currentZone.includes("human")) {
      const numShrooms = isDark ? 10 : 5;
      const capColors = isDark
        ? [0x7744aa, 0x5544aa, 0x445588]
        : [0xcc7744, 0xddaa55, 0xbb5544];
      for (let i = 0; i < numShrooms; i++) {
        const mx = Phaser.Math.Between(30, this.W - 30);
        const my = Phaser.Math.Between(30, this.H - 30);
        const g = this.add.graphics();
        const sz = Phaser.Math.Between(2, 4);
        // Stem
        g.fillStyle(isDark ? 0x555560 : 0xddccbb, 0.85);
        g.fillRect(mx - 1, my, 2, sz + 2);
        // Cap
        g.fillStyle(capColors[Phaser.Math.Between(0, capColors.length - 1)], 0.85);
        g.fillEllipse(mx, my - 1, sz * 2.5, sz * 1.4);
        // Spots
        g.fillStyle(0xffffff, 0.35);
        g.fillCircle(mx - 1, my - 2, 0.8);
        g.fillCircle(mx + 1.5, my - 1, 0.6);
        this.groundLayer.add(g);
      }
    }

    // ── Puddles / swamp patches (dark forest) ────────────────
    if (isDark) {
      for (let i = 0; i < 6; i++) {
        const px = Phaser.Math.Between(50, this.W - 50);
        const py = Phaser.Math.Between(50, this.H - 50);
        const w = Phaser.Math.Between(16, 30);
        const h = Math.floor(w * 0.5);
        const g = this.add.graphics();
        g.fillStyle(0x1a2a3a, 0.35);
        g.fillEllipse(px, py, w, h);
        // Reflection highlight
        g.fillStyle(0x445566, 0.12);
        g.fillEllipse(px + 2, py - 2, w * 0.4, h * 0.3);
        this.groundLayer.add(g);
      }
    }

    // ── Fence (human meadow — village boundary) ──────────────
    if (this.currentZone === "human_meadow") {
      const fenceY = this.H - 50;
      const g = this.add.graphics();
      // Horizontal rail
      g.lineStyle(2, 0x6a5438, 0.6);
      g.lineBetween(60, fenceY - 3, 360, fenceY - 3);
      g.lineBetween(60, fenceY + 3, 360, fenceY + 3);
      // Posts
      for (let i = 0; i < 7; i++) {
        const fx = 60 + i * 50;
        g.fillStyle(0x5a4430, 0.75);
        g.fillRect(fx - 2, fenceY - 8, 4, 16);
        // Post cap
        g.fillStyle(0x7a6448, 0.6);
        g.fillRect(fx - 3, fenceY - 9, 6, 2);
      }
      this.groundLayer.add(g);
    }

    // ── Lily pads (wild meadow water areas) ──────────────────
    if (isWild) {
      for (let i = 0; i < 4; i++) {
        const lx = Phaser.Math.Between(50, this.W - 50);
        const ly = Phaser.Math.Between(50, this.H - 50);
        const g = this.add.graphics();
        // Small pond
        g.fillStyle(0x2a5a6a, 0.2);
        g.fillEllipse(lx, ly, 24, 14);
        // Lily pads on pond
        for (let p = 0; p < 3; p++) {
          const px = lx + Phaser.Math.Between(-8, 8);
          const py = ly + Phaser.Math.Between(-4, 4);
          g.fillStyle(0x44aa44, 0.5);
          g.fillCircle(px, py, 3);
          g.lineStyle(0.5, 0x338833, 0.4);
          g.lineBetween(px, py, px + 3, py); // leaf split line
        }
        this.groundLayer.add(g);
      }
    }
  }

  // ── NPCs ───────────────────────────────────────────────

  private drawNPCs() {
    (this.entityLayer.list as Phaser.GameObjects.GameObject[])
      .filter((o: any) => o.getData?.("isNPC"))
      .forEach((o: any) => o.destroy());

    for (const npc of ZONE_NPCS[this.currentZone] || []) {
      const wx = npc.x * WORLD_SCALE;
      const wy = npc.y * WORLD_SCALE;
      const c = this.add.container(wx, wy).setData("isNPC", true);

      // Soft glow under NPC
      const glowColor = npc.role === "Shop" ? 0xffdd44 : 0x4488ff;
      c.add(this.add.circle(0, 2, 16, glowColor, 0.10));
      c.add(this.add.ellipse(0, 14, 20, 6, 0x000000, 0.25)); // shadow

      // NPC body — sprite or fallback
      if (this.hasCharSprites) {
        const npcSprite = this.add.image(0, -2, "chars", npc.charFrame).setScale(2);
        c.add(npcSprite);
        // Gentle idle bob
        this.tweens.add({
          targets: npcSprite, y: -4, duration: 1500, yoyo: true, repeat: -1, ease: "Sine.easeInOut",
        });
      } else {
        const g = this.add.graphics();
        g.fillStyle(0x3366aa, 1);
        g.fillRoundedRect(-6, -8, 12, 16, 3);
        g.fillStyle(0xddccaa, 1);
        g.fillCircle(0, -11, 5);
        c.add(g);
      }

      // Quest/Shop marker
      const markerColor = npc.role === "Shop" ? "#ffdd44" : "#ffaa33";
      const marker = npc.role === "Shop" ? "$" : "!";
      const markerText = this.add.text(0, -24, marker, {
        fontSize: "12px", color: markerColor, fontFamily: "Arial",
        fontStyle: "bold", stroke: "#000000", strokeThickness: 3,
      }).setOrigin(0.5);
      c.add(markerText);

      this.tweens.add({
        targets: markerText, y: -28, duration: 1000, yoyo: true, repeat: -1, ease: "Sine.easeInOut",
      });

      // Name plate
      c.add(this.add.text(0, 16, npc.name, {
        fontSize: "8px", color: npc.role === "Shop" ? "#ffeeaa" : "#88bbee",
        fontFamily: "'Segoe UI', Arial, sans-serif",
        stroke: "#000000", strokeThickness: 2,
      }).setOrigin(0.5, 0));

      // Role tag
      c.add(this.add.text(0, 25, `[${npc.role}]`, {
        fontSize: "7px", color: "#555577",
        fontFamily: "'Segoe UI', Arial, sans-serif",
        stroke: "#000000", strokeThickness: 2,
      }).setOrigin(0.5, 0));

      this.entityLayer.add(c);
    }
  }

  // ── Events ─────────────────────────────────────────────

  private wireEvents() {
    this.wsClient.on("combat_hit", (e: any) => {
      const s = this.agentSprites.get(e.playerId);
      if (s) {
        const m = this.mobSprites.get(e.mobId);
        if (m) {
          // Lunge toward mob then bounce back
          const origX = s.container.x;
          const origY = s.container.y;
          const dx = m.container.x - origX;
          const dy = m.container.y - origY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          // Stop 18px away from mob center
          const lungeX = dist > 20 ? m.container.x - (dx / dist) * 18 : origX + dx * 0.5;
          const lungeY = dist > 20 ? m.container.y - (dy / dist) * 18 : origY + dy * 0.5;

          this.tweens.add({
            targets: s.container, x: lungeX, y: lungeY,
            duration: 120, ease: "Power2",
            onComplete: () => {
              // Slash + damage popup at mob position
              this.slashEffect(s.container.x, s.container.y, m.container.x, m.container.y);
              this.dmgPopup(m.container.x, m.container.y - 16, e.damage, e.crit);
              // Mob recoil
              const recoilX = m.container.x + (dx / dist) * 4;
              const recoilY = m.container.y + (dy / dist) * 4;
              this.tweens.add({ targets: m.container, x: recoilX, y: recoilY, duration: 60, yoyo: true });
              // Flash mob red on hit
              if (m.body) this.tweens.add({ targets: m.body, alpha: 0.4, duration: 60, yoyo: true });
              // Bounce agent back
              this.tweens.add({
                targets: s.container, x: origX, y: origY,
                duration: 200, ease: "Back.easeOut",
              });
            },
          });
        } else {
          // No mob found — just show popup at agent
          this.dmgPopup(s.container.x, s.container.y - 28, e.damage, e.crit);
        }
        // Screen shake on crit
        if (e.crit) this.cam.shake(150, 0.004);
        // Flash agent on hit
        this.tweens.add({ targets: s.container, alpha: 0.6, duration: 60, yoyo: true });
      }
    });

    this.wsClient.on("mob_died", (e: any) => {
      const m = this.mobSprites.get(e.mobId);
      if (m) {
        const mx = m.container.x, my = m.container.y;
        // Death burst particles
        this.deathBurst(mx, my, MOB_CONFIG[m.templateId]?.color || 0xaa5533);
        // Shrink + fade
        this.tweens.add({
          targets: m.container, alpha: 0, scaleX: 0.2, scaleY: 0.2,
          duration: 400, ease: "Back.easeIn",
          onComplete: () => { m.container.destroy(); this.mobSprites.delete(e.mobId); },
        });
        this.floatText(mx, my, `+${e.xpGained}xp +${e.goldDropped}g`, "#88cc44");
      }
    });

    this.wsClient.on("player_levelup", (e: any) => {
      const s = this.agentSprites.get(e.playerId);
      if (s) { this.levelUpFx(s.container.x, s.container.y); s.levelLabel.setText(`Lv${e.newLevel}`); }
    });

    this.wsClient.on("player_died", (e: any) => {
      const s = this.agentSprites.get(e.playerId);
      if (s) this.playerDeathFx(s);
    });

    this.wsClient.on("zone_transition", (e: any) => {
      const s = this.agentSprites.get(e.playerId);
      if (s && e.fromZone === this.currentZone) {
        this.tweens.add({ targets: s.container, alpha: 0, duration: 300 });
      }
    });
  }

  // ── Agent Sprites ──────────────────────────────────────

  public upsertAgent(playerId: string, state: PlayerState, name: string, cls: string) {
    if (state.zone !== this.currentZone) {
      this.agentSprites.get(playerId)?.container.setVisible(false);
      return;
    }

    let s = this.agentSprites.get(playerId);
    if (!s) {
      s = this.mkAgent(name, cls);
      this.agentSprites.set(playerId, s);
      this.entityLayer.add(s.container);
    }

    s.container.setVisible(true);
    if (s.container.alpha < 0.9) s.container.setAlpha(1);

    const tx = state.position.x * WORLD_SCALE;
    const ty = state.position.y * WORLD_SCALE;
    const dx = tx - s.x;
    const dy = ty - s.y;
    const moved = Math.abs(dx) > 2 || Math.abs(dy) > 2;

    // Flip sprite to face movement direction
    if (Math.abs(dx) > 4) {
      const target = s.sprite || s.body;
      target.setScale(dx < 0 ? -Math.abs(target.scaleX) : Math.abs(target.scaleX), target.scaleY);
    }

    if (moved) {
      // Walking — bounce up/down while moving
      if (!s.isMoving) {
        s.isMoving = true;
        s.idleTween?.pause();
        s.walkTween?.remove();
        s.walkTween = this.tweens.add({
          targets: s.sprite || s.body,
          y: (s.sprite ? -2 : 0) - 3,
          duration: 100, yoyo: true, repeat: -1, ease: "Sine.easeInOut",
        });
      }

      // Dust particles while walking
      this.spawnDust(s.container.x, s.container.y + 12);

      this.tweens.add({
        targets: s.container, x: tx, y: ty,
        duration: 400, ease: "Sine.easeInOut",
        onComplete: () => {
          // Stop walk, resume idle
          s!.isMoving = false;
          s!.walkTween?.remove();
          s!.walkTween = null;
          const target = s!.sprite || s!.body;
          // Reset to base y
          target.y = s!.sprite ? -2 : 0;
          s!.idleTween?.resume();
        },
      });
    }
    s.x = tx; s.y = ty;

    if (state.health !== s.lastHp || state.maxHealth !== s.lastMaxHp) {
      s.lastHp = state.health; s.lastMaxHp = state.maxHealth;
      this.drawHpBar(s.hpBar, state.health, state.maxHealth, 28, -20);
    }
    s.levelLabel.setText(`Lv${state.level}`);
  }

  /** Show a status icon above the agent (sword, scroll, boot, etc) */
  public showAgentStatus(playerId: string, action: string, target?: string) {
    const s = this.agentSprites.get(playerId);
    if (!s) return;

    // Map action to icon
    const ICONS: Record<string, string> = {
      attack: "\u2694\uFE0F", move: "\u{1F97E}", quest_accept: "\u{1F4DC}",
      quest_complete: "\u2705", rest: "\u{1F4A4}", use_item: "\u{1F9EA}",
      idle: "\u{1F4AD}", zone_move: "\u{1F6B6}",
    };
    const icon = ICONS[action] || "\u{1F4AD}";

    // Only update if action changed
    if (s.currentAction === action) return;
    s.currentAction = action;

    // Show icon with pop animation
    s.statusIcon.setText(icon);
    s.statusIcon.setAlpha(1);
    s.statusIcon.setScale(0.3);
    this.tweens.add({
      targets: s.statusIcon, scaleX: 1, scaleY: 1, duration: 200, ease: "Back.easeOut",
    });
    // Gentle float
    this.tweens.add({
      targets: s.statusIcon, y: -42, duration: 800, yoyo: true, repeat: 0, ease: "Sine.easeInOut",
    });

    // Fade out after 2s
    this.time.delayedCall(2000, () => {
      if (s.currentAction === action) {
        this.tweens.add({ targets: s.statusIcon, alpha: 0, duration: 400 });
      }
    });

    // Show action text below agent
    if (target) {
      s.actionLabel.setText(`${action} ${target}`.slice(0, 28));
      s.actionLabel.setAlpha(1);
      this.tweens.add({
        targets: s.actionLabel, alpha: 0, duration: 400, delay: 2500,
      });
    }
  }

  /** Spawn small dust puffs when agent walks */
  private spawnDust(x: number, y: number) {
    for (let i = 0; i < 2; i++) {
      const dust = this.add.circle(
        x + Phaser.Math.Between(-6, 6),
        y + Phaser.Math.Between(-2, 2),
        Phaser.Math.Between(1, 2),
        0xbbaa88, 0.4,
      ).setDepth(0);
      this.effectLayer.add(dust);
      this.tweens.add({
        targets: dust,
        y: y - Phaser.Math.Between(4, 10),
        alpha: 0, scaleX: 2, scaleY: 2,
        duration: Phaser.Math.Between(300, 500),
        onComplete: () => dust.destroy(),
      });
    }
  }

  private mkAgent(name: string, cls: string): AgentSprite {
    const cfg = CLASS_CONFIG[cls] || CLASS_CONFIG.Warrior;
    const c = this.add.container(100, 100);

    // Ground shadow
    c.add(this.add.ellipse(0, 14, 18, 6, 0x000000, 0.3));

    // Class glow (subtle halo)
    c.add(this.add.circle(0, 0, 16, cfg.glow, 0.06));

    // Try to use sprite, fallback to graphics
    let sprite: Phaser.GameObjects.Image | null = null;
    const body = this.add.graphics();

    if (this.hasCharSprites) {
      try {
        sprite = this.add.image(0, -2, "chars", cfg.charFrame).setScale(1.5);
        // Tint with class color for variety
        sprite.setTint(cfg.color);
        c.add(sprite);
      } catch {
        sprite = null;
      }
    }

    if (!sprite) {
      // Fallback: draw character with graphics
      body.fillStyle(cfg.accent, 1);
      body.fillRect(-4, 4, 3, 8);
      body.fillRect(1, 4, 3, 8);
      body.fillStyle(cfg.color, 1);
      body.fillRoundedRect(-7, -6, 14, 12, 2);
      body.fillStyle(0xffffff, 0.12);
      body.fillRoundedRect(-6, -5, 12, 4, 1);
      body.fillStyle(0xeeddcc, 1);
      body.fillCircle(0, -10, 5);
      body.fillStyle(0x222222, 1);
      body.fillCircle(-2, -11, 1);
      body.fillCircle(2, -11, 1);
      body.fillStyle(cfg.color, 0.7);
      body.fillRect(-4, -15, 8, 3);
      c.add(body);

      // Class icon on chest
      c.add(this.add.text(0, -1, cfg.icon, {
        fontSize: "8px", color: hexStr(cfg.glow), fontFamily: "Arial",
      }).setOrigin(0.5).setAlpha(0.9));
    }

    // HP bar
    const hpBar = this.add.graphics();
    c.add(hpBar);
    this.drawHpBar(hpBar, 100, 100, 28, -20);

    // Name
    const nameLabel = this.add.text(0, -28, name, {
      fontSize: "9px", color: "#ffffff", fontFamily: "'Segoe UI', Arial, sans-serif",
      fontStyle: "bold", stroke: "#000000", strokeThickness: 4,
    }).setOrigin(0.5, 1);
    c.add(nameLabel);

    // Level badge
    const levelLabel = this.add.text(18, -20, "Lv1", {
      fontSize: "7px", color: "#ddaa33", fontFamily: "Arial",
      stroke: "#000000", strokeThickness: 2,
    }).setOrigin(0, 0.5);
    c.add(levelLabel);

    // Action text
    const actionLabel = this.add.text(0, 22, "", {
      fontSize: "7px", color: "#556677", fontFamily: "Arial",
      stroke: "#000000", strokeThickness: 2,
    }).setOrigin(0.5, 0);
    c.add(actionLabel);

    // Status icon (shows what agent is doing — sword, scroll, boot, zzz)
    const statusIcon = this.add.text(0, -38, "", {
      fontSize: "14px", color: "#ffffff", fontFamily: "Arial",
      stroke: "#000000", strokeThickness: 3,
    }).setOrigin(0.5, 1).setAlpha(0);
    c.add(statusIcon);

    // Click to follow
    const hit = this.add.rectangle(0, 0, 28, 36, 0xffffff, 0).setInteractive();
    c.add(hit);
    hit.on("pointerdown", () => this.cam.startFollow(c, true, 0.08, 0.08));

    // Start idle breathing animation
    const idleTween = this.tweens.add({
      targets: sprite || body,
      scaleY: sprite ? 1.55 : 1.04,
      scaleX: sprite ? 1.48 : 0.97,
      duration: 1200,
      yoyo: true, repeat: -1, ease: "Sine.easeInOut",
    });

    return {
      container: c, body, sprite, hpBar, nameLabel, levelLabel, actionLabel, statusIcon,
      cls, x: 100, y: 100, lastHp: 100, lastMaxHp: 100,
      isMoving: false, idleTween, walkTween: null, currentAction: "",
    };
  }

  // ── Mob Sprites ────────────────────────────────────────

  public upsertMob(mobId: string, mob: any, zoneId?: string) {
    if (zoneId && zoneId !== this.currentZone) return;
    if (this.mobSprites.has(mobId)) return;

    const mx = (mob.x ?? mob.position?.x ?? 100) * WORLD_SCALE;
    const my = (mob.y ?? mob.position?.y ?? 100) * WORLD_SCALE;
    const c = this.add.container(mx, my);
    const tid = mob.templateId || "giant_rat";
    const cfg = MOB_CONFIG[tid] || { color: 0xaa5533, size: 6, shape: "circle" };

    // Shadow
    c.add(this.add.ellipse(0, cfg.size + 2, cfg.size * 1.4, 4, 0x000000, 0.25));

    // Threat indicator ring
    c.add(this.add.circle(0, 0, cfg.size + 3, 0xff2200, 0.05));

    // Body
    const body = this.add.graphics();
    if (cfg.shape === "blob") {
      body.fillStyle(cfg.color, 0.85);
      body.fillCircle(0, 1, cfg.size);
      body.fillStyle(0xffffff, 0.2);
      body.fillCircle(-2, -2, cfg.size * 0.4);
      body.fillStyle(0x222222, 1);
      body.fillCircle(-2, -1, 1.5);
      body.fillCircle(2, -1, 1.5);
    } else if (cfg.shape === "hex") {
      const s = cfg.size;
      body.fillStyle(cfg.color, 1);
      const pts = [];
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        pts.push(new Phaser.Math.Vector2(Math.cos(a) * s, Math.sin(a) * s));
      }
      body.fillPoints(pts, true);
      body.lineStyle(1.5, 0x000000, 0.3);
      body.strokePoints(pts, true);
      body.fillStyle(0xffffff, 0.1);
      body.fillCircle(0, -2, s * 0.5);
      body.fillStyle(0xff3322, 1);
      body.fillCircle(-2, -1, 1.2);
      body.fillCircle(2, -1, 1.2);
    } else {
      body.fillStyle(cfg.color, 1);
      body.fillCircle(0, 0, cfg.size);
      body.lineStyle(1, 0x000000, 0.2);
      body.strokeCircle(0, 0, cfg.size);
      body.fillStyle(0xffffff, 0.12);
      body.fillCircle(-1, -2, cfg.size * 0.4);
      body.fillStyle(0xffcc00, 1);
      body.fillCircle(-2, -1, 1.2);
      body.fillCircle(2, -1, 1.2);
    }
    c.add(body);

    // Idle breathing animation
    this.tweens.add({
      targets: body, scaleY: 1.06, duration: 800 + Phaser.Math.Between(0, 400),
      yoyo: true, repeat: -1, ease: "Sine.easeInOut",
    });

    // HP bar
    const hpBar = this.add.graphics();
    c.add(hpBar);
    this.drawHpBar(hpBar, mob.hp ?? mob.maxHp ?? 10, mob.maxHp ?? 10, cfg.size * 2.5, -(cfg.size + 4), true);

    // Name
    const nameLabel = this.add.text(0, cfg.size + 6, mob.name || "?", {
      fontSize: "8px", color: "#ee9966", fontFamily: "'Segoe UI', Arial, sans-serif",
      fontStyle: "bold", stroke: "#000000", strokeThickness: 3,
    }).setOrigin(0.5, 0);
    c.add(nameLabel);

    this.entityLayer.add(c);
    this.mobSprites.set(mobId, { container: c, body, hpBar, nameLabel, templateId: tid });

    // Fade in
    c.setAlpha(0);
    this.tweens.add({ targets: c, alpha: 1, duration: 400, ease: "Power2" });
  }

  // ── HP Bar ─────────────────────────────────────────────

  private drawHpBar(g: Phaser.GameObjects.Graphics, hp: number, maxHp: number, width: number, yOff: number, isMob = false) {
    g.clear();
    const pct = Math.max(0, Math.min(1, hp / maxHp));
    const h = isMob ? 2 : 3;

    g.fillStyle(0x000000, 0.5);
    g.fillRoundedRect(-width / 2 - 1, yOff - 1, width + 2, h + 2, 1);
    g.fillStyle(0x1a1a1a, 0.8);
    g.fillRoundedRect(-width / 2, yOff, width, h, 1);

    const fillColor = isMob ? 0xcc3322 :
      pct < 0.3 ? 0xff3333 : pct < 0.6 ? 0xffaa22 : 0x44cc55;
    if (pct > 0) {
      g.fillStyle(fillColor, 1);
      g.fillRoundedRect(-width / 2, yOff, Math.max(2, width * pct), h, 1);
    }
  }

  // ── Effects ────────────────────────────────────────────

  private dmgPopup(x: number, y: number, dmg: number, crit: boolean) {
    const offsetX = Phaser.Math.Between(-12, 12);
    const t = this.add.text(x + offsetX, y, crit ? `${dmg}!` : `-${dmg}`, {
      fontSize: crit ? "18px" : "13px", color: crit ? "#ffdd22" : "#ff4444",
      fontFamily: "Arial", fontStyle: "bold", stroke: "#000000", strokeThickness: crit ? 4 : 3,
    }).setOrigin(0.5).setDepth(11);
    this.effectLayer.add(t);

    // Crit numbers bounce up higher and scale
    if (crit) {
      this.tweens.add({
        targets: t, y: y - 50, alpha: 0, scaleX: 1.3, scaleY: 1.3,
        duration: 1100, ease: "Power2", onComplete: () => t.destroy(),
      });
    } else {
      this.tweens.add({
        targets: t, y: y - 30, alpha: 0, duration: 800, ease: "Power2",
        onComplete: () => t.destroy(),
      });
    }
  }

  private slashEffect(fromX: number, fromY: number, toX: number, toY: number) {
    const g = this.add.graphics().setDepth(11);
    const angle = Math.atan2(toY - fromY, toX - fromX);

    // Slash appears AT the target mob
    const hitX = toX;
    const hitY = toY;

    // Draw 3-line slash burst at impact point
    const slashLen = 16;
    const perpAngle = angle + Math.PI / 2;

    // Main slash — thick white
    g.lineStyle(3, 0xffffff, 0.9);
    g.lineBetween(
      hitX + Math.cos(perpAngle) * slashLen,
      hitY + Math.sin(perpAngle) * slashLen,
      hitX - Math.cos(perpAngle) * slashLen,
      hitY - Math.sin(perpAngle) * slashLen,
    );
    // Cross slash — golden
    g.lineStyle(2, 0xffdd44, 0.7);
    g.lineBetween(
      hitX + Math.cos(perpAngle + 0.5) * slashLen * 0.9,
      hitY + Math.sin(perpAngle + 0.5) * slashLen * 0.9,
      hitX - Math.cos(perpAngle + 0.5) * slashLen * 0.9,
      hitY - Math.sin(perpAngle + 0.5) * slashLen * 0.9,
    );
    // Third slash — thin red
    g.lineStyle(1.5, 0xff4444, 0.5);
    g.lineBetween(
      hitX + Math.cos(perpAngle - 0.4) * slashLen * 0.7,
      hitY + Math.sin(perpAngle - 0.4) * slashLen * 0.7,
      hitX - Math.cos(perpAngle - 0.4) * slashLen * 0.7,
      hitY - Math.sin(perpAngle - 0.4) * slashLen * 0.7,
    );

    // Impact flash circle
    const flash = this.add.circle(hitX, hitY, 6, 0xffffff, 0.5).setDepth(11);
    this.effectLayer.add(flash);
    this.tweens.add({ targets: flash, scaleX: 2, scaleY: 2, alpha: 0, duration: 180, onComplete: () => flash.destroy() });

    // Small spark particles
    for (let i = 0; i < 4; i++) {
      const sparkAngle = perpAngle + (Math.random() - 0.5) * 2;
      const sparkDist = Phaser.Math.Between(8, 16);
      const spark = this.add.circle(hitX, hitY, 1.5, 0xffdd44, 0.8).setDepth(11);
      this.effectLayer.add(spark);
      this.tweens.add({
        targets: spark,
        x: hitX + Math.cos(sparkAngle) * sparkDist,
        y: hitY + Math.sin(sparkAngle) * sparkDist,
        alpha: 0, duration: Phaser.Math.Between(150, 300),
        onComplete: () => spark.destroy(),
      });
    }

    this.effectLayer.add(g);
    this.tweens.add({ targets: g, alpha: 0, duration: 200, onComplete: () => g.destroy() });
  }

  private deathBurst(x: number, y: number, color: number) {
    // Burst of particles
    const numParticles = 8;
    for (let i = 0; i < numParticles; i++) {
      const angle = (Math.PI * 2 / numParticles) * i + Math.random() * 0.5;
      const speed = Phaser.Math.Between(15, 35);
      const size = Phaser.Math.Between(1, 3);
      const p = this.add.circle(x, y, size, color, 0.8).setDepth(11);
      this.effectLayer.add(p);
      this.tweens.add({
        targets: p,
        x: x + Math.cos(angle) * speed,
        y: y + Math.sin(angle) * speed,
        alpha: 0, scaleX: 0.2, scaleY: 0.2,
        duration: Phaser.Math.Between(300, 600), ease: "Power2",
        onComplete: () => p.destroy(),
      });
    }

    // Flash circle
    const flash = this.add.circle(x, y, 12, 0xffffff, 0.4).setDepth(11);
    this.effectLayer.add(flash);
    this.tweens.add({
      targets: flash, scaleX: 2.5, scaleY: 2.5, alpha: 0,
      duration: 300, ease: "Power2", onComplete: () => flash.destroy(),
    });
  }

  private playerDeathFx(s: AgentSprite) {
    const x = s.container.x;
    const y = s.container.y;

    // Flash red
    this.tweens.add({
      targets: s.container, alpha: 0.15, duration: 150, yoyo: true, repeat: 5,
    });

    // Camera red flash
    this.cam.flash(300, 80, 0, 0, true);

    // Skull icon floating up
    const skull = this.add.text(x, y - 10, "\u2620", {
      fontSize: "20px", color: "#ff4444",
      stroke: "#000000", strokeThickness: 3,
    }).setOrigin(0.5).setDepth(12);
    this.effectLayer.add(skull);
    this.tweens.add({
      targets: skull, y: y - 50, alpha: 0, scaleX: 1.5, scaleY: 1.5,
      duration: 1500, ease: "Power2", onComplete: () => skull.destroy(),
    });

    // Ground blood splatter
    const splat = this.add.circle(x, y + 8, 6, 0x881111, 0.3).setDepth(0);
    this.effectLayer.add(splat);
    this.tweens.add({
      targets: splat, scaleX: 2, scaleY: 1.5, alpha: 0,
      duration: 3000, onComplete: () => splat.destroy(),
    });
  }

  private floatText(x: number, y: number, text: string, color: string) {
    const t = this.add.text(x, y - 10, text, {
      fontSize: "10px", color, fontFamily: "Arial", fontStyle: "bold", stroke: "#000000", strokeThickness: 2,
    }).setOrigin(0.5).setDepth(11);
    this.effectLayer.add(t);
    this.tweens.add({ targets: t, y: y - 44, alpha: 0, duration: 1400, onComplete: () => t.destroy() });
  }

  private levelUpFx(x: number, y: number) {
    // Text
    const t = this.add.text(x, y - 24, "LEVEL UP!", {
      fontSize: "15px", color: "#ffcc33", fontFamily: "Arial",
      fontStyle: "bold", stroke: "#000000", strokeThickness: 4,
    }).setOrigin(0.5).setDepth(12);
    this.effectLayer.add(t);
    this.tweens.add({
      targets: t, y: y - 60, alpha: 0, scaleX: 1.4, scaleY: 1.4,
      duration: 1800, ease: "Power2", onComplete: () => t.destroy(),
    });

    // Expanding ring
    const ring = this.add.circle(x, y, 8, 0xffcc33, 0.5).setDepth(11);
    this.effectLayer.add(ring);
    this.tweens.add({
      targets: ring, scaleX: 5, scaleY: 5, alpha: 0,
      duration: 900, ease: "Power2", onComplete: () => ring.destroy(),
    });

    // Sparkle particles — more and bigger
    for (let i = 0; i < 10; i++) {
      const angle = (Math.PI * 2 / 10) * i;
      const dist = Phaser.Math.Between(25, 40);
      const spark = this.add.circle(x, y, Phaser.Math.Between(1, 3), 0xffee88, 0.9).setDepth(11);
      this.effectLayer.add(spark);
      this.tweens.add({
        targets: spark,
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist,
        alpha: 0, scaleX: 0.2, scaleY: 0.2,
        duration: Phaser.Math.Between(500, 900), ease: "Power2",
        onComplete: () => spark.destroy(),
      });
    }

    // Golden pillar effect
    const pillar = this.add.rectangle(x, y - 40, 4, 80, 0xffcc33, 0.3).setDepth(11);
    this.effectLayer.add(pillar);
    this.tweens.add({
      targets: pillar, scaleX: 0, alpha: 0, duration: 800,
      ease: "Power2", onComplete: () => pillar.destroy(),
    });
  }

  // ── Public API ─────────────────────────────────────────

  public onLevelUp(playerId: string, newLevel: number): void {
    const s = this.agentSprites.get(playerId);
    if (s) { this.levelUpFx(s.container.x, s.container.y); s.levelLabel.setText(`Lv${newLevel}`); }
  }

  public setZone(zone: string) {
    if (this.currentZone === zone) return;
    this.currentZone = zone;
    this.drawGround();
    this.drawProps();
    this.drawNPCs();

    for (const [id, s] of this.agentSprites) {
      const st = this.wsClient.worldState.players[id];
      s.container.setVisible(st?.zone === zone);
    }

    for (const [, m] of this.mobSprites) m.container.destroy();
    this.mobSprites.clear();
  }
}
