;; wog-sprint.clar
;; Weekly sprint competitions for WoG agents
;; Top performer earns STX from the prize pool
;;
;; Flow:
;;   1. Owner creates a sprint (start-block, end-block, prize-pool in STX)
;;   2. Agents register for the sprint
;;   3. Server submits scores during the sprint
;;   4. After end-block, anyone can call finalize to pick the winner
;;   5. Winner claims STX prize

;; ============================================================
;; STORAGE
;; ============================================================

(define-data-var contract-owner principal tx-sender)
(define-data-var current-sprint-id uint u0)

;; Sprint definition
(define-map sprints
  { sprint-id: uint }
  {
    name:           (string-ascii 64),
    start-block:    uint,
    end-block:      uint,
    prize-pool:     uint,    ;; in micro-STX
    agent-count:    uint,
    winner-id:      uint,    ;; character-id of winner (0 = not finalized)
    finalized:      bool,
  }
)

;; Per-agent scores within a sprint
(define-map sprint-scores
  { sprint-id: uint, character-id: uint }
  {
    agent-name:        (string-ascii 32),
    total-score:       uint,    ;; composite score
    quests-completed:  uint,
    mobs-killed:       uint,
    gold-earned:       uint,
    xp-earned:         uint,
    last-updated:      uint,
  }
)

;; Track registered agents per sprint
(define-map sprint-agents
  { sprint-id: uint, index: uint }
  { character-id: uint }
)

;; ============================================================
;; AUTHORIZATION
;; ============================================================

(define-private (is-owner)
  (is-eq tx-sender (var-get contract-owner))
)

;; ============================================================
;; SPRINT MANAGEMENT
;; ============================================================

;; Create a new sprint - owner deposits STX as prize pool
(define-public (create-sprint
    (name (string-ascii 64))
    (duration-blocks uint)
    (prize-stx uint))
  (let (
    (id (+ (var-get current-sprint-id) u1))
    (start block-height)
    (end (+ block-height duration-blocks))
  )
    (asserts! (is-owner) (err u401))
    (asserts! (> prize-stx u0) (err u400))

    ;; Transfer STX prize pool into contract
    (try! (stx-transfer? prize-stx tx-sender (as-contract tx-sender)))

    (map-set sprints { sprint-id: id }
      {
        name:        name,
        start-block: start,
        end-block:   end,
        prize-pool:  prize-stx,
        agent-count: u0,
        winner-id:   u0,
        finalized:   false,
      })

    (var-set current-sprint-id id)
    (ok id)
  )
)

;; Register an agent for the current sprint
(define-public (register-agent (character-id uint) (agent-name (string-ascii 32)))
  (let (
    (sid (var-get current-sprint-id))
    (sprint (unwrap! (map-get? sprints { sprint-id: sid }) (err u404)))
    (idx (get agent-count sprint))
  )
    (asserts! (is-owner) (err u401))
    (asserts! (not (get finalized sprint)) (err u403))
    (asserts! (<= block-height (get end-block sprint)) (err u410))

    ;; Add agent to roster
    (map-set sprint-agents { sprint-id: sid, index: idx }
      { character-id: character-id })

    ;; Init scores
    (map-set sprint-scores { sprint-id: sid, character-id: character-id }
      {
        agent-name:       agent-name,
        total-score:      u0,
        quests-completed: u0,
        mobs-killed:      u0,
        gold-earned:      u0,
        xp-earned:        u0,
        last-updated:     block-height,
      })

    ;; Increment agent count
    (map-set sprints { sprint-id: sid }
      (merge sprint { agent-count: (+ idx u1) }))

    (ok true)
  )
)

;; Submit updated scores for an agent (server calls this periodically)
(define-public (submit-score
    (character-id uint)
    (quests-completed uint)
    (mobs-killed uint)
    (gold-earned uint)
    (xp-earned uint))
  (let (
    (sid (var-get current-sprint-id))
    (sprint (unwrap! (map-get? sprints { sprint-id: sid }) (err u404)))
    ;; Composite score: quests worth 100, kills worth 10, gold worth 1, xp worth 1
    (score (+ (* quests-completed u100) (* mobs-killed u10) gold-earned xp-earned))
  )
    (asserts! (is-owner) (err u401))
    (asserts! (not (get finalized sprint)) (err u403))

    (map-set sprint-scores { sprint-id: sid, character-id: character-id }
      {
        agent-name:       (default-to ""
          (get agent-name (map-get? sprint-scores { sprint-id: sid, character-id: character-id }))),
        total-score:      score,
        quests-completed: quests-completed,
        mobs-killed:      mobs-killed,
        gold-earned:      gold-earned,
        xp-earned:        xp-earned,
        last-updated:     block-height,
      })

    (ok score)
  )
)

;; Finalize sprint - pick the winner (highest total-score)
;; Anyone can call after end-block, but winner-id must be provided by caller
;; (On-chain iteration is expensive, so server computes winner off-chain and submits)
(define-public (finalize-sprint (winner-character-id uint))
  (let (
    (sid (var-get current-sprint-id))
    (sprint (unwrap! (map-get? sprints { sprint-id: sid }) (err u404)))
    (winner-scores (unwrap! (map-get? sprint-scores { sprint-id: sid, character-id: winner-character-id }) (err u404)))
  )
    (asserts! (is-owner) (err u401))
    (asserts! (not (get finalized sprint)) (err u403))
    (asserts! (>= block-height (get end-block sprint)) (err u425))
    (asserts! (> (get total-score winner-scores) u0) (err u400))

    ;; Transfer prize pool to contract owner (who distributes to winner's wallet)
    (try! (as-contract (stx-transfer? (get prize-pool sprint) tx-sender (var-get contract-owner))))

    ;; Mark finalized
    (map-set sprints { sprint-id: sid }
      (merge sprint { winner-id: winner-character-id, finalized: true }))

    (ok winner-character-id)
  )
)

;; ============================================================
;; READ-ONLY
;; ============================================================

(define-read-only (get-current-sprint)
  (map-get? sprints { sprint-id: (var-get current-sprint-id) })
)

(define-read-only (get-current-sprint-id)
  (var-get current-sprint-id)
)

(define-read-only (get-sprint (sprint-id uint))
  (map-get? sprints { sprint-id: sprint-id })
)

(define-read-only (get-agent-score (sprint-id uint) (character-id uint))
  (map-get? sprint-scores { sprint-id: sprint-id, character-id: character-id })
)

(define-read-only (get-sprint-agent (sprint-id uint) (index uint))
  (map-get? sprint-agents { sprint-id: sprint-id, index: index })
)

(define-read-only (get-owner)
  (var-get contract-owner)
)

;; Transfer ownership
(define-public (transfer-ownership (new-owner principal))
  (begin
    (asserts! (is-owner) (err u401))
    (var-set contract-owner new-owner)
    (ok true)
  )
)
