;; WoG Items - Multi-type Item NFT Contract
;; Replaces ERC-1155 Items (weapons, armor, consumables) from SKALE
;; 
;; NOTE: Stacks doesn't have a native ERC-1155 equivalent.
;; We use SIP-009 NFTs with on-chain item metadata to represent all item types.
;; Stackable consumables (potions) use a quantity field.

;; ============================================================
;; TRAITS
;; ============================================================
(impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait.nft-trait)

;; ============================================================
;; NFT DEFINITION
;; ============================================================
(define-non-fungible-token wog-item uint)

;; ============================================================
;; CONSTANTS
;; ============================================================
(define-constant CONTRACT-OWNER tx-sender)
(define-constant ERR-OWNER-ONLY (err u100))
(define-constant ERR-NOT-OWNER (err u101))
(define-constant ERR-NOT-FOUND (err u102))
(define-constant ERR-INVALID-TYPE (err u103))
(define-constant ERR-INSUFFICIENT-QUANTITY (err u104))

;; Item types (matches your existing item catalog)
;; 0=Weapon, 1=Armor, 2=Helmet, 3=Boots, 4=Potion, 5=Material, 6=Quest Item
(define-constant ITEM-TYPE-WEAPON u0)
(define-constant ITEM-TYPE-ARMOR u1)
(define-constant ITEM-TYPE-HELMET u2)
(define-constant ITEM-TYPE-BOOTS u3)
(define-constant ITEM-TYPE-POTION u4)
(define-constant ITEM-TYPE-MATERIAL u5)
(define-constant ITEM-TYPE-QUEST u6)

;; ============================================================
;; ITEM CATALOG (Template definitions - like ERC-1155 item types)
;; ============================================================
(define-map item-templates uint {
  name: (string-ascii 64),
  item-type: uint,
  rarity: uint,      ;; 0=Common, 1=Uncommon, 2=Rare, 3=Epic
  level-req: uint,
  attack-bonus: uint,
  defense-bonus: uint,
  hp-restore: uint,  ;; For potions
  gold-value: uint,  ;; Shop buy price
  uri: (string-ascii 128)
})

;; Template counter
(define-data-var last-template-id uint u0)

;; ============================================================
;; INSTANCE DATA (Each minted item)
;; ============================================================
(define-map item-instances uint {
  template-id: uint,
  owner: principal,
  quantity: uint,    ;; >1 for stackable consumables
  durability: uint,  ;; 0-100
  equipped: bool,
  character-id: uint ;; 0 = not equipped
})

;; Token counter
(define-data-var last-token-id uint u0)

;; Wallet -> item IDs
(define-map wallet-items principal (list 50 uint))

;; ============================================================
;; SIP-009 REQUIRED FUNCTIONS
;; ============================================================

(define-read-only (get-last-token-id)
  (ok (var-get last-token-id))
)

(define-read-only (get-token-uri (token-id uint))
  (ok (as-max-len? "https://wog-mmorpg.io/metadata/items/" u256))
)

(define-read-only (get-owner (token-id uint))
  (ok (nft-get-owner? wog-item token-id))
)

(define-public (transfer (token-id uint) (sender principal) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender sender) ERR-NOT-OWNER)
    (try! (nft-transfer? wog-item token-id sender recipient))
    (match (map-get? item-instances token-id)
      instance (map-set item-instances token-id (merge instance { owner: recipient }))
      false
    )
    (ok true)
  )
)

;; ============================================================
;; TEMPLATE MANAGEMENT (Admin)
;; ============================================================

;; Register a new item type in the catalog
(define-public (register-item-template
  (name (string-ascii 64))
  (item-type uint)
  (rarity uint)
  (level-req uint)
  (attack-bonus uint)
  (defense-bonus uint)
  (hp-restore uint)
  (gold-value uint)
  (uri (string-ascii 128))
)
  (let ((template-id (+ (var-get last-template-id) u1)))
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-OWNER-ONLY)
    (asserts! (<= item-type u6) ERR-INVALID-TYPE)
    (map-set item-templates template-id {
      name: name,
      item-type: item-type,
      rarity: rarity,
      level-req: level-req,
      attack-bonus: attack-bonus,
      defense-bonus: defense-bonus,
      hp-restore: hp-restore,
      gold-value: gold-value,
      uri: uri
    })
    (var-set last-template-id template-id)
    (ok template-id)
  )
)

;; ============================================================
;; MINTING (Shop purchases, Quest drops, Mob loot)
;; ============================================================

;; Mint an item to a player (shop purchase or quest reward)
(define-public (mint-item
  (template-id uint)
  (recipient principal)
  (quantity uint)
)
  (let ((token-id (+ (var-get last-token-id) u1)))
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-OWNER-ONLY)
    (asserts! (is-some (map-get? item-templates template-id)) ERR-NOT-FOUND)
    (try! (nft-mint? wog-item token-id recipient))
    (map-set item-instances token-id {
      template-id: template-id,
      owner: recipient,
      quantity: quantity,
      durability: u100,
      equipped: false,
      character-id: u0
    })
    (var-set last-token-id token-id)
    (add-to-wallet-items recipient token-id)
    (ok token-id)
  )
)

;; Burn item (consumed potion, destroyed gear)
(define-public (burn-item (token-id uint))
  (let ((instance (unwrap! (map-get? item-instances token-id) ERR-NOT-FOUND)))
    (asserts! (is-eq tx-sender (get owner instance)) ERR-NOT-OWNER)
    (try! (nft-burn? wog-item token-id tx-sender))
    (map-delete item-instances token-id)
    (ok true)
  )
)

;; Use/consume one potion (decrements quantity, burns if 0)
(define-public (use-consumable (token-id uint))
  (let (
    (instance (unwrap! (map-get? item-instances token-id) ERR-NOT-FOUND))
    (template (unwrap! (map-get? item-templates (get template-id instance)) ERR-NOT-FOUND))
  )
    (asserts! (is-eq tx-sender (get owner instance)) ERR-NOT-OWNER)
    (asserts! (> (get quantity instance) u0) ERR-INSUFFICIENT-QUANTITY)
    (if (is-eq (get quantity instance) u1)
      ;; Last one - burn the NFT
      (begin
        (try! (nft-burn? wog-item token-id tx-sender))
        (map-delete item-instances token-id)
        (ok (get hp-restore template))
      )
      ;; Decrement quantity
      (begin
        (map-set item-instances token-id (merge instance { quantity: (- (get quantity instance) u1) }))
        (ok (get hp-restore template))
      )
    )
  )
)

;; Equip item to a character
(define-public (equip-item (token-id uint) (character-id uint))
  (let ((instance (unwrap! (map-get? item-instances token-id) ERR-NOT-FOUND)))
    (asserts! (is-eq tx-sender (get owner instance)) ERR-NOT-OWNER)
    (ok (map-set item-instances token-id (merge instance { equipped: true, character-id: character-id })))
  )
)

;; Degrade durability (called after combat)
(define-public (degrade-durability (token-id uint) (amount uint))
  (let ((instance (unwrap! (map-get? item-instances token-id) ERR-NOT-FOUND)))
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-OWNER-ONLY)
    (let ((new-dur (if (>= (get durability instance) amount)
                    (- (get durability instance) amount)
                    u0)))
      (ok (map-set item-instances token-id (merge instance { durability: new-dur })))
    )
  )
)

;; ============================================================
;; READ FUNCTIONS
;; ============================================================

(define-read-only (get-item (token-id uint))
  (map-get? item-instances token-id)
)

(define-read-only (get-template (template-id uint))
  (map-get? item-templates template-id)
)

(define-read-only (get-wallet-items (wallet principal))
  (default-to (list) (map-get? wallet-items wallet))
)

;; ============================================================
;; PRIVATE HELPERS
;; ============================================================

(define-private (add-to-wallet-items (wallet principal) (token-id uint))
  (let ((current (default-to (list) (map-get? wallet-items wallet))))
    (map-set wallet-items wallet (unwrap-panic (as-max-len? (append current token-id) u50)))
  )
)

(define-private (string-to-response (uri (string-ascii 128)))
  (some uri)
)
