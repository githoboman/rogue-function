# WoG MMORPG — Sprite Download Guide

All assets below are **CC0 (Public Domain)** from Kenney.nl.
No attribution required. No registration needed.

---

## STEP 1 — Download These 3 Packs

### Pack 1: Roguelike/RPG Pack (characters, monsters, tiles, items)
```
https://kenney.nl/assets/roguelike-rpg-pack
```
Click **Download** → saves as `roguelikeRPG_pack.zip`

### Pack 2: Roguelike Characters (450 character sprites)
```
https://kenney.nl/assets/roguelike-characters
```
Click **Download** → saves as `roguelikeCharacters.zip`

### Pack 3: Tiny Town (outdoor environment tiles)
```
https://kenney.nl/assets/tiny-town
```
Click **Download** → saves as `tinyTown.zip`

---

## STEP 2 — Extract Into This Exact Structure

After downloading, extract and copy files to:

```
client/
└── public/
    └── assets/
        ├── characters/
        │   From roguelikeCharacters.zip → Spritesheet/
        │   ├── roguelikeChar_transparent.png      ← MAIN character sheet (57 chars, 16x16 each)
        │   └── roguelikeChar_transparent.xml      ← Frame data (optional, we use manual coords)
        │
        ├── tiles/
        │   From roguelikeRPG_pack.zip → Spritesheet/
        │   ├── roguelikeRPG_transparent.png       ← MAIN tile sheet (all tiles 16x16)
        │   └── roguelikeRPG_transparent.xml
        │
        ├── monsters/
        │   From roguelikeRPG_pack.zip → Spritesheet/
        │   ├── roguelikeRPG_transparent.png       ← monsters are IN the main sheet
        │   (same file as tiles — monsters are in rows 15-20 of the sheet)
        │
        └── town/
            From tinyTown.zip → Tilemap/
            ├── tilemap_packed.png                 ← outdoor tiles (16x16)
            └── tilemap.tmx                        ← Tiled map (optional reference)
```

**Shortcut:** You only really need 2 files to start:
- `roguelikeRPG_transparent.png` (tiles + monsters)
- `roguelikeChar_transparent.png` (all characters)

---

## STEP 3 — Sprite Coordinates Reference

The sheets are grids of 16x16 sprites. Phaser loads them as spritesheets.

### roguelikeChar_transparent.png — Character Positions
Sheet is 19 columns × 3 rows (16x16 per frame)

```
Row 0: [0]=wizard  [1]=knight  [2]=elf    [3]=dwarf  [4]=barbarian
        [5]=cleric [6]=ranger  [7]=rogue  [8]=paladin [9]=necromancer
       [10]=orc   [11]=goblin [12]=troll  ...

Row 1: Alternate poses / female variants
Row 2: More variants
```

### roguelikeRPG_transparent.png — Tile + Monster Positions
Sheet is 57 columns × 31 rows

```
Rows 0-9:   Dungeon/terrain tiles (floor, wall, grass, water, trees)
Rows 10-14: Items (potions, weapons, armor, gold)
Rows 15-20: Monsters (rat=row15col0, wolf=row15col3, goblin=row16col0,
                       slime=row16col4, boar=row15col6, spider=row17col2,
                       orc=row17col0, bear=row18col1, skeleton=row18col4,
                       dark knight=row20col0, necromancer=row20col3)
Rows 21-30: Environment (buildings, portals, chests, NPCs)
```

### tilemap_packed.png (Tiny Town) — Outdoor Tiles
16x16 tiles, grass/path/trees for the meadow zones

---

## STEP 4 — That's It!

Once files are in `client/public/assets/`, the updated `GameScene.ts` will:
- Auto-load both sheets in `preload()`
- Render each agent with the correct character frame (warrior=frame 1, mage=frame 0, etc.)
- Render mobs with correct monster frames
- Tile the ground with actual grass/forest tiles
- Show NPCs as blue-robed figures

---

## Quick Frame Reference for GameScene.ts

```typescript
// Character frames in roguelikeChar_transparent.png (frame index)
const CHAR_FRAMES = {
  Warrior:     1,   // armored knight
  Mage:        0,   // wizard with staff
  Ranger:      6,   // hooded ranger
  Cleric:      5,   // cleric with symbol
  Rogue:       7,   // dark rogue
  Paladin:     8,   // paladin in armor
  Necromancer: 9,   // dark mage
  Druid:       2,   // elf druid
};

// Monster frames in roguelikeRPG_transparent.png
// Use: this.add.image(x, y, 'rpg').setFrame(frameIndex)
const MOB_FRAMES = {
  giant_rat:      855,  // row 15, col 0
  young_wolf:     858,  // row 15, col 3
  wild_boar:      861,  // row 15, col 6
  goblin_scout:   912,  // row 16, col 0
  green_slime:    916,  // row 16, col 4
  bandit:         870,  // row 15, col 15
  alpha_wolf:     859,  // row 15, col 4 (bigger wolf)
  brown_bear:     969,  // row 17, col 2 (actually row 17)
  giant_spider:   970,  // row 17, col 3
  orc_warrior:    968,  // row 17, col 1
  harpy:          1026, // row 18, col 0
  shadow_stalker: 1140, // row 20, col 0
  dark_knight:    1141, // row 20, col 1
  necromancer:    1143, // row 20, col 3
};
```

---

## Alternative: One-Command Download (if you have wget)

```bash
cd client/public/assets

# Characters
curl -L "https://kenney.nl/assets/roguelike-characters" -o chars.zip
unzip chars.zip "*/Spritesheet/roguelikeChar_transparent.png" -d .
mv */Spritesheet/roguelikeChar_transparent.png ./characters/

# RPG tiles + monsters  
curl -L "https://kenney.nl/assets/roguelike-rpg-pack" -o rpg.zip
unzip rpg.zip "*/Spritesheet/roguelikeRPG_transparent.png" -d .
mv */Spritesheet/roguelikeRPG_transparent.png ./tiles/
```

Note: Kenney's download page may require clicking through. If curl doesn't work, just download manually from the URLs above.
