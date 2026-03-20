;; WoG Character NFT - SIP-009 Non-Fungible Token
;; Replaces ERC-721 Character NFTs from SKALE
;; Each character has: race, class, level, XP stored on-chain

;; ============================================================
;; TRAITS
;; ============================================================
(impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait.nft-trait)

;; ============================================================
;; NFT DEFINITION
;; ============================================================
(define-non-fungible-token wog-character uint)

;; ============================================================
;; CONSTANTS
;; ============================================================
(define-constant CONTRACT-OWNER tx-sender)
(define-constant ERR-OWNER-ONLY (err u100))
(define-constant ERR-NOT-TOKEN-OWNER (err u101))
(define-constant ERR-TOKEN-NOT-FOUND (err u102))
(define-constant ERR-TRANSFER-NOT-ALLOWED (err u103))
(define-constant ERR-INVALID-RACE (err u104))
(define-constant ERR-INVALID-CLASS (err u105))

;; ============================================================
;; DATA STORAGE
;; ============================================================

;; Token ID counter
(define-data-var last-token-id uint u0)

;; Character metadata stored on-chain
;; Races: 0=Human, 1=Elf, 2=Dwarf, 3=Orc
;; Classes: 0=Warrior, 1=Mage, 2=Ranger, 3=Cleric, 4=Rogue, 5=Paladin, 6=Necromancer, 7=Druid
(define-map character-data uint {
  name: (string-ascii 32),
  race: uint,
  class: uint,
  level: uint,
  xp: uint,
  wallet: principal,
  created-at: uint   ;; block height
})

;; Reverse lookup: wallet -> list of character IDs
(define-map wallet-characters principal (list 10 uint))

;; ============================================================
;; SIP-009 REQUIRED FUNCTIONS
;; ============================================================

;; Get last minted token ID
(define-read-only (get-last-token-id)
  (ok (var-get last-token-id))
)

;; Get token URI for metadata (like ERC-721 tokenURI)
(define-read-only (get-token-uri (token-id uint))
  (ok (as-max-len? "https://wog-mmorpg.io/metadata/characters/" u256))
)

;; Get current owner of a character
(define-read-only (get-owner (token-id uint))
  (ok (nft-get-owner? wog-character token-id))
)

;; Transfer character to another wallet
(define-public (transfer (token-id uint) (sender principal) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender sender) ERR-NOT-TOKEN-OWNER)
    (asserts! (is-some (nft-get-owner? wog-character token-id)) ERR-TOKEN-NOT-FOUND)
    (try! (nft-transfer? wog-character token-id sender recipient))
    ;; Update wallet-characters map
    (update-wallet-characters sender recipient token-id)
    (ok true)
  )
)

;; ============================================================
;; MINTING
;; ============================================================

;; Spawn/mint a new character - called by shard server
(define-public (mint-character
  (name (string-ascii 32))
  (race uint)
  (class uint)
  (recipient principal)
)
  (let ((token-id (+ (var-get last-token-id) u1)))
    ;; Validate race (0-3) and class (0-7)
    (asserts! (<= race u3) ERR-INVALID-RACE)
    (asserts! (<= class u7) ERR-INVALID-CLASS)
    ;; Mint the NFT
    (try! (nft-mint? wog-character token-id recipient))
    ;; Store on-chain metadata
    (map-set character-data token-id {
      name: name,
      race: race,
      class: class,
      level: u1,
      xp: u0,
      wallet: recipient,
      created-at: block-height
    })
    ;; Update token counter
    (var-set last-token-id token-id)
    ;; Add to wallet's character list
    (add-to-wallet-characters recipient token-id)
    (ok token-id)
  )
)

;; ============================================================
;; PROGRESSION (Called by game server after XP/level events)
;; ============================================================

;; Award XP to a character (only contract owner / shard server)
(define-public (award-xp (token-id uint) (xp-amount uint))
  (let (
    (char (unwrap! (map-get? character-data token-id) ERR-TOKEN-NOT-FOUND))
    (new-xp (+ (get xp char) xp-amount))
    (new-level (calculate-level new-xp))
  )
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-OWNER-ONLY)
    (ok (map-set character-data token-id (merge char { xp: new-xp, level: new-level })))
  )
)

;; ============================================================
;; READ FUNCTIONS
;; ============================================================

;; Get full character data
(define-read-only (get-character (token-id uint))
  (map-get? character-data token-id)
)

;; Get all character IDs owned by a wallet
(define-read-only (get-characters-by-wallet (wallet principal))
  (default-to (list) (map-get? wallet-characters wallet))
)

;; ============================================================
;; PRIVATE HELPERS
;; ============================================================

;; XP thresholds per level (simplified curve)
(define-private (calculate-level (xp uint))
  (if (>= xp u50000) u16
  (if (>= xp u30000) u12
  (if (>= xp u15000) u9
  (if (>= xp u7500) u7
  (if (>= xp u3000) u5
  (if (>= xp u1000) u3
  (if (>= xp u300) u2
  u1)))))))
)

(define-private (add-to-wallet-characters (wallet principal) (token-id uint))
  (let ((current (default-to (list) (map-get? wallet-characters wallet))))
    (map-set wallet-characters wallet (unwrap-panic (as-max-len? (append current token-id) u10)))
  )
)

(define-private (update-wallet-characters (from principal) (to principal) (token-id uint))
  ;; Add to recipient - simplified (full remove from sender requires fold)
  (add-to-wallet-characters to token-id)
)

;; Convert uint to ASCII for URI building
(define-private (uint-to-ascii (value uint))
  (if (is-eq value u0) u"0"
  (if (is-eq value u1) u"1"
  (if (is-eq value u2) u"2"
  (if (is-eq value u3) u"3"
  (if (is-eq value u4) u"4"
  u"5+")))))
)
