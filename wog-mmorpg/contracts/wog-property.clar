;; wog-property.clar
;; SIP-009 NFT — World of Guilds Property Deeds
;;
;; Each token represents a property (house/plot) in a WoG zone.
;; Properties generate passive gold income tracked off-chain by the shard.
;; On-chain: ownership, transfers, listing price, rental yield metadata.

(impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait.nft-trait)

;; ─────────────────────────────────────────────
;; CONSTANTS
;; ─────────────────────────────────────────────
(define-constant CONTRACT-OWNER tx-sender)
(define-constant ERR-NOT-OWNER        (err u100))
(define-constant ERR-NOT-FOUND        (err u101))
(define-constant ERR-NOT-FOR-SALE     (err u102))
(define-constant ERR-INSUFFICIENT-STX (err u103))
(define-constant ERR-ALREADY-OWNED    (err u104))
(define-constant ERR-WRONG-OWNER      (err u105))

;; ─────────────────────────────────────────────
;; NFT DEFINITION
;; ─────────────────────────────────────────────
(define-non-fungible-token wog-property uint)

;; ─────────────────────────────────────────────
;; DATA MAPS
;; ─────────────────────────────────────────────

;; Core property metadata (immutable after mint)
(define-map property-meta uint {
  name:          (string-ascii 64),
  zone:          (string-ascii 32),
  tier:          uint,              ;; 1=Cottage 2=House 3=Manor 4=Castle 5=Palace
  rent-per-tick: uint,              ;; wog-gold micro-units earned per game tick
  max-tenants:   uint               ;; how many agents can rent simultaneously
})

;; Mutable market state
(define-map property-listing uint {
  for-sale:    bool,
  price-ustx:  uint,               ;; sale price in micro-STX (0 = not for sale)
  for-rent:    bool,
  rent-ustx:   uint                ;; rent per game-day in micro-STX
})

;; Active tenants per property
(define-map property-tenants uint (list 5 principal))

;; Token counter
(define-data-var token-counter uint u0)

;; ─────────────────────────────────────────────
;; SIP-009 REQUIRED
;; ─────────────────────────────────────────────
(define-public (transfer (token-id uint) (sender principal) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender sender) ERR-WRONG-OWNER)
    (asserts! (is-eq (some sender) (nft-get-owner? wog-property token-id)) ERR-NOT-OWNER)
    (try! (nft-transfer? wog-property token-id sender recipient))
    (ok true)))

(define-read-only (get-last-token-id)
  (ok (var-get token-counter)))

(define-read-only (get-token-uri (token-id uint))
  (ok (some (concat "https://rogue-function.vercel.app/api/property/" (uint-to-ascii token-id)))))

(define-read-only (get-owner (token-id uint))
  (ok (nft-get-owner? wog-property token-id)))

;; ─────────────────────────────────────────────
;; MINT (contract owner only — shard mints props at game start)
;; ─────────────────────────────────────────────
(define-public (mint
  (recipient    principal)
  (name         (string-ascii 64))
  (zone         (string-ascii 32))
  (tier         uint)
  (rent-per-tick uint)
  (max-tenants  uint))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-OWNER)
    (let ((token-id (+ (var-get token-counter) u1)))
      (var-set token-counter token-id)
      (try! (nft-mint? wog-property token-id recipient))
      (map-set property-meta token-id {
        name: name, zone: zone, tier: tier,
        rent-per-tick: rent-per-tick, max-tenants: max-tenants })
      (map-set property-listing token-id {
        for-sale: false, price-ustx: u0,
        for-rent: false,  rent-ustx: u0 })
      (ok token-id))))

;; ─────────────────────────────────────────────
;; MARKET — LIST FOR SALE
;; ─────────────────────────────────────────────
(define-public (list-for-sale (token-id uint) (price-ustx uint))
  (begin
    (asserts! (is-eq (some tx-sender) (nft-get-owner? wog-property token-id)) ERR-NOT-OWNER)
    (asserts! (> price-ustx u0) ERR-NOT-FOUND)
    (let ((listing (default-to { for-sale: false, price-ustx: u0, for-rent: false, rent-ustx: u0 }
                                (map-get? property-listing token-id))))
      (map-set property-listing token-id (merge listing { for-sale: true, price-ustx: price-ustx })))
    (ok true)))

(define-public (delist (token-id uint))
  (begin
    (asserts! (is-eq (some tx-sender) (nft-get-owner? wog-property token-id)) ERR-NOT-OWNER)
    (let ((listing (default-to { for-sale: false, price-ustx: u0, for-rent: false, rent-ustx: u0 }
                                (map-get? property-listing token-id))))
      (map-set property-listing token-id (merge listing { for-sale: false, price-ustx: u0 })))
    (ok true)))

;; ─────────────────────────────────────────────
;; MARKET — BUY
;; ─────────────────────────────────────────────
(define-public (buy (token-id uint))
  (let (
    (owner   (unwrap! (nft-get-owner? wog-property token-id) ERR-NOT-FOUND))
    (listing (unwrap! (map-get? property-listing token-id) ERR-NOT-FOUND))
    (price   (get price-ustx listing))
  )
    (asserts! (get for-sale listing) ERR-NOT-FOR-SALE)
    (asserts! (>= (stx-get-balance tx-sender) price) ERR-INSUFFICIENT-STX)
    (try! (stx-transfer? price tx-sender owner))
    (try! (nft-transfer? wog-property token-id owner tx-sender))
    (map-set property-listing token-id (merge listing { for-sale: false, price-ustx: u0 }))
    (ok { token-id: token-id, paid-ustx: price, new-owner: tx-sender })))

;; ─────────────────────────────────────────────
;; MARKET — RENT
;; ─────────────────────────────────────────────
(define-public (list-for-rent (token-id uint) (rent-ustx uint))
  (begin
    (asserts! (is-eq (some tx-sender) (nft-get-owner? wog-property token-id)) ERR-NOT-OWNER)
    (let ((listing (default-to { for-sale: false, price-ustx: u0, for-rent: false, rent-ustx: u0 }
                                (map-get? property-listing token-id))))
      (map-set property-listing token-id (merge listing { for-rent: true, rent-ustx: rent-ustx })))
    (ok true)))

;; ─────────────────────────────────────────────
;; READ-ONLY HELPERS
;; ─────────────────────────────────────────────
(define-read-only (get-property (token-id uint))
  (ok {
    owner:   (nft-get-owner? wog-property token-id),
    meta:    (map-get? property-meta token-id),
    listing: (map-get? property-listing token-id)
  }))

(define-read-only (get-all-for-sale)
  ;; Returns first 20 token IDs — frontend paginates
  (ok (filter is-listed (list u1 u2 u3 u4 u5 u6 u7 u8 u9 u10
                              u11 u12 u13 u14 u15 u16 u17 u18 u19 u20))))

(define-private (is-listed (token-id uint))
  (match (map-get? property-listing token-id)
    listing (get for-sale listing)
    false))

;; Uint to ascii helper (digits 0-9 only, sufficient for token IDs < 1000)
(define-private (uint-to-ascii (n uint))
  (if (is-eq n u0) "0"
  (if (is-eq n u1) "1"
  (if (is-eq n u2) "2"
  (if (is-eq n u3) "3"
  (if (is-eq n u4) "4"
  (if (is-eq n u5) "5"
  (if (is-eq n u6) "6"
  (if (is-eq n u7) "7"
  (if (is-eq n u8) "8"
  (if (is-eq n u9) "9" "??")))))))))))
