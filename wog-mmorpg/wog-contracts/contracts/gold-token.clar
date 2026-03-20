;; WoG Gold Token - SIP-010 Fungible Token
;; Replaces ERC-20 GOLD token from SKALE

;; ============================================================
;; TRAITS (interfaces - like Solidity interfaces)
;; ============================================================
(impl-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)

;; ============================================================
;; TOKEN DEFINITION
;; ============================================================
;; Define the fungible token with no max supply (mint freely for quest rewards)
(define-fungible-token wog-gold)

;; ============================================================
;; CONSTANTS
;; ============================================================
(define-constant CONTRACT-OWNER tx-sender)
(define-constant ERR-OWNER-ONLY (err u100))
(define-constant ERR-NOT-TOKEN-OWNER (err u101))
(define-constant ERR-INSUFFICIENT-BALANCE (err u102))

;; ============================================================
;; AUTHORIZED MINTERS
;; Quest system and shard server can mint rewards
;; ============================================================
(define-map authorized-minters principal bool)

;; Owner is always authorized
(map-set authorized-minters CONTRACT-OWNER true)

;; ============================================================
;; SIP-010 REQUIRED FUNCTIONS
;; ============================================================

;; Transfer gold between players/contracts
(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) ERR-NOT-TOKEN-OWNER)
    (try! (ft-transfer? wog-gold amount sender recipient))
    (match memo to-print (print to-print) 0x)
    (ok true)
  )
)

;; Returns token name
(define-read-only (get-name)
  (ok "WoG Gold")
)

;; Returns token symbol
(define-read-only (get-symbol)
  (ok "GOLD")
)

;; Returns decimals (6 = like USDC, so 1 GOLD = 1000000 micro-gold)
(define-read-only (get-decimals)
  (ok u6)
)

;; Returns balance of a wallet
(define-read-only (get-balance (account principal))
  (ok (ft-get-balance wog-gold account))
)

;; Returns total supply minted
(define-read-only (get-total-supply)
  (ok (ft-get-supply wog-gold))
)

;; Token metadata URI
(define-read-only (get-token-uri)
  (ok (some u"https://wog-mmorpg.io/metadata/gold-token.json"))
)

;; ============================================================
;; MINTING (Quest Rewards & Admin)
;; ============================================================

;; Mint gold - called by quest system when player completes quest
(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-authorized-minter tx-sender) ERR-OWNER-ONLY)
    (ft-mint? wog-gold amount recipient)
  )
)

;; Burn gold - called by shop when player buys items
(define-public (burn (amount uint) (owner principal))
  (begin
    (asserts! (is-eq tx-sender owner) ERR-NOT-TOKEN-OWNER)
    (ft-burn? wog-gold amount owner)
  )
)

;; ============================================================
;; MINTER MANAGEMENT (Owner only)
;; ============================================================

;; Add a new authorized minter (e.g. quest contract address)
(define-public (add-minter (minter principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-OWNER-ONLY)
    (ok (map-set authorized-minters minter true))
  )
)

;; Remove a minter
(define-public (remove-minter (minter principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-OWNER-ONLY)
    (ok (map-set authorized-minters minter false))
  )
)

;; Check if address can mint
(define-read-only (is-authorized-minter (minter principal))
  (default-to false (map-get? authorized-minters minter))
)
