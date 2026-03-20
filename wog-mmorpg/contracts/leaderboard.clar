;; leaderboard.clar
;; On-chain proof of agent achievements
;; Stores permanent records: highest level, quests completed, gold earned
;; Only the server (contract owner) can write records

;; ============================================================
;; STORAGE
;; ============================================================

(define-data-var contract-owner principal tx-sender)

;; Per-character leaderboard entry
(define-map leaderboard
  { character-id: uint }
  {
    player-name:       (string-ascii 32),
    character-class:   (string-ascii 16),
    highest-level:     uint,
    total-xp:          uint,
    quests-completed:  uint,
    gold-earned:       uint,
    mobs-killed:       uint,
    last-updated:      uint,   ;; block height
  }
)

;; Global all-time records
(define-data-var record-highest-level     uint u0)
(define-data-var record-most-quests       uint u0)
(define-data-var record-most-gold         uint u0)
(define-data-var record-holder-level      uint u0)
(define-data-var record-holder-quests     uint u0)
(define-data-var record-holder-gold       uint u0)

;; Ordered top-10 character IDs by level (simple list, server manages order)
(define-data-var top-10-by-level (list 10 uint) (list))

;; ============================================================
;; AUTHORIZATION
;; ============================================================

(define-private (is-owner)
  (is-eq tx-sender (var-get contract-owner))
)

;; ============================================================
;; WRITE - server calls these after quest completions / level ups
;; ============================================================

;; Update or create a leaderboard entry for a character
(define-public (update-entry
    (character-id  uint)
    (player-name   (string-ascii 32))
    (char-class    (string-ascii 16))
    (new-level     uint)
    (new-xp        uint)
    (quests-done   uint)
    (gold-earned   uint)
    (mobs-killed   uint))
  (begin
    (asserts! (is-owner) (err u401))

    (map-set leaderboard
      { character-id: character-id }
      {
        player-name:      player-name,
        character-class:  char-class,
        highest-level:    new-level,
        total-xp:         new-xp,
        quests-completed: quests-done,
        gold-earned:      gold-earned,
        mobs-killed:      mobs-killed,
        last-updated:     block-height,
      })

    ;; Update all-time records
    (if (> new-level (var-get record-highest-level))
      (begin
        (var-set record-highest-level new-level)
        (var-set record-holder-level character-id))
      true)

    (if (> quests-done (var-get record-most-quests))
      (begin
        (var-set record-most-quests quests-done)
        (var-set record-holder-quests character-id))
      true)

    (if (> gold-earned (var-get record-most-gold))
      (begin
        (var-set record-most-gold gold-earned)
        (var-set record-holder-gold character-id))
      true)

    (ok true)
  )
)

;; Record a single quest completion (increments counter)
(define-public (record-quest-completion (character-id uint) (gold-reward uint) (xp-reward uint))
  (begin
    (asserts! (is-owner) (err u401))
    (let ((entry (default-to
      { player-name: "", character-class: "", highest-level: u1, total-xp: u0,
        quests-completed: u0, gold-earned: u0, mobs-killed: u0, last-updated: u0 }
      (map-get? leaderboard { character-id: character-id }))))
    (map-set leaderboard
      { character-id: character-id }
      (merge entry {
        quests-completed: (+ (get quests-completed entry) u1),
        gold-earned:      (+ (get gold-earned entry) gold-reward),
        total-xp:         (+ (get total-xp entry) xp-reward),
        last-updated:     block-height,
      }))
    (ok true))
  )
)

;; Record a mob kill
(define-public (record-kill (character-id uint))
  (begin
    (asserts! (is-owner) (err u401))
    (let ((entry (default-to
      { player-name: "", character-class: "", highest-level: u1, total-xp: u0,
        quests-completed: u0, gold-earned: u0, mobs-killed: u0, last-updated: u0 }
      (map-get? leaderboard { character-id: character-id }))))
    (map-set leaderboard
      { character-id: character-id }
      (merge entry {
        mobs-killed:  (+ (get mobs-killed entry) u1),
        last-updated: block-height,
      }))
    (ok true))
  )
)

;; Transfer ownership (for upgrades)
(define-public (transfer-ownership (new-owner principal))
  (begin
    (asserts! (is-owner) (err u401))
    (var-set contract-owner new-owner)
    (ok true)
  )
)

;; ============================================================
;; READ - free queries
;; ============================================================

(define-read-only (get-entry (character-id uint))
  (map-get? leaderboard { character-id: character-id })
)

(define-read-only (get-all-time-records)
  {
    highest-level:        (var-get record-highest-level),
    highest-level-holder: (var-get record-holder-level),
    most-quests:          (var-get record-most-quests),
    most-quests-holder:   (var-get record-holder-quests),
    most-gold:            (var-get record-most-gold),
    most-gold-holder:     (var-get record-holder-gold),
  }
)

(define-read-only (get-owner)
  (var-get contract-owner)
)
